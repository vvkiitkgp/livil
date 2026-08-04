-- ============================================================================
-- tracks.file_size_bytes — so the dashboard can show size and bitrate
-- ============================================================================
--
-- Neither is stored anywhere today. Size lives only in `storage.objects.metadata`, and
-- bitrate is not stored at all — it is derivable as `size * 8 / duration`, which is why this
-- is one column rather than two.
--
-- WHY A COLUMN RATHER THAN READING STORAGE PER ROW. The obvious alternative is
-- `storage.from(bucket).list()` per track from the client. That is one request per row — 50
-- requests to draw one page of a catalogue, and 200 for an artist with a real back
-- catalogue. It is also a second source of truth for a number the uploader already had in
-- its hand: `PublishAsset.sizeBytes` is known at publish time and currently discarded.
--
-- Mirrors `duration_seconds` deliberately: nullable, written when known, backfilled when it
-- is not, and never blocking a publish. A missing size renders as an em dash rather than a
-- zero, because "0 MB" is a lie and "—" is not.
--
-- bigint, not int: a 2 GB ceiling is 2^31 bytes, which is exactly where int overflows.

alter table public.tracks
  add column if not exists file_size_bytes bigint;

comment on column public.tracks.file_size_bytes is
  'Size of the primary media object (audio_url or video_url) in bytes. Written at publish '
  'from the client''s file handle; backfilled from storage.objects for older rows. Null when '
  'unknown. Bitrate is derived: file_size_bytes * 8 / duration_seconds.';

-- ── Backfill from storage ───────────────────────────────────────────────────
--
-- Objects are stored at `${uploader_id}/${trackId}/${kind}.${ext}` (shared/services/media.ts),
-- so the track id is the second path segment. Only the primary media object counts — cover
-- and thumbnail are excluded, since "how big is this track" means the audio or the video, not
-- the artwork.
--
-- Guarded on the metadata column existing because CI applies migrations against a shim of the
-- storage schema which has no objects table at all. Production has it.

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'storage' and table_name = 'objects' and column_name = 'metadata'
  ) then
    update public.tracks t
       set file_size_bytes = o.size
      from (
        select (storage.foldername(name))[2] as track_id,
               max((metadata->>'size')::bigint) as size
          from storage.objects
         where bucket_id = 'tracks-media'
           and (storage.filename(name)) similar to '(audio|video)\.%'
           and metadata ? 'size'
         group by 1
      ) o
     where t.id::text = o.track_id
       and t.file_size_bytes is null;
  end if;
end $$;
