-- ============================================================================
-- Songs in comments — a comment may carry one song: a Livil post or a Spotify track
-- ============================================================================
--
-- A comment had only text. Chat can already send a song; comments are where people
-- talk about music most, so a comment can now attach one — a Livil upload (by its post)
-- or a Spotify track (ADR-0027: only the 22-character id is stored, as on posts).
--
-- ── What older apps see ─────────────────────────────────────────────────────
-- Nothing changes for them: they never select these columns. So the song must also be
-- readable from `body` alone — the app writes `song_label` ("🎵 Kesariya — Arijit
-- Singh") as the body's LAST line (or as the whole body when nothing was typed), and a
-- new app strips that line back off to draw the card instead. Storing the label in its
-- own column is what makes the strip exact rather than a guess at the last line.
--
-- ── When the song goes away ─────────────────────────────────────────────────
-- `song_post_id` is ON DELETE SET NULL: deleting the shared upload keeps the comment
-- (its words are the commenter's), which then reads as its body — label line included,
-- so it still says what was shared. For that reason the label is not required to have
-- a song; a song is required to have a label.
--
-- Visibility needs no rule here: the card is fetched as the viewer, so a post the
-- viewer may not see (friends-only, blocked, taken down) shows as its label only.
--
-- ADDITIVE ONLY: three nullable columns, their checks and one partial index. The insert
-- policy (post_comments_insert_self) is untouched; old apps insert none of these, so
-- every check passes for them.
-- ============================================================================

alter table public.post_comments
  add column if not exists song_post_id uuid references public.posts(id) on delete set null,
  add column if not exists song_spotify_track_id text,
  add column if not exists song_label text;

alter table public.post_comments
  drop constraint if exists post_comments_one_song,
  add constraint post_comments_one_song
    check (num_nonnulls(song_post_id, song_spotify_track_id) <= 1),
  drop constraint if exists post_comments_song_spotify_id_format,
  add constraint post_comments_song_spotify_id_format
    check (song_spotify_track_id is null or song_spotify_track_id ~ '^[A-Za-z0-9]{22}$'),
  drop constraint if exists post_comments_song_label_shape,
  add constraint post_comments_song_label_shape
    check (song_label is null or length(song_label) between 1 and 200),
  drop constraint if exists post_comments_song_needs_label,
  add constraint post_comments_song_needs_label
    check ((song_post_id is null and song_spotify_track_id is null) or song_label is not null);

-- ON DELETE SET NULL looks rows up by song_post_id; without an index every post delete
-- would scan post_comments. Partial: almost every comment has no song.
create index if not exists post_comments_song_post_id_idx
  on public.post_comments (song_post_id)
  where song_post_id is not null;

comment on column public.post_comments.song_post_id is
  'A Livil song shared in this comment (the original upload''s post). Null when none, or once that post is deleted.';
comment on column public.post_comments.song_spotify_track_id is
  'A Spotify track shared in this comment (ADR-0027): the 22-character id only.';
comment on column public.post_comments.song_label is
  'The shared song as text ("🎵 Title — Artist"), also written as the last line of body so apps that predate songs in comments still show it.';
