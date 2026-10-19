-- ============================================================================
-- Recently Played includes the Spotify songs you played: my_recent_spotify_opens()
-- ============================================================================
--
-- Library → Recently Played listed only Livil songs (user_recent_tracks). A Spotify song
-- "played" from Livil is a confirmed hand-off to the Spotify app, logged in spotify_opens
-- (20261014000000) — so that log is the history to merge in (owner, 2026-10-19).
--
-- spotify_opens stays WRITE-ONLY for clients: still no SELECT policy, so nobody can read the
-- table, their own rows included, through the API. This function is the one reader a
-- client gets, and it answers about the CALLER only (auth.uid(); signed out → no rows). It
-- returns each song once, at its latest open — the shape Recently Played shows — and pages
-- backwards by that time, like listRecentTracksPage pages user_recent_tracks.
--
-- Also: 'library' joins the allowed sources, for a hand-off started from Recently Played.
-- LOOSENING only — every source a shipped app sends ('feed', 'chat', 'search') stays
-- valid, and an app that sends 'library' before this is applied just has that one stat
-- insert refused (recordSpotifyOpen swallows it; the song still opens).
--
-- Additive for every shipped app: no build calls this function, and the constraint only
-- widens. Re-runnable.

-- The reader filters by user and orders by time; the existing indexes lead with
-- created_at alone or with spotify_track_id.
create index if not exists spotify_opens_user_created_idx
  on public.spotify_opens (user_id, created_at desc);

alter table public.spotify_opens drop constraint if exists spotify_opens_source_check;
alter table public.spotify_opens add constraint spotify_opens_source_check
  check (source in ('feed', 'chat', 'search', 'library'));

create or replace function public.my_recent_spotify_opens(
  p_limit integer default 24,
  p_before timestamptz default null
)
returns table (spotify_track_id text, opened_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.spotify_track_id, max(o.created_at) as opened_at
  from public.spotify_opens o
  where o.user_id = auth.uid()
  group by o.spotify_track_id
  having p_before is null or max(o.created_at) < p_before
  order by opened_at desc, o.spotify_track_id
  limit least(greatest(coalesce(p_limit, 24), 1), 50);
$$;

revoke all on function public.my_recent_spotify_opens(integer, timestamptz) from public, anon;
grant execute on function public.my_recent_spotify_opens(integer, timestamptz) to authenticated;

comment on table public.spotify_opens is
  'One row per confirmed hand-off to the Spotify app (ADR-0027). Write-only for clients '
  '(RLS, no SELECT policy). Totals come from the ops_play_* functions, never per-person; '
  'the one per-person reader is my_recent_spotify_opens, and it returns only the caller''s rows.';

comment on function public.my_recent_spotify_opens(integer, timestamptz) is
  'The caller''s own Spotify hand-offs for Recently Played: one row per song at its latest '
  'open, newest first, paged by p_before. The only client read of spotify_opens; never '
  'anyone else''s rows.';
