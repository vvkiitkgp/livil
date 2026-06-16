-- ─────────────────────────────────────────────────────────────────────────────
-- Albums + playlist visibility
--
-- Two related social features, shipped together:
--   1. ALBUMS — artist-owned grouping of a creator's own uploaded tracks
--      (Spotify-style). Distinct from playlists, which are user-curated post
--      collections. A creator tags any of their uploaded tracks into ONE
--      album (DB-enforced — see album_tracks.track_id uniqueness). Listeners
--      cannot create albums; albums become visible the moment a user uploads.
--   2. PLAYLIST VISIBILITY — public | friends | private. Existing playlists
--      default to 'public' to preserve previous behavior (there was no privacy
--      concept before, so they were de-facto shareable).
--
-- Both pieces in one migration so the playlist visibility RLS policy can
-- reference the friendships relationship in lockstep with the schema bump.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. ALBUMS table ──────────────────────────────────────────────────────────

create table if not exists public.albums (
  id            uuid primary key default gen_random_uuid(),
  uploader_id   uuid not null references public.profiles(id) on delete cascade,
  title         text not null check (char_length(trim(title)) between 1 and 120),
  description   text,
  cover_art_url text,
  release_date  date,
  created_at    timestamptz not null default now()
);

comment on table  public.albums              is 'Artist-owned grouping of the uploader''s own tracks. Distinct from playlists. Owner = uploader_id.';
comment on column public.albums.cover_art_url is 'Optional. UI falls back to the first track''s cover_art_url when null.';
comment on column public.albums.release_date  is 'Optional. Displayed as the year on the AlbumDetail hero.';

create index if not exists albums_uploader_idx
  on public.albums (uploader_id, created_at desc);

alter table public.albums enable row level security;

drop policy if exists "albums_select_all" on public.albums;
create policy "albums_select_all" on public.albums
  for select using (true);

drop policy if exists "albums_insert_own" on public.albums;
create policy "albums_insert_own" on public.albums
  for insert with check (uploader_id = auth.uid());

drop policy if exists "albums_update_own" on public.albums;
create policy "albums_update_own" on public.albums
  for update using (uploader_id = auth.uid()) with check (uploader_id = auth.uid());

drop policy if exists "albums_delete_own" on public.albums;
create policy "albums_delete_own" on public.albums
  for delete using (uploader_id = auth.uid());


-- ── 2. ALBUM_TRACKS join table ───────────────────────────────────────────────
-- Composite PK (album_id, track_id). Unique constraint on track_id alone
-- enforces ONE-ALBUM-PER-TRACK at the database level — the overflow menu
-- relies on this invariant ("Add to album" vs "Move/Remove from album" is a
-- single branch off the album_tracks lookup).

create table if not exists public.album_tracks (
  album_id  uuid not null references public.albums(id) on delete cascade,
  track_id  uuid not null references public.tracks(id) on delete cascade,
  position  integer not null check (position >= 0),
  added_at  timestamptz not null default now(),
  primary key (album_id, track_id)
);

comment on table public.album_tracks is 'Album membership join. Unique on track_id alone — a track belongs to AT MOST one album.';

create index if not exists album_tracks_track_idx
  on public.album_tracks (track_id);

create unique index if not exists album_tracks_one_album_per_track
  on public.album_tracks (track_id);

create unique index if not exists album_tracks_album_position
  on public.album_tracks (album_id, position);

alter table public.album_tracks enable row level security;

drop policy if exists "album_tracks_select_all" on public.album_tracks;
create policy "album_tracks_select_all" on public.album_tracks
  for select using (true);

-- Owner of the album AND uploader of the track — prevents tagging someone
-- else's track into your album. Mirrored on UPDATE/DELETE.
drop policy if exists "album_tracks_insert_own" on public.album_tracks;
create policy "album_tracks_insert_own" on public.album_tracks
  for insert with check (
    exists (
      select 1 from public.albums a
      where a.id = album_id and a.uploader_id = auth.uid()
    )
    and exists (
      select 1 from public.tracks t
      where t.id = track_id and t.uploader_id = auth.uid()
    )
  );

drop policy if exists "album_tracks_update_own" on public.album_tracks;
create policy "album_tracks_update_own" on public.album_tracks
  for update using (
    exists (
      select 1 from public.albums a
      where a.id = album_id and a.uploader_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.albums a
      where a.id = album_id and a.uploader_id = auth.uid()
    )
  );

drop policy if exists "album_tracks_delete_own" on public.album_tracks;
create policy "album_tracks_delete_own" on public.album_tracks
  for delete using (
    exists (
      select 1 from public.albums a
      where a.id = album_id and a.uploader_id = auth.uid()
    )
  );


-- ── 3. PLAYLIST VISIBILITY ───────────────────────────────────────────────────
-- Adds a tri-state visibility column to playlists. Existing rows default to
-- 'public' (there was no privacy concept before — silently flipping to private
-- would hide content users already curated).

do $$
begin
  if not exists (select 1 from pg_type where typname = 'playlist_visibility') then
    create type public.playlist_visibility as enum ('public', 'friends', 'private');
  end if;
end$$;

alter table public.playlists
  add column if not exists visibility public.playlist_visibility not null default 'public';

comment on column public.playlists.visibility is
  'Who can see this playlist. public = anyone, friends = accepted friends only (see RLS via friendships), private = owner only. Existing rows defaulted to public.';

create index if not exists playlists_owner_vis_idx
  on public.playlists (user_id, visibility);


-- ── 4. RLS: playlists SELECT honors visibility ───────────────────────────────
-- Owner can always see their own; otherwise visibility determines access.

drop policy if exists "playlists_select" on public.playlists;
create policy "playlists_select" on public.playlists
  for select using (
    user_id = auth.uid()
    or visibility = 'public'
    or (
      visibility = 'friends'
      and exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and (
            (f.user_a_id = auth.uid() and f.user_b_id = user_id)
            or (f.user_b_id = auth.uid() and f.user_a_id = user_id)
          )
      )
    )
  );


-- ── 5. RLS: playlist_posts SELECT follows the parent playlist's visibility ───
-- A friend looking at a friends-only playlist would otherwise hit playlist_posts
-- directly via the join and see rows even when RLS denies the parent. We mirror
-- the visibility check transitively.

drop policy if exists "playlist_posts_select" on public.playlist_posts;
create policy "playlist_posts_select" on public.playlist_posts
  for select using (
    exists (
      select 1 from public.playlists p
      where p.id = playlist_id
        and (
          p.user_id = auth.uid()
          or p.visibility = 'public'
          or (
            p.visibility = 'friends'
            and exists (
              select 1 from public.friendships f
              where f.status = 'accepted'
                and (
                  (f.user_a_id = auth.uid() and f.user_b_id = p.user_id)
                  or (f.user_b_id = auth.uid() and f.user_a_id = p.user_id)
                )
            )
          )
        )
    )
  );
