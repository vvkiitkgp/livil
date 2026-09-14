-- ============================================================================
-- Storage: stop anon enumerating the buckets, and drop-all rather than drop-by-name
-- ============================================================================
--
-- Fixes a regression introduced HOURS earlier by
-- 20260804000000_storage_policies_and_bucket_config.sql, found by security review and
-- then confirmed by probe.
--
-- THE DEFECT — observed, not inferred. With ONLY the published anon key, no user session:
--
--   POST /storage/v1/object/list/tracks-media  {"prefix":"","limit":100}
--     -> ["4e918e23-…","5128529c-…","8b2c821a-…","f5f61f54-…"]
--   POST /storage/v1/object/list/avatars
--     -> ["54b09597-…","8b2c821a-…"]
--
-- Those are every uploader's user id. Recursing gives track ids, filenames, sizes and
-- timestamps. Public *byte* reads never consulted RLS — that is what serves media — but
-- `/object/list` calls storage.search(), a SECURITY INVOKER function that DOES apply RLS.
-- The previous migration wrote `for select using (bucket_id = '…')` with no `TO` clause,
-- which attaches the policy to role `public`, and `anon` is a member of it. Before that
-- migration there were zero policies, so nothing was listable: this was a NEW exposure,
-- not an inherited one.
--
-- It matters most for objects that no readable row points at — orphans left by a failed
-- publish, media from deleted posts. Those are unreleased masters, and enumeration is the
-- difference between "public if you know the URL" and "public, here is the index".
--
-- WHY OWNER-SCOPED RATHER THAN `to authenticated`:
-- `to authenticated` closes the anon hole but still lets any signed-in account enumerate
-- every artist's catalogue. Owner-scoping costs nothing extra here — verified that nothing
-- needs to read another user's object row:
--   * every read path uses getPublicUrl(), which does not consult RLS. Confirmed by probe:
--     GET /object/public/... with NO apikey and NO authorization returned HTTP 200 and
--     150905 bytes. That is also why media kept playing through the four-week outage when
--     there were no policies at all.
--   * there are no createSignedUrl callers anywhere in src/, web/ or shared/.
--   * the only .list() caller is listOwnedPaths (src/services/profileService.ts:303),
--     which starts at root = userId, i.e. inside the caller's own folder.
--   * storage-api's INSERT … RETURNING * needs SELECT on the row being created — that row
--     is in the caller's own folder, so this predicate covers it. Losing that is what
--     produces the misleading "new row violates row-level security policy" on insert.
--
-- DROP-ALL, NOT DROP-BY-NAME. The previous migration dropped eight known names. That is a
-- denylist, and the failure it guards against — follows_select, where a leftover
-- permissive policy ORs with a scoped one — is by definition an UNKNOWN name. Policies
-- created through the dashboard get generated names like
-- `Give users access to own folder 1oj01fe_0` that no migration can predict. Enumerating
-- pg_policies and dropping everything is the only form that actually closes the class.

do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
  loop
    execute format('drop policy %I on storage.objects', pol.policyname);
  end loop;
end $$;

-- ── Reads: owner-scoped. Public byte reads are unaffected; they bypass RLS. ──

create policy "avatars_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "tracks_media_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'tracks-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Writes: unchanged from 20260804000000, recreated after the drop-all. ──

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

create policy "tracks_media_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'tracks-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

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

create policy "tracks_media_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'tracks-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
