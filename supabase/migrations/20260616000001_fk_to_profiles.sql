-- ─────────────────────────────────────────────────────────────────────────────
-- Re-point two foreign keys at public.profiles
--
-- albums.uploader_id and playlists.user_id originally referenced auth.users.
-- Both are semantically equivalent (profiles.id IS auth.users.id and cascades
-- on delete), but PostgREST's `select('owner:profiles(...)')` join syntax
-- needs an explicit FK from the public-schema table to profiles. Without
-- this, regenerated TypeScript types omit the relation and downstream code
-- gets `SelectQueryError<"could not find the relation between X and profiles">`.
--
-- albums was fixed inline in 20260616000000_albums_and_playlist_visibility.sql
-- but applied separately as a hot-fix; this file ensures playlists matches.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.playlists drop constraint if exists playlists_user_id_fkey;
alter table public.playlists
  add constraint playlists_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;
