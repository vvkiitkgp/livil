-- ============================================================================
-- Storage: give `avatars` the server-side limits `tracks-media` already has
-- ============================================================================
--
-- From the security review of PR #124.
--
-- THE GAP. `tracks-media` carries a 17-entry MIME allowlist and a 500 MB ceiling —
-- per ADR-0004 that bucket config is the ONLY server-side validation lever available
-- without an API tier. `avatars` has neither: `allowed_mime_types` and `file_size_limit`
-- are both null.
--
-- So any authenticated user can upload arbitrary content to their own folder in a PUBLIC
-- bucket, at unbounded size, with an attacker-chosen Content-Type:
--
--   upload('<their-uid>/x.html', blob, { contentType: 'text/html' })
--   -> served from /storage/v1/object/public/avatars/<uid>/x.html as text/html
--
-- Today that is phishing-page hosting and storage-cost abuse on a Livil-attributed
-- origin, not cross-user compromise: the dashboard's session lives on its own origin,
-- not on supabase.co. It becomes stored XSS the moment storage is fronted by a custom
-- domain shared with the app, which is a normal thing to do later and would silently
-- convert this from a nuisance into a session-stealing bug.
--
-- This is pre-existing config, and 20260804000000 deliberately reflected it as-is rather
-- than smuggling a behaviour change into an outage fix. That was right. But that same
-- migration is what RESTORED write access to this bucket after four weeks, so the
-- exposure is live again — which makes closing it a follow-up, not a nice-to-have.
--
-- WHY THESE VALUES. `AVATAR_CROP_OPTIONS` in src/services/profileService.ts:14-25 sets
-- `forceJpg: true` at 512x512 and quality 0.8, so the shipped client only ever produces
-- JPEG at well under a megabyte. png/webp/heic are included anyway so a device where
-- forceJpg does not take cannot brick profile photos — the point is to exclude
-- text/html and svg, not to be maximally tight. 10 MB is ~50x the real output.
--
-- svg is excluded deliberately, and for the same reason it is absent from
-- `tracks-media`: image/svg+xml is a script execution context, not a picture.

do $$
begin
  -- Guarded on column existence: CI applies migrations against a SHIM of the storage
  -- schema that has neither column. Same guard as 20260804000000. Both columns are
  -- checked, not just one — a shim carrying only file_size_limit would otherwise abort
  -- here, which is the gap that file's guard left open.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'storage' and table_name = 'buckets'
       and column_name = 'file_size_limit'
  ) and exists (
    select 1 from information_schema.columns
     where table_schema = 'storage' and table_name = 'buckets'
       and column_name = 'allowed_mime_types'
  ) then
    update storage.buckets
       set file_size_limit = 10485760,  -- 10 MB
           allowed_mime_types = array[
             'image/jpeg', 'image/png', 'image/webp', 'image/heic'
           ]
     where id = 'avatars';
  end if;
end $$;
