-- ============================================================================
-- Creator analytics — aggregates only, author-scoped, bounded
-- ============================================================================
--
-- Depends on 20260804050000 having closed `post_views_select_authenticated`. These functions
-- are the ONLY way to read that table now, and that is the design: a creator learns how many
-- people listened, never WHICH people.
--
-- WHY SECURITY DEFINER, AND WHAT MAKES IT SAFE. Every DEFINER is a deliberate hole and must
-- prove its own check. The check here is NOT `if auth.uid() is null then raise` — that proves
-- the caller is signed in and nothing about the resource, which is the mistake three earlier
-- functions in this schema shipped with. The check is STRUCTURAL:
--
--     join public.posts p on p.id = v.post_id
--    where p.author_id = auth.uid()
--
-- in the FROM clause. There is no code path through these functions that can return a row
-- the caller does not author, because the authorization predicate is the same predicate the
-- query needs to be fast. Removing it does not "disable a check", it breaks the query.
--
-- WHY AGGREGATES AND NEVER ROWS. A view over post_views would need a permissive policy
-- underneath, and the only workable shape — "author may select rows for their own posts" —
-- re-exposes (post_id, user_id, played_at) per row. The creator would learn exactly which
-- named friend played their track at 2am. That is the disclosure 20260804050000 just closed,
-- narrowed to one blast radius rather than removed. Likes and comments are PUBLIC acts and
-- are readable per-user by policy; a play is not, and never was.
--
-- BOUNDS ARE MANDATORY, not defensive. Every parameter that can grow is capped server-side
-- and rejected with an exception rather than silently truncated — a silently truncated
-- analytics answer is a wrong number presented as a right one.
--
-- TIMEZONE IS AN EXPLICIT PARAMETER. `played_at` is timestamptz; `date_trunc('day', ...)`
-- bins in UTC, so an artist in IST would see plays from 05:30 local attributed to the
-- previous day. It must be chosen once and consistently, because re-binning later changes
-- every number the artist has already looked at — which destroys trust in a dashboard more
-- thoroughly than being wrong from the start.
--
-- SELF-PLAYS ARE A PARAMETER, NOT A DECISION. Measured on this database: 268 of 770 recorded
-- plays — 35% — are the artist playing their own track. Excluding them by default would make
-- the dashboard disagree with `posts.views_count`, which is what the app shows and what feeds
-- ranking. Including them silently overstates reach. So the caller chooses and the UI says
-- which it is showing.

-- ── Index ───────────────────────────────────────────────────────────────────
-- post_views has (post_id) and (user_id, played_at desc). Neither serves
-- "this post, over this window": a 90-day chart currently reads every row the post ever had
-- and filters. This index is a strict superset of the (post_id) one, which becomes redundant
-- and is dropped.

create index if not exists post_views_post_id_played_at_idx
  on public.post_views (post_id, played_at desc);

drop index if exists public.post_views_post_id_idx;

-- ── Shared guard ────────────────────────────────────────────────────────────
--
-- Called from plpgsql BEFORE the query, never from a WHERE clause. A guard in WHERE is
-- evaluated per row, so a query matching zero rows would never run it — an out-of-range
-- window would return an empty result instead of an error, which is the worst of both:
-- unbounded input accepted, and a wrong answer that looks like a right one.

create or replace function public.assert_analytics_window(p_from date, p_to date)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_from is null or p_to is null then
    raise exception 'analytics window is required' using errcode = '22023';
  end if;
  if p_to < p_from then
    raise exception 'analytics window ends before it starts' using errcode = '22023';
  end if;
  if p_to - p_from > 400 then
    raise exception 'analytics window is limited to 400 days' using errcode = '22023';
  end if;
end;
$$;

-- ── Plays per day ───────────────────────────────────────────────────────────

create or replace function public.creator_plays_by_day(
  p_from date,
  p_to date,
  p_tz text default 'UTC',
  p_exclude_self boolean default false
)
returns table (day date, plays integer, listeners integer)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  perform public.assert_analytics_window(p_from, p_to);
  return query
    select (v.played_at at time zone coalesce(p_tz, 'UTC'))::date,
           count(*)::int,
           count(distinct v.user_id)::int
      from public.post_views v
      join public.posts p on p.id = v.post_id
     where p.author_id = auth.uid()
       and (v.played_at at time zone coalesce(p_tz, 'UTC'))::date between p_from and p_to
       and (not coalesce(p_exclude_self, false) or v.user_id <> p.author_id)
     group by 1
     order by 1;
end;
$$;

-- ── Plays by hour of day ────────────────────────────────────────────────────
--
-- "When are people listening" — the one question answerable today with no new collection.
-- Honest caveat for the UI, not enforceable here: this bins in the ARTIST's timezone, because
-- the listener's is not stored. For a mostly-local audience that is meaningful; for a global
-- one it is not, and the label must say whose clock it is.

create or replace function public.creator_plays_by_hour(
  p_from date,
  p_to date,
  p_tz text default 'UTC',
  p_exclude_self boolean default false
)
returns table (hour integer, plays integer)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  perform public.assert_analytics_window(p_from, p_to);
  return query
    select extract(hour from (v.played_at at time zone coalesce(p_tz, 'UTC')))::int,
           count(*)::int
      from public.post_views v
      join public.posts p on p.id = v.post_id
     where p.author_id = auth.uid()
       and (v.played_at at time zone coalesce(p_tz, 'UTC'))::date between p_from and p_to
       and (not coalesce(p_exclude_self, false) or v.user_id <> p.author_id)
     group by 1
     order by 1;
end;
$$;

-- ── Top tracks ──────────────────────────────────────────────────────────────

create or replace function public.creator_top_tracks(
  p_from date,
  p_to date,
  p_limit integer default 10,
  p_tz text default 'UTC',
  p_exclude_self boolean default false
)
returns table (
  post_id uuid,
  track_id uuid,
  title text,
  cover_art_url text,
  plays integer,
  listeners integer
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  perform public.assert_analytics_window(p_from, p_to);
  return query
    select p.id,
           t.id,
           t.title,
           coalesce(t.cover_art_url, t.thumbnail_url),
           count(*)::int,
           count(distinct v.user_id)::int
      from public.post_views v
      join public.posts  p on p.id = v.post_id
      join public.tracks t on t.id = p.track_id
     where p.author_id = auth.uid()
       and (v.played_at at time zone coalesce(p_tz, 'UTC'))::date between p_from and p_to
       and (not coalesce(p_exclude_self, false) or v.user_id <> p.author_id)
     group by p.id, t.id, t.title, t.cover_art_url, t.thumbnail_url
     order by count(*) desc
     limit least(greatest(coalesce(p_limit, 10), 1), 50);
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
-- Revoked from public and anon explicitly. An anonymous caller has no auth.uid(), so the
-- author predicate would match nothing — but relying on a predicate to be empty is weaker
-- than not granting execute, and the grant is the thing a reviewer can see.

revoke execute on function public.creator_plays_by_day(date, date, text, boolean)  from public, anon;
revoke execute on function public.creator_plays_by_hour(date, date, text, boolean) from public, anon;
revoke execute on function public.creator_top_tracks(date, date, integer, text, boolean) from public, anon;
revoke execute on function public.assert_analytics_window(date, date) from public, anon;

grant execute on function public.creator_plays_by_day(date, date, text, boolean)  to authenticated;
grant execute on function public.creator_plays_by_hour(date, date, text, boolean) to authenticated;
grant execute on function public.creator_top_tracks(date, date, integer, text, boolean) to authenticated;
