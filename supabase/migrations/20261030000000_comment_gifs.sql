-- ============================================================================
-- GIFs in comments — a comment may carry one GIF (ADR-0031)
-- ============================================================================
--
-- Stores the provider, its id and the GIF's size — never a media URL (GIPHY's terms). The
-- app looks URLs up fresh through the `gifs` edge function, which also refuses anything
-- rated above PG-13. Old apps read only `body`, so the app writes '🎞 GIF' as its last line.
--
-- ADDITIVE ONLY: four nullable columns and their checks; the insert and update policies
-- are untouched, and old apps insert none of these columns, so every check passes for them.
-- ============================================================================

alter table public.post_comments
  add column if not exists gif_provider text,
  add column if not exists gif_id text,
  add column if not exists gif_width smallint,
  add column if not exists gif_height smallint;

alter table public.post_comments
  -- All four together or none: a GIF without its provider or size cannot be drawn.
  drop constraint if exists post_comments_gif_complete,
  add constraint post_comments_gif_complete
    check (num_nulls(gif_provider, gif_id, gif_width, gif_height) in (0, 4)),
  drop constraint if exists post_comments_gif_provider,
  add constraint post_comments_gif_provider
    check (gif_provider is null or gif_provider = 'giphy'),
  -- GIPHY ids are base-62 ("3o7TKSjRrfIPjeiVyM"). Mirrored in supabase/functions/gifs.
  drop constraint if exists post_comments_gif_id_format,
  add constraint post_comments_gif_id_format
    check (gif_id is null or gif_id ~ '^[A-Za-z0-9]{1,64}$'),
  drop constraint if exists post_comments_gif_size,
  add constraint post_comments_gif_size
    check (gif_width is null or (gif_width between 1 and 4096 and gif_height between 1 and 4096)),
  -- One attachment per comment: a song or a GIF, never both.
  drop constraint if exists post_comments_one_attachment,
  add constraint post_comments_one_attachment
    check (gif_id is null or (song_post_id is null and song_spotify_track_id is null and song_label is null));

comment on column public.post_comments.gif_provider is
  'Where gif_id comes from (ADR-0031). Only ''giphy'' today. Null when the comment has no GIF.';
comment on column public.post_comments.gif_id is
  'The provider''s id for a GIF shared in this comment. Media URLs are never stored: the app fetches fresh ones by id through the gifs edge function, which also refuses GIFs rated above PG-13.';
comment on column public.post_comments.gif_width is
  'The GIF''s width in px (with gif_height, its aspect ratio), so the comment reserves its box before the lookup answers.';
comment on column public.post_comments.gif_height is
  'The GIF''s height in px. See gif_width.';
