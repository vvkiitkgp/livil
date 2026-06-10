-- Tier B beat-synced visualizer: pre-computed loudness envelope per track.
--
-- A normalized peaks array (each 0..1) sampled at a fixed time-density, plus
-- small metadata, so the floating-player wave can swell in loud sections and
-- calm in quiet ones at the live playback position. Shape:
--   { "version": 1, "hz": 10, "peaks": [0.02, 0.41, 0.88, ...] }
-- `peaks` always spans the FULL track in absolute seconds (the player loads the
-- full track), so clipped reposts index correctly by absolute position.
--
-- Computed once on-device (react-native-audio-api decode → RMS buckets), written
-- at upload and lazily on first play for older rows. Nullable: a null value just
-- means "not analyzed yet" and the wave falls back to its decorative animation.
-- No RLS change needed — the existing owner UPDATE policy on tracks (the same one
-- backfillTrackDuration relies on) already permits the uploader to set this.
alter table public.tracks
  add column if not exists waveform_peaks jsonb;

comment on column public.tracks.waveform_peaks is
  'Pre-computed loudness envelope for the beat-synced visualizer: { version, hz, peaks: number[] (0..1, full-track) }. Null = not analyzed yet (wave stays decorative). Written idempotently by the uploader on upload / first play.';
