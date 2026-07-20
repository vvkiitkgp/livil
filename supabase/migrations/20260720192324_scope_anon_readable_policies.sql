-- Removes anon-role read access from three tables.
--
-- Verified against production 2026-07-21: as the `anon` role, follows (8 rows),
-- albums (2) and album_tracks (2) were fully readable. The anon key is compiled
-- into the mobile app and published on the marketing site, so this is public data.
--
-- follows is the sharp one: `kind = 'star'` edges gate story and listening-activity
-- visibility, so enumerating the graph maps who can see whose activity.
--
-- NOTE ON follows: a policy `follows_select_authenticated` already exists and is
-- correctly scoped. The original unrestricted `follows_select` was never dropped,
-- and because policies are OR'd the permissive one still wins. This drops the
-- leftover rather than adding anything new.

-- 1. follows — drop the leftover unrestricted policy.
drop policy if exists "follows_select" on public.follows;

-- 2. albums — replace unrestricted select with an authenticated-only one.
drop policy if exists "albums_select_all" on public.albums;
create policy "albums_select_authenticated" on public.albums
  for select to authenticated using (true);

-- 3. album_tracks — same.
drop policy if exists "album_tracks_select_all" on public.album_tracks;
create policy "album_tracks_select_authenticated" on public.album_tracks
  for select to authenticated using (true);
