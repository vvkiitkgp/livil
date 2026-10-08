-- ============================================================================
-- Play stats for /studio/ops — "played on Livil" vs "opened on Spotify" (ADR-0027)
-- ============================================================================
--
-- Livil plays are already recorded: every counted play is a `post_views` row (written by
-- activity_record_play). Spotify plays happen in another app, so the only thing Livil can
-- see is the hand-off — the moment someone confirms "Open Spotify". This migration adds a
-- write-only log of those hand-offs and four ops-only readers over both sources.
--
-- ── Totals, not people ──────────────────────────────────────────────────────
-- Same stance as search_result_taps (20260808000000): `user_id` is stored so the insert can
-- be scoped to the caller and so the readers can count DISTINCT people — never so ops can
-- read who played what. No reader below returns a user id or a username. "Recent" lists
-- the song and the time, not the listener.
--
-- ── Spotify's terms ─────────────────────────────────────────────────────────
-- Only the 22-character track id is stored, as on posts. Titles are resolved live by the
-- dashboard through the `spotify` edge function; nothing Spotify-owned is persisted.
--
-- ADDITIVE ONLY: one new table, one new index on post_views, four new functions. No
-- shipped app reads or writes any of it.
-- ============================================================================

create table if not exists public.spotify_opens (
  id uuid not null primary key default gen_random_uuid(),
  spotify_track_id text not null,
  -- Where the hand-off started. Product signal only ("do people leave from chat or from
  -- the feed?") — closed list so a client cannot invent categories.
  source text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint spotify_opens_track_id_format check (spotify_track_id ~ '^[A-Za-z0-9]{22}$'),
  constraint spotify_opens_source_check check (source in ('feed', 'chat', 'search'))
);

create index if not exists spotify_opens_created_idx
  on public.spotify_opens (created_at desc);
create index if not exists spotify_opens_track_user_idx
  on public.spotify_opens (spotify_track_id, user_id);

alter table public.spotify_opens enable row level security;

-- INSERT ONLY, AND ONLY YOUR OWN — forged user ids would be forged "people" in the counts.
drop policy if exists spotify_opens_insert_self on public.spotify_opens;
create policy spotify_opens_insert_self on public.spotify_opens
  for insert to authenticated
  with check (user_id = auth.uid());

-- NO SELECT / UPDATE / DELETE POLICY, on purpose: rows are write-only from every client.
-- Reading happens only through the ops functions below.
revoke all on public.spotify_opens from anon;

comment on table public.spotify_opens is
  'One row per confirmed hand-off to the Spotify app (ADR-0027). Write-only for clients '
  '(RLS, no SELECT policy); totals come from the ops_play_* functions, never per-person.';

-- The ops readers window post_views by date across ALL posts; the existing indexes lead
-- with post_id or user_id and cannot serve that.
create index if not exists post_views_played_at_idx
  on public.post_views (played_at desc);

-- ── Readers ─────────────────────────────────────────────────────────────────
-- All four: SECURITY DEFINER (they read past the no-SELECT policies), gated on is_ops() in
-- the body, RETURN EMPTY for anyone else (the dashboard needs no route guard), bounded
-- inputs, `search_path = public, pg_temp` with pg_temp last (LIV-16).

-- 1. The headline numbers for a window.
create or replace function public.ops_play_summary(p_days integer default 30)
returns table (
  livil_plays bigint,
  livil_people bigint,
  spotify_opens bigint,
  spotify_people bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_ops() then
    return;
  end if;
  p_days := least(greatest(coalesce(p_days, 30), 1), 3650);

  return query
  select
    (select count(*)                from public.post_views v
      where v.played_at >= now() - make_interval(days => p_days)),
    (select count(distinct v.user_id) from public.post_views v
      where v.played_at >= now() - make_interval(days => p_days)),
    (select count(*)                from public.spotify_opens s
      where s.created_at >= now() - make_interval(days => p_days)),
    (select count(distinct s.user_id) from public.spotify_opens s
      where s.created_at >= now() - make_interval(days => p_days));
end;
$$;

-- 2. Per day, both sources, oldest first — the trend chart. Days with nothing are zeros,
--    not gaps, so a quiet day reads as quiet rather than missing.
create or replace function public.ops_play_daily(p_days integer default 30)
returns table (
  day date,
  livil_plays bigint,
  spotify_opens bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_ops() then
    return;
  end if;
  p_days := least(greatest(coalesce(p_days, 30), 1), 365);

  return query
  with days as (
    select generate_series(
      (now() at time zone 'utc')::date - (p_days - 1),
      (now() at time zone 'utc')::date,
      interval '1 day'
    )::date as d
  ),
  lv as (
    select (v.played_at at time zone 'utc')::date as d, count(*) as n
      from public.post_views v
     where v.played_at >= ((now() at time zone 'utc')::date - (p_days - 1))::timestamp at time zone 'utc'
     group by 1
  ),
  sp as (
    select (s.created_at at time zone 'utc')::date as d, count(*) as n
      from public.spotify_opens s
     where s.created_at >= ((now() at time zone 'utc')::date - (p_days - 1))::timestamp at time zone 'utc'
     group by 1
  )
  select days.d, coalesce(lv.n, 0), coalesce(sp.n, 0)
    from days
    left join lv on lv.d = days.d
    left join sp on sp.d = days.d
   order by days.d;
end;
$$;

-- 3. Top songs for one source, ranked by distinct PEOPLE then plays (one enthusiast
--    replaying a song fifty times must not outrank fifty people playing it once).
--    Livil: the TRACK (reposts of one upload count together), titled from the database.
--    Spotify: the track id only — the dashboard resolves the title live.
create or replace function public.ops_top_played(
  p_source text default 'livil',
  p_days integer default 30,
  p_limit integer default 10
)
returns table (
  entity_id text,
  title text,
  subtitle text,
  people bigint,
  plays bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_ops() then
    return;
  end if;
  p_days  := least(greatest(coalesce(p_days, 30), 1), 3650);
  p_limit := least(greatest(coalesce(p_limit, 10), 1), 50);

  if p_source = 'spotify' then
    return query
    select s.spotify_track_id, null::text, null::text,
           count(distinct s.user_id), count(*)
      from public.spotify_opens s
     where s.created_at >= now() - make_interval(days => p_days)
     group by s.spotify_track_id
     order by 4 desc, 5 desc
     limit p_limit;
  else
    return query
    select t.id::text, t.title, '@' || u.username,
           count(distinct v.user_id), count(*)
      from public.post_views v
      join public.posts p     on p.id = v.post_id
      join public.tracks t    on t.id = p.track_id
      left join public.profiles u on u.id = t.uploader_id
     where v.played_at >= now() - make_interval(days => p_days)
     group by t.id, t.title, u.username
     order by 4 desc, 5 desc
     limit p_limit;
  end if;
end;
$$;

-- 4. The latest plays from both sources, newest first — song and time, NEVER the listener.
create or replace function public.ops_recent_plays(p_limit integer default 25)
returns table (
  at timestamptz,
  source text,
  via text,
  title text,
  subtitle text,
  spotify_track_id text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_ops() then
    return;
  end if;
  p_limit := least(greatest(coalesce(p_limit, 25), 1), 100);

  return query
  select x.at, x.source, x.via, x.title, x.subtitle, x.spotify_track_id
    from (
      (select v.played_at as at, 'livil'::text as source, null::text as via,
              t.title, '@' || u.username as subtitle, null::text as spotify_track_id
         from public.post_views v
         join public.posts p  on p.id = v.post_id
         join public.tracks t on t.id = p.track_id
         left join public.profiles u on u.id = t.uploader_id
        order by v.played_at desc
        limit p_limit)
      union all
      (select s.created_at, 'spotify', s.source, null, null, s.spotify_track_id
         from public.spotify_opens s
        order by s.created_at desc
        limit p_limit)
    ) x
   order by x.at desc
   limit p_limit;
end;
$$;

-- REVOKE FROM anon EXPLICITLY (Supabase grants anon a DIRECT execute on new functions,
-- which revoking from PUBLIC does not touch — 20260806040000).
revoke all on function public.ops_play_summary(integer) from public;
revoke execute on function public.ops_play_summary(integer) from anon;
grant execute on function public.ops_play_summary(integer) to authenticated;

revoke all on function public.ops_play_daily(integer) from public;
revoke execute on function public.ops_play_daily(integer) from anon;
grant execute on function public.ops_play_daily(integer) to authenticated;

revoke all on function public.ops_top_played(text, integer, integer) from public;
revoke execute on function public.ops_top_played(text, integer, integer) from anon;
grant execute on function public.ops_top_played(text, integer, integer) to authenticated;

revoke all on function public.ops_recent_plays(integer) from public;
revoke execute on function public.ops_recent_plays(integer) from anon;
grant execute on function public.ops_recent_plays(integer) to authenticated;

comment on function public.ops_play_summary(integer) is
  'Livil plays vs Spotify hand-offs for /studio/ops: totals and distinct people. Ops-only; empty for others.';
comment on function public.ops_play_daily(integer) is
  'Per-day Livil plays and Spotify hand-offs (UTC days, zero-filled). Ops-only; empty for others.';
comment on function public.ops_top_played(text, integer, integer) is
  'Top songs by distinct people for one source (livil | spotify). Ops-only; never names listeners.';
comment on function public.ops_recent_plays(integer) is
  'Latest plays from both sources — song and time, never the listener. Ops-only.';
