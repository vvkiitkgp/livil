-- ============================================================================
-- Music score: one number per person, recomputed every night from what they did
-- ============================================================================
--
-- A small tag on every profile (owner's decision, 2026-10-17): an ACTIVITY score, shown
-- to everyone, with no explanation in the app; how it grows lives on livil-music.com/score.
-- ADR-0032.
--
-- Recomputed from scratch, not accumulated: every night refresh_music_scores() adds up
-- each person's whole history again. So
--   * the first run counts everything people have already done (no one starts at 0);
--   * undoing something takes its points back (unlike, delete a comment, a take-down);
--   * a new kind of activity is added by editing the sum and re-running it.
-- Nightly rather than live: a live public number would tell strangers the moment someone
-- is on the app — and the app never shows "online".
--
-- Points (days are IST calendar days; "a day" caps stop farming):
--   listen to a song                1   once per song a day, 50 a day; not your own posts;
--                                       a Spotify song counts when it is opened in Spotify
--   like a post                     1   once per post (the like itself); not your own posts
--   comment                         2   20 a day
--   share a song in chat            2   10 a day (a Livil track or a Spotify track link)
--   repost a song                   5   once per song, 10 a day
--   upload a song                  25   3 a day; only a published song, not taken down
--   someone plays your upload       1   once per listener per song a day
--   someone likes your repost       1   50 a day; not your own likes
--   someone comments on your repost 2   once per person per repost, 25 people a day
--   host a Jam (played 5+ minutes)  5   3 a day; measured by the server's heartbeat
--
-- ADDITIVE: a new table no shipped app reads, two functions no app calls, and a nightly
-- job. The new app reads music_scores and hides the tag when the table is missing.
-- ============================================================================

-- ── 0. The scheduler must exist ──────────────────────────────────────────────
do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'pg_cron is not installed — enable it (Database → Extensions → pg_cron) first';
  end if;
end $$;

-- ── 1. The scores ────────────────────────────────────────────────────────────
create table if not exists public.music_scores (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  score       integer not null default 0 check (score >= 0),
  computed_at timestamptz not null default now()
);

comment on table public.music_scores is
  'One music score per person, written only by refresh_music_scores() (nightly). Public to '
  'signed-in users: the profile tag. ADR-0032.';

alter table public.music_scores enable row level security;

-- Everyone signed in may read every score (the tag is public) — except across a block, as
-- with profiles, posts and tracks: a score read nightly would tell a blocked person whether
-- the blocker was active yesterday (security review, 2026-10-17). Nobody may write one: no
-- insert/update/delete policy exists, and the grants are taken away as well.
drop policy if exists music_scores_select_authenticated on public.music_scores;
create policy music_scores_select_authenticated
  on public.music_scores for select to authenticated
  using (user_id = (select auth.uid())
         or not public.is_blocked_between((select auth.uid()), user_id));

revoke all on public.music_scores from anon;
revoke insert, update, delete, truncate on public.music_scores from authenticated;
grant select on public.music_scores to authenticated;

-- ── 2. The points, per person ────────────────────────────────────────────────
-- One row per (person, points) contribution; the caller sums them. Kept separate from the
-- refresh so a test (or ops) can see exactly where a score comes from.
create or replace function public.music_score_points()
returns table (user_id uuid, activity text, points bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- listen: distinct songs a day, 50 a day. A Livil song is a play (post_views; an upload
  -- and its reposts are the same song, and your own posts earn nothing); a Spotify song is
  -- opening it in Spotify (spotify_opens) — Livil cannot play those, so they never reach
  -- post_views.
  select x.user_id, 'listen', sum(least(x.n, 50))
    from (select l.user_id, l.d, count(distinct l.song) as n
            from (select v.user_id, (v.played_at at time zone 'Asia/Kolkata')::date as d,
                         coalesce(p.track_id::text, p.id::text) as song
                    from post_views v
                    join posts p on p.id = v.post_id
                   where p.author_id <> v.user_id
                  union all
                  select o.user_id, (o.created_at at time zone 'Asia/Kolkata')::date,
                         'spotify:' || o.spotify_track_id
                    from spotify_opens o) l
           group by 1, 2) x
   group by 1

  union all
  -- like: one per post; liking your own post earns nothing
  select l.user_id, 'like', count(*)
    from post_likes l
    join posts p on p.id = l.post_id
   where p.author_id <> l.user_id
   group by 1

  union all
  -- comment: 2 each, 20 a day
  select x.author_id, 'comment', sum(least(x.n, 20)) * 2
    from (select c.author_id, (c.created_at at time zone 'Asia/Kolkata')::date as d, count(*) as n
            from post_comments c
           group by 1, 2) x
   group by 1

  union all
  -- share a song in chat: 2 each, 10 a day. message_preview is the one place that decides
  -- what "a shared song" is (a Livil track_share or a direct Spotify track link).
  select x.sender_id, 'share', sum(least(x.n, 10)) * 2
    from (select m.sender_id, (m.created_at at time zone 'Asia/Kolkata')::date as d, count(*) as n
            from messages m
           where m.deleted_at is null
             and public.message_preview(m.kind, m.body) = '🎵 Shared a song'
           group by 1, 2) x
   group by 1

  union all
  -- repost: 5 for each song, counted on the day it was first reposted, 10 a day
  select x.author_id, 'repost', sum(least(x.n, 10)) * 5
    from (select f.author_id, f.d, count(*) as n
            from (select p.author_id,
                         min((p.created_at at time zone 'Asia/Kolkata')::date) as d
                    from posts p
                   where p.kind = 'repost'
                   group by p.author_id, coalesce(p.track_id::text, p.spotify_track_id, p.id::text)) f
           group by 1, 2) x
   group by 1

  union all
  -- upload: 25 each, 3 a day — only a finished, published song: its media arrived (not the
  -- `pending://` placeholder) and it has an upload post. A bare track row costs nothing to
  -- create, so on its own it earns nothing (security review, 2026-10-17). A taken-down
  -- track counts nothing.
  select x.uploader_id, 'upload', sum(least(x.n, 3)) * 25
    from (select t.uploader_id, (t.created_at at time zone 'Asia/Kolkata')::date as d, count(*) as n
            from tracks t
           where t.taken_down_at is null
             and coalesce(t.audio_url, t.video_url) not like 'pending://%'
             and exists (select 1 from posts p where p.track_id = t.id and p.kind = 'upload')
           group by 1, 2) x
   group by 1

  union all
  -- someone else plays your upload: 1 per listener per song a day
  select x.uploader_id, 'played_by_others', count(*)
    from (select distinct t.uploader_id, v.user_id, t.id,
                 (v.played_at at time zone 'Asia/Kolkata')::date as d
            from post_views v
            join posts p  on p.id = v.post_id
            join tracks t on t.id = p.track_id
           where t.uploader_id <> v.user_id
             and t.taken_down_at is null) x
   group by 1

  union all
  -- someone likes your repost: 1 per like, 50 a day; your own likes earn nothing
  select x.author_id, 'repost_liked', sum(least(x.n, 50))
    from (select p.author_id, (l.created_at at time zone 'Asia/Kolkata')::date as d, count(*) as n
            from post_likes l
            join posts p on p.id = l.post_id
           where p.kind = 'repost'
             and l.user_id <> p.author_id
           group by 1, 2) x
   group by 1

  union all
  -- someone comments on your repost: 2 per person per repost (on the day of their first
  -- comment), 25 people a day; your own comments earn nothing
  select x.owner_id, 'repost_commented', sum(least(x.n, 25)) * 2
    from (select f.owner_id, f.d, count(*) as n
            from (select p.author_id as owner_id, c.post_id, c.author_id as commenter_id,
                         min((c.created_at at time zone 'Asia/Kolkata')::date) as d
                    from post_comments c
                    join posts p on p.id = c.post_id
                   where p.kind = 'repost'
                     and c.author_id <> p.author_id
                   group by 1, 2, 3) f
           group by 1, 2) x
   group by 1

  union all
  -- host a Jam that played 5+ minutes: 5 each, 3 a day. Measured from the host heartbeat
  -- (last_played_at / host_clock_at), which only jam_host_heartbeat writes — not from
  -- ended_at, which the host's own update sets, so a Jam that never played earns nothing.
  select x.host_id, 'jam', sum(least(x.n, 3)) * 5
    from (select j.host_id, (j.started_at at time zone 'Asia/Kolkata')::date as d, count(*) as n
            from jam_rooms j
           where coalesce(j.last_played_at, j.host_clock_at) - j.started_at >= interval '5 minutes'
           group by 1, 2) x
   group by 1
$$;

revoke execute on function public.music_score_points() from public, anon, authenticated;

-- ── 3. The nightly refresh ───────────────────────────────────────────────────
-- Writes a row for every profile (0 for no activity), so a person whose last point-earning
-- thing was undone drops back rather than keeping a stale score.
create or replace function public.refresh_music_scores()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  insert into music_scores (user_id, score, computed_at)
  select pr.id, coalesce(t.score, 0), now()
    from profiles pr
    left join (select pts.user_id, least(sum(pts.points), 2147483647)::integer as score
                 from music_score_points() pts
                group by pts.user_id) t on t.user_id = pr.id
  on conflict (user_id) do update
     set score = excluded.score,
         computed_at = excluded.computed_at;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke execute on function public.refresh_music_scores() from public, anon, authenticated;

-- ── 4. Every night at 03:30 IST (22:00 UTC), and once now ────────────────────
-- pg_cron upserts by name, so re-running this migration updates the job in place.
select cron.schedule('refresh-music-scores', '0 22 * * *', 'select public.refresh_music_scores()');

select public.refresh_music_scores();
