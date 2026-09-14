-- ============================================================================
-- tracks-media: accept AIFF
-- ============================================================================
--
-- The bucket allowlist is the only server-side upload validation available without an API
-- tier (ADR-0004), and it did not include AIFF. WAV and FLAC were there; AIFF was simply
-- missed when the list was first written.
--
-- That gap is now load-bearing rather than theoretical. The web uploader deliberately
-- accepts AIFF at the client — `web/src/upload/files.ts` matches `.aiff?` by extension
-- specifically because browsers routinely report an EMPTY `File.type` for it, and silently
-- dropping an artist's master because Chrome would not name its MIME type is the worst
-- available response for a client aimed at people who work in AIFF. So the file was being
-- queued, uploaded, and then rejected by storage at the end of the transfer.
--
-- Both spellings are required. `audio/aiff` is what most tools emit; `audio/x-aiff` is the
-- older registration and is what macOS and some browsers report. Accepting only one would
-- reject roughly half of real files while appearing to support the format.
--
-- `.aifc` (compressed AIFF) shares both MIME types, so it is admitted by the same entries.
-- That is intentional and harmless — the engine decodes it the same way.
--
-- NOTE ON SIZE, since AIFF is uncompressed like WAV: a 4-minute 24-bit/48k AIFF is roughly
-- 70 MB, so it fits the current 500 MB ceiling comfortably. A long-form or 96k file will
-- not, and that is the ceiling ADR-0015 decision 5 raises to 2 GB. This migration does not
-- touch it — widening a format allowlist and raising a size limit are separate decisions
-- with separate consequences for storage cost.

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
             || array['audio/aiff', 'audio/x-aiff']
           ) as m
       )
     where id = 'tracks-media';
  end if;
end $$;
