-- ============================================================================
-- Storage: restore write policies, and put bucket config under version control
-- ============================================================================
--
-- THE DEFECT — observed, not inferred.
--
--   tus: unexpected response while creating upload ... response code: 403,
--   response text: new row violates row-level security policy
--
-- Verified against production on 2026-08-04:
--
--   storage.objects            RLS enabled = true, policies = 0
--   storage.buckets            RLS enabled = true, policies = 0
--   objects in 'tracks-media'  21, every row created_at 2026-07-07
--   objects in 'avatars'        2, every row created_at 2026-07-07
--
-- 2026-07-07 is the Sydney -> Mumbai project migration. Every object in production
-- predates it or arrived with it. **No upload has succeeded from ANY client since that
-- date** — this is not a web-client defect, it is a production outage roughly four weeks
-- old that the new client happened to exercise first. Mobile uploads fail the same way;
-- nobody noticed because the failure is a toast on a screen that is not used daily.
--
-- ROOT CAUSE. RLS is enabled on storage.objects with no policies, so every INSERT is
-- denied by default. The policies existed on the old project and did not come across:
-- storage policies are ordinary RLS policies on a table in the `storage` schema, and the
-- raw pg_dump path used for the migration did not carry them.
--
-- 20260607000001_avatars_bucket.sql defines exactly these policies for `avatars` and its
-- policies are NOT in production either — ADR-0007 recorded that discrepancy, and D-08
-- records why: schema_migrations was empty until 2026-07-21, so migrations in this
-- directory were never the thing being applied.
--
-- WHAT THIS DOES — the plan ratified in ADR-0007:
--
--   1. Declares both buckets INCLUDING public / file_size_limit / allowed_mime_types.
--      That config is the only server-side validation lever available without an API tier
--      (ADR-0004) and it currently lives in an unversioned console blob. Values below are
--      reflected from production as-is, so applying this changes no limit.
--   2. Drops every policy BY NAME before creating any. Policies OR together, so a
--      leftover permissive policy silently defeats a correctly scoped one — the
--      follows_select incident. Blind `create policy` is how that happens.
--   3. Scopes writes to the owner's folder: (storage.foldername(name))[1] = auth.uid().
--      Both clients already write `${userId}/${trackId}/${kind}.${ext}`, so this matches
--      the shipped path layout exactly.
--   4. Leaves reads public. Tightening them breaks every stored URL and is a product
--      decision about media privacy, not a schema one.
--
-- NOT A CONTROL, and deliberately not relied on: `x-upsert: false` is a client-set
-- request header, and `userId` is a client-supplied path segment. The policy is what makes
-- the path segment binding.
--
-- VERIFICATION IS A LIVE PROBE, NOT A MERGE. As user A, attempt to write
-- `B/<trackId>/audio.mp3` and expect a refusal. See ADR-0007.

-- ── Buckets ─────────────────────────────────────────────────────────────────
-- Reflected from production. `tracks-media` keeps its 500 MB ceiling here; raising it to
-- the 2 GB target (ADR-0015 decision 5) becomes an edit to THIS file rather than a console
-- change, which is the point of declaring it.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('tracks-media', 'tracks-media', true)
on conflict (id) do nothing;

-- `file_size_limit` and `allowed_mime_types` are guarded on column existence because CI
-- applies these migrations against a SHIM of the storage schema, not a real Storage
-- install, and the shim has neither column. Production has both. Without the guard the
-- whole migration aborts in CI on a difference that says nothing about correctness.
--
-- This is also the seam where the 2 GB ceiling (ADR-0015 decision 5) gets raised: change
-- the number here, not in the dashboard.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'storage'
       and table_name   = 'buckets'
       and column_name  = 'file_size_limit'
  ) then
    update storage.buckets
       set public = true,
           file_size_limit = 524288000,
           allowed_mime_types = array[
             'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-wav',
             'audio/ogg', 'audio/flac', 'audio/x-m4a', 'audio/webm',
             'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska',
             'image/jpeg', 'image/png', 'image/webp', 'image/heic'
           ]
     where id = 'tracks-media';
  else
    update storage.buckets set public = true where id = 'tracks-media';
  end if;
end $$;

-- avatars carries no size limit and no MIME allowlist in production. Reflected as-is
-- rather than tightened: adding either here would be an unreviewed behaviour change
-- smuggled into an outage fix.
update storage.buckets
   set public = true
 where id = 'avatars';

-- ── Drop by name, always, before creating ───────────────────────────────────
-- Every name this migration creates, plus the names 20260607000001 used, so a re-run or a
-- partially-applied earlier state cannot leave two policies OR-ing together.

drop policy if exists "avatars_public_read"      on storage.objects;
drop policy if exists "avatars_insert_own"       on storage.objects;
drop policy if exists "avatars_update_own"       on storage.objects;
drop policy if exists "avatars_delete_own"       on storage.objects;
drop policy if exists "tracks_media_public_read" on storage.objects;
drop policy if exists "tracks_media_insert_own"  on storage.objects;
drop policy if exists "tracks_media_update_own"  on storage.objects;
drop policy if exists "tracks_media_delete_own"  on storage.objects;

-- ── avatars ─────────────────────────────────────────────────────────────────

create policy "avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── tracks-media ────────────────────────────────────────────────────────────

create policy "tracks_media_public_read"
  on storage.objects for select
  using (bucket_id = 'tracks-media');

create policy "tracks_media_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'tracks-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- UPDATE is required, not optional: a resumable (TUS) upload creates the object and then
-- appends to it chunk by chunk. Without this, an upload dies partway through with the same
-- RLS error it would otherwise have failed with at creation. Mobile's single-request
-- upload never needed it, which is why its absence was invisible until now.
--
-- WITH CHECK mirrors USING so an owner cannot rename a row out of their own folder.
create policy "tracks_media_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'tracks-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'tracks-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE is required by account deletion, which removes the user's own objects from both
-- buckets before calling delete_my_account (see removeOwnedPaths in profileService).
-- Without it that cleanup fails silently and the files outlive the account.
create policy "tracks_media_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'tracks-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
