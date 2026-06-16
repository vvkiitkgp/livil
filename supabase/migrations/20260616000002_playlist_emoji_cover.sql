-- ─────────────────────────────────────────────────────────────────────────────
-- Playlist emoji+color cover
--
-- Playlists get a stylized cover composed of an emoji on a solid color,
-- instead of allowing image uploads. Both columns are optional — when null,
-- the playlist card falls back to the first post's cover_art_url (current
-- behavior). Only the playlist owner can update these (existing
-- "playlists" RLS already restricts UPDATE to user_id = auth.uid()).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.playlists add column if not exists cover_emoji text;
alter table public.playlists add column if not exists cover_color text;

comment on column public.playlists.cover_emoji is
  'Optional single emoji rendered on top of cover_color in playlist cards. Null = fall back to first-post cover.';
comment on column public.playlists.cover_color is
  'Optional hex color (e.g. #7C3AED) used as the background of the emoji cover. Null = fall back to first-post cover.';
