-- ============================================================================
-- tracks-media: accept the other spellings of formats it already accepts
-- ============================================================================
--
-- PRODUCTION INCIDENT, 2026-10-11. An artist on iOS (app 2.1.2, build 76) picked a WAV
-- master and got storage-api's raw "mime type audio/vnd.wave is not supported".
--
-- The bucket allowlist names WAV as `audio/wav` and `audio/x-wav`. iOS names it
-- `audio/vnd.wave` — that is the preferred MIME type of UTType `com.microsoft.waveform-audio`,
-- and it is what the document picker returns. The mobile client forwards the picker's type
-- verbatim (`src/services/uploads.ts`), so every WAV picked on an iPhone has been rejected
-- since iOS shipped. Android reports `audio/x-wav`, which is why it never showed up there.
--
-- It went unnoticed because no WAV had ever been uploaded: as of today every audio object in
-- the bucket (43) is `audio/mpeg`. This is the same class of defect AIFF hit in
-- 20260805010000 — one format, several registered spellings, only some of them listed.
--
-- WHY THE BUCKET AND NOT THE CLIENT. A client fix reaches people only after a store release
-- and an update; this fixes every build already installed, the moment it is applied.
-- Canonicalising aliases client-side (so stored objects carry one spelling per format —
-- Firefox refuses a media response typed `audio/vnd.wave`) is a separate, later change.
--
-- APPLIED to production by hand via the SQL editor on 2026-10-11, before this file merged,
-- because it was an active incident; verified afterwards (24 types, `audio/vnd.wave`
-- present, every prior type retained, file_size_limit unchanged). Re-running it is a no-op.
--
-- SCOPE: aliases ONLY. Every entry below is another name for a container the bucket already
-- accepts and the engine already plays. No new format is admitted. Unknown or missing types
-- stay rejected; in particular a wildcard such as `audio/*` is deliberately NOT added — it
-- would admit formats the player cannot decode (WMA, AMR, CAF) and turn a clear upload error
-- into a silent playback failure for every listener.
--
--   audio/vnd.wave   WAV  - iOS / macOS (the incident)
--   audio/wave       WAV  - RFC 2361 spelling; Firefox and some Linux tools
--   audio/x-flac     FLAC - older Android providers and Linux
--   audio/x-aac      AAC  - some Android providers
--   audio/mp3        MP3  - non-standard but common (Chromium on Windows, Android file apps)
--
-- Purely additive. It cannot reject anything that was accepted before, so it is safe for
-- every app version in the field.

do $$
begin
  -- Guarded on the column existing because CI applies migrations against a shim of the
  -- storage schema that has neither `allowed_mime_types` nor `file_size_limit`.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'storage'
       and table_name   = 'buckets'
       and column_name  = 'allowed_mime_types'
  ) then
    update storage.buckets
       set allowed_mime_types = (
         select array_agg(distinct m order by m)
           from unnest(
             coalesce(allowed_mime_types, '{}'::text[])
             || array['audio/vnd.wave', 'audio/wave', 'audio/x-flac', 'audio/x-aac', 'audio/mp3']
           ) as m
       )
     where id = 'tracks-media'
       -- NULL means "no allowlist, accept everything". Merging into it would shrink that
       -- to these five aliases and refuse every MP3, MP4 and JPEG, for every app version.
       and allowed_mime_types is not null;
  end if;
end $$;
