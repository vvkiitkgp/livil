-- ─────────────────────────────────────────────────────────────────────────────
-- Playlist cover gradient — optional 2nd color
--
-- When cover_color_2 is null and cover_color is set, the background renders
-- as a solid color. When BOTH are set, the picker chose a gradient and the
-- card renders a top-left → bottom-right linear gradient between them.
-- Saved as plain hex strings (e.g. "#7C3AED") so they're simple to render
-- with react-native-svg's LinearGradient.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.playlists add column if not exists cover_color_2 text;

comment on column public.playlists.cover_color_2 is
  'Optional second hex color. When set together with cover_color, the cover renders as a top-left → bottom-right linear gradient between the two. Null = solid color.';
