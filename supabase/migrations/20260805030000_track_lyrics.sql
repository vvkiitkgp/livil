-- ============================================================================
-- tracks.lyrics — words, optionally time-synced
-- ============================================================================
--
-- Stored as a COLUMN, not a storage object. An LRC for a long song is 3–5 KB, so an object
-- would mean a second network round trip at display time to fetch something smaller than the
-- request overhead. Mirrors how `waveform_peaks` is handled: small derived-ish data that the
-- player needs lives on the row.
--
-- THE RAW FILE IS STORED, not a parsed structure. Parsing belongs in `shared/services/lyrics.ts`
-- so both clients derive the same lines from the same bytes; storing a parsed blob would
-- freeze today's parser into the database and make fixing it a migration. Raw text is also
-- what an artist would expect to get back if they ever export.
--
-- BOUNDED, and this is the `profiles.bio` lesson applied before it bites rather than after.
-- `tracks_select_authenticated` is `using (true)`, so anything on this table is fetched by
-- anyone who reads a track. 20 000 characters is roughly four times the longest real LRC and
-- still small enough that it cannot become a payload problem.
--
-- PUBLIC BY PRODUCT DECISION. No new policy: lyrics inherit `tracks_select_authenticated`,
-- which is what "listeners can read the lyrics" means. Recorded explicitly because the
-- alternative — artist-only — would have needed a narrower policy, and someone reading this
-- later should know the openness was chosen rather than inherited by accident.
--
-- `lyrics_format` is stored rather than re-detected on read. Detection is a heuristic (does
-- any line carry a timestamp), and a heuristic that runs on every render can disagree with
-- itself as the parser changes. Deciding once at upload and recording the answer is stable.

alter table public.tracks
  add column if not exists lyrics text,
  add column if not exists lyrics_format text;

alter table public.tracks
  drop constraint if exists tracks_lyrics_len,
  drop constraint if exists tracks_lyrics_format_valid,
  drop constraint if exists tracks_lyrics_format_present;

alter table public.tracks
  add constraint tracks_lyrics_len
    check (lyrics is null or char_length(lyrics) <= 20000),

  add constraint tracks_lyrics_format_valid
    check (lyrics_format is null or lyrics_format in ('lrc', 'plain')),

  -- The two columns are one fact and must not drift apart: lyrics without a format cannot be
  -- rendered correctly, and a format without lyrics is a claim about nothing.
  add constraint tracks_lyrics_format_present
    check ((lyrics is null) = (lyrics_format is null));

comment on column public.tracks.lyrics is
  'Raw lyrics file contents — LRC or plain text. Parsed by shared/services/lyrics.ts, never '
  'stored parsed. Public: inherits tracks_select_authenticated.';

comment on column public.tracks.lyrics_format is
  'lrc | plain. Decided once at upload rather than re-detected on read, so the answer cannot '
  'change as the parser changes.';
