-- ============================================================================
-- tracks-media: raise the per-file ceiling to 2 GB
-- ============================================================================
--
-- ADR-0015 decision 5. Deferred until now deliberately: the client constant was held at
-- 500 MB to match the server, because promising 2 GB while the bucket rejected anything past
-- 500 MB fails in the worst possible place — the artist picks a 900 MB master, watches it
-- upload, and gets an opaque server error at the end of the transfer.
--
-- `shared/services/media.ts` moves to 2 GB in the same change.
--
-- TWO LIMITS GOVERN AN UPLOAD, and only this one is in the repository. The project-wide
-- "Global file size limit" in Storage Settings CAPS this value and is console-only config
-- with no migration (ADR-0007). A bucket limit above the global one is silently
-- ineffective — so if large uploads still fail at the server, that is the first thing to
-- check, not this file.
--
-- WHAT THIS COSTS: nothing on its own. A ceiling is not a commitment. Billing follows bytes
-- STORED and, dominating everything else for a music app, bytes SERVED. Current state at the
-- time of this migration: 43 objects, 213 MB total, average track ~10 MB, largest 75 MB.
-- A single 2 GB video played a hundred times is 200 GB of egress — roughly a thousand times
-- the entire library as it stands today.
--
-- The realistic guard is not this number but transcoding: serving listeners a compressed
-- rendition while keeping the master for the artist. There is no transcoding pipeline, so
-- today every listener streams whatever was uploaded, byte for byte.

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'storage' and table_name = 'buckets'
       and column_name = 'file_size_limit'
  ) then
    update storage.buckets
       set file_size_limit = 2147483648  -- 2 GiB
     where id = 'tracks-media';
  end if;
end $$;
