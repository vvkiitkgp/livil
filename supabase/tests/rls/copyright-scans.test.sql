-- Copyright scans — a verdict nobody can forge, and an answer only its owner can give.
--
-- The whole value of this table rests on two asymmetries:
--
--   1. The PROVIDER's half must be unwritable by any client. A `match_found` the
--      uploader could set is not evidence of anything, since the uploader is precisely
--      the party whose interest it may cut against.
--   2. The UPLOADER's half must be writable by exactly one person, once.
--
-- Policies deliver (1) by having no INSERT policy at all. They cannot deliver (2): an
-- UPDATE policy scoped to the owner still permits `set match_found = false`, because a
-- policy cannot say "these columns only". A trigger does that, so the trigger is tested
-- here rather than trusted.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/copyright-scans.test.sql
--
-- NOTE ON WHY A DENIAL HERE PROVES SOMETHING: CI grants every table privilege to
-- `authenticated` before these run, so a refusal cannot be a missing GRANT in disguise.

\set ON_ERROR_STOP on
begin;

-- ── Harness ─────────────────────────────────────────────────────────────────
create or replace function pg_temp.assert(label text, actual boolean, expected boolean)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL  %  (expected %, got %)', label, expected, actual;
  end if;
  raise notice 'ok    %', label;
end $$;

-- SECURITY DEFINER for the same reason as terms-acceptance.test.sql: replacing
-- auth.uid() needs CREATE on schema auth, which `authenticated` does not have, and the
-- fixtures switch to that role and never drop back.
create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql security definer as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
end $$;

create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when insufficient_privilege then return false;
  when raise_exception        then return false;
  when check_violation        then return false;
end $$;

-- The guard trigger calls auth.uid(). Real Supabase grants this; the CI shim does not,
-- so an RLS denial would otherwise be a missing USAGE in disguise.
grant usage on schema auth to authenticated;

-- The guard's privileged bypass tests `auth.role() = 'service_role'`. The CI shim
-- hardcodes that function to return 'authenticated', so without this helper section 15
-- would take the CLIENT path and be refused for the wrong reason — which is exactly the
-- "passes vacuously" failure this file is supposed to be immune to.
create or replace function pg_temp.set_role_claim(r text)
returns void language plpgsql security definer as $$
begin
  execute format('create or replace function auth.role() returns text language sql stable as $f$ select %L::text $f$', r);
end $$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'uploader@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'stranger@example.com')
on conflict (id) do nothing;

insert into public.profiles (id, username)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'uploader_cs'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'stranger_cs')
on conflict (id) do nothing;

insert into public.tracks (id, uploader_id, title, media_kind, audio_url)
values ('cccccccc-0000-0000-0000-000000000003'::uuid,
        'aaaaaaaa-0000-0000-0000-000000000001',
        'A track', 'audio', 'https://example.test/a.mp3')
on conflict (id) do nothing;

-- A second track still holding its placeholder, for the section 0 transition test.
insert into public.tracks (id, uploader_id, title, media_kind, audio_url)
values ('eeeeeeee-0000-0000-0000-000000000005'::uuid,
        'aaaaaaaa-0000-0000-0000-000000000001',
        'Still uploading', 'audio', 'pending://placeholder')
on conflict (id) do nothing;

-- Written as the table owner, standing in for the edge function — which is the ONLY
-- writer in production. If a client could produce this row the rest of the file would
-- be testing a formality.
insert into public.track_copyright_scans
  (id, track_id, provider, scanned_media_url, status, match_found, matched_title, matched_artist)
values ('dddddddd-0000-0000-0000-000000000004'::uuid,
        'cccccccc-0000-0000-0000-000000000003'::uuid,
        'audd', 'https://example.test/a.mp3', 'complete', true, 'Kesariya', 'Arijit Singh')
on conflict (id) do nothing;

-- A SECOND scan, deliberately left UNANSWERED. Sections 13-15 need a row whose
-- acknowledgement is still null: once a row is answered the guard refuses every update
-- on that ground alone, so re-using the first row there would assert nothing about the
-- column rules it is meant to test.
insert into public.track_copyright_scans
  (id, track_id, provider, scanned_media_url, status, match_found)
values ('ffffffff-0000-0000-0000-000000000006'::uuid,
        'eeeeeeee-0000-0000-0000-000000000005'::uuid,
        'audd', 'pending://placeholder', 'complete', true)
on conflict (id) do nothing;

set local role authenticated;
select pg_temp.set_user('aaaaaaaa-0000-0000-0000-000000000001');

-- ── 1. The uploader sees their own scan ─────────────────────────────────────
select pg_temp.assert(
  'uploader can read their own scan',
  exists (select 1 from public.track_copyright_scans
          where track_id = 'cccccccc-0000-0000-0000-000000000003'::uuid),
  true);

-- ── 2. Nobody else does ─────────────────────────────────────────────────────
-- A scan names a commercial recording an upload resembles. That is a statement about
-- somebody's work and is nobody else's business.
select pg_temp.set_user('bbbbbbbb-0000-0000-0000-000000000002');

select pg_temp.assert(
  'a stranger cannot read the scan',
  exists (select 1 from public.track_copyright_scans
          where track_id = 'cccccccc-0000-0000-0000-000000000003'::uuid),
  false);

-- ── 3. A stranger cannot answer it either ───────────────────────────────────
-- RLS makes the row invisible, so the UPDATE matches nothing rather than being
-- refused. The assertion is therefore on the OUTCOME: the answer is still unset.
select pg_temp.allows($$
  update public.track_copyright_scans set acknowledgement = 'owner'
  where track_id = 'cccccccc-0000-0000-0000-000000000003'::uuid
$$);

select pg_temp.set_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert(
  'a stranger cannot acknowledge somebody else''s scan',
  exists (select 1 from public.track_copyright_scans
          where id = 'dddddddd-0000-0000-0000-000000000004'::uuid
            and acknowledgement is not null),
  false);

-- ── 4. THE CENTRAL ONE: a client cannot manufacture a verdict ───────────────
-- Without this the feature is theatre: anyone could write themselves a clean scan and
-- the stored record would mean nothing.
select pg_temp.allows($$
  insert into public.track_copyright_scans (track_id, provider, scanned_media_url, status, match_found)
  values ('cccccccc-0000-0000-0000-000000000003'::uuid, 'forged',
          'https://example.test/a.mp3', 'complete', false)
$$);

select pg_temp.assert(
  'no client can insert a scan verdict',
  exists (select 1 from public.track_copyright_scans where provider = 'forged'),
  false);

-- ── 5. Nor rewrite one ──────────────────────────────────────────────────────
-- The uploader HAS an update policy, so this is the trigger's job, not the policy's.
select pg_temp.assert(
  'the uploader cannot flip match_found',
  pg_temp.allows($$
    update public.track_copyright_scans set match_found = false
    where id = 'dddddddd-0000-0000-0000-000000000004'::uuid
  $$),
  false);

select pg_temp.assert(
  'the uploader cannot rewrite the matched title',
  pg_temp.allows($$
    update public.track_copyright_scans set matched_title = 'My Own Song'
    where id = 'dddddddd-0000-0000-0000-000000000004'::uuid
  $$),
  false);

-- ── 6. Nor delete one ───────────────────────────────────────────────────────
-- No DELETE policy exists. Deleting the TRACK still removes it by cascade, which is
-- deliberate and is not this assertion.
select pg_temp.allows($$
  delete from public.track_copyright_scans
  where id = 'dddddddd-0000-0000-0000-000000000004'::uuid
$$);

select pg_temp.assert(
  'no client can delete a scan',
  exists (select 1 from public.track_copyright_scans
          where id = 'dddddddd-0000-0000-0000-000000000004'::uuid),
  true);

-- ── 7. The uploader CAN answer ──────────────────────────────────────────────
select pg_temp.assert(
  'the uploader can record their acknowledgement',
  pg_temp.allows($$
    update public.track_copyright_scans
    set acknowledgement = 'self_recorded',
        accepted_responsibility = true, granted_streaming_licence = true
    where id = 'dddddddd-0000-0000-0000-000000000004'::uuid
  $$),
  true);

-- Both boxes are required by a database constraint, not by the form. Two clients write
-- this table, so a rule enforced only in a form is enforced on one of them at best.
select pg_temp.assert(
  'a claim with neither consent box is refused',
  pg_temp.allows($$
    update public.track_copyright_scans set acknowledgement = 'self_recorded'
    where id = 'ffffffff-0000-0000-0000-000000000006'::uuid
  $$),
  false);

select pg_temp.assert(
  'a claim with only one consent box is refused',
  pg_temp.allows($$
    update public.track_copyright_scans
    set acknowledgement = 'self_recorded', accepted_responsibility = true
    where id = 'ffffffff-0000-0000-0000-000000000006'::uuid
  $$),
  false);

-- ── 8. The who and the when are the server's ────────────────────────────────
-- Without the pin a device could name somebody else as the person who answered, which
-- is the one field a rights holder would actually rely on.
select pg_temp.assert(
  'acknowledged_by is pinned to the caller',
  exists (select 1 from public.track_copyright_scans
          where id = 'dddddddd-0000-0000-0000-000000000004'::uuid
            and acknowledged_by = 'aaaaaaaa-0000-0000-0000-000000000001'
            and acknowledged_at is not null),
  true);

-- ── 9. And it is answered once ──────────────────────────────────────────────
-- An answer that can be swapped afterwards attests to nothing — the argument the terms
-- acceptance log already makes about its own rows.
select pg_temp.assert(
  'an acknowledgement cannot be overwritten',
  pg_temp.allows($$
    update public.track_copyright_scans
    set acknowledgement = 'permission', claim_grantor = 'x', claim_scope = array['ugc'],
        accepted_responsibility = true, granted_streaming_licence = true
    where id = 'dddddddd-0000-0000-0000-000000000004'::uuid
  $$),
  false);

-- ── 10. The operator view is closed to non-operators ────────────────────────
-- Returns empty rather than raising, like every other ops read, so /studio/ops needs no
-- route guard. Neither fixture user is in ops_users.
select pg_temp.assert(
  'ops_copyright_scans returns nothing to a non-operator',
  exists (select 1 from public.ops_copyright_scans(true)),
  false);

-- ── 11. A failed scan can never look like a clean one ───────────────────────
-- The check constraint, not a convention. If this ever passes, a provider outage
-- silently issues a clean bill of health to every upload made during it.
set local role postgres;
select pg_temp.assert(
  'status=failed with match_found=false is rejected by the database',
  pg_temp.allows($$
    insert into public.track_copyright_scans (track_id, provider, scanned_media_url, status, match_found)
    values ('cccccccc-0000-0000-0000-000000000003'::uuid, 'audd2',
            'https://example.test/a.mp3', 'failed', false)
  $$),
  false);

select pg_temp.assert(
  'status=complete with no verdict is rejected by the database',
  pg_temp.allows($$
    insert into public.track_copyright_scans (track_id, provider, scanned_media_url, status, match_found)
    values ('cccccccc-0000-0000-0000-000000000003'::uuid, 'audd3',
            'https://example.test/a.mp3', 'complete', null)
  $$),
  false);

-- ── 12. THE ONE THE SECURITY REVIEW ADDED: media is frozen ──────────────────
--
-- Without section 0 of the migration the whole feature is theatre. The uploader points
-- audio_url at a harmless file, gets a genuine clean verdict, then points it back at the
-- commercial rip. `tracks_update_own` constrains WHICH ROWS, never WHICH COLUMNS, and
-- there was no trigger on public.tracks at all.
set local role authenticated;
select pg_temp.set_user('aaaaaaaa-0000-0000-0000-000000000001');

select pg_temp.assert(
  'the uploader cannot rewrite a settled audio_url',
  pg_temp.allows($$
    update public.tracks set audio_url = 'https://example.test/swapped.mp3'
    where id = 'cccccccc-0000-0000-0000-000000000003'::uuid
  $$),
  false);

select pg_temp.assert(
  'the uploader cannot null out a settled audio_url',
  pg_temp.allows($$
    update public.tracks set audio_url = null
    where id = 'cccccccc-0000-0000-0000-000000000003'::uuid
  $$),
  false);

-- The freeze must not break the flows that exist. A title edit rewrites the row and
-- leaves the media alone; the finalize step promotes the placeholder exactly once.
select pg_temp.assert(
  'editing the title is unaffected by the freeze',
  pg_temp.allows($$
    update public.tracks set title = 'A better title'
    where id = 'cccccccc-0000-0000-0000-000000000003'::uuid
  $$),
  true);

select pg_temp.assert(
  'the placeholder may be promoted to a real url exactly once',
  pg_temp.allows($$
    update public.tracks set audio_url = 'https://example.test/final.mp3'
    where id = 'eeeeeeee-0000-0000-0000-000000000005'::uuid
  $$),
  true);

select pg_temp.assert(
  'and not a second time',
  pg_temp.allows($$
    update public.tracks set audio_url = 'https://example.test/again.mp3'
    where id = 'eeeeeeee-0000-0000-0000-000000000005'::uuid
  $$),
  false);

-- ── 13. The uploader cannot rotate the scan's primary key ───────────────────
-- The first draft's column denylist omitted `id`. Operators see this id, so anything
-- keyed on it could be invalidated after the fact by its own subject.
select pg_temp.assert(
  'the uploader cannot change a scan id',
  pg_temp.allows($$
    update public.track_copyright_scans
    set id = '99999999-0000-0000-0000-000000000009'::uuid
    where id = 'ffffffff-0000-0000-0000-000000000006'::uuid
  $$),
  false);

-- ── 14. A new column is denied by default ───────────────────────────────────
-- The guard compares whole rows as jsonb rather than listing columns, so a future
-- ALTER TABLE ... ADD COLUMN is refused rather than silently writable. Asserted against
-- a real added column so this cannot pass vacuously.
set local role postgres;
alter table public.track_copyright_scans add column if not exists probe_col text;
set local role authenticated;
select pg_temp.set_user('aaaaaaaa-0000-0000-0000-000000000001');

select pg_temp.assert(
  'a column added after this migration is not writable by the uploader',
  pg_temp.allows($$
    update public.track_copyright_scans set probe_col = 'x'
    where id = 'ffffffff-0000-0000-0000-000000000006'::uuid
  $$),
  false);

set local role postgres;
alter table public.track_copyright_scans drop column if exists probe_col;

-- ── 15. Even the privileged writer cannot downgrade a match ─────────────────
-- Media is frozen, so a re-scan examines the same bytes. A later "no match" over an
-- earlier match is a provider disagreeing with itself, not new information.
select pg_temp.set_role_claim('service_role');

select pg_temp.assert(
  'the privileged writer cannot downgrade a recorded match',
  pg_temp.allows($$
    update public.track_copyright_scans set match_found = false, status = 'complete'
    where id = 'ffffffff-0000-0000-0000-000000000006'::uuid
  $$),
  false);

-- ...and the bypass itself works, so the assertion above is about the downgrade rule
-- rather than about the writer being blocked outright.
select pg_temp.assert(
  'the privileged writer may still update the provider half',
  pg_temp.allows($$
    update public.track_copyright_scans set matched_artist = 'Arijit Singh'
    where id = 'ffffffff-0000-0000-0000-000000000006'::uuid
  $$),
  true);

select pg_temp.set_role_claim('authenticated');

-- ── 16. The declaration must be a claim, not a click ───────────────────────
--
-- The first real test of this feature published a commercial track on a single tap with
-- nothing recorded that a reviewer could assess. These constraints are what make
-- "I have permission" mean something. They live in the DATABASE because two clients write
-- this table, so a required field enforced in a form is enforced on one of them at best.
set local role postgres;
select pg_temp.set_role_claim('authenticated');

-- Four more unanswered scans, one per path. Same track, different providers: the unique
-- index is (track_id, provider), and an answered row refuses every later update on the
-- "already answered" ground, which would mask what these are testing.
insert into public.track_copyright_scans
  (id, track_id, provider, scanned_media_url, status, match_found)
values
  ('a1000000-0000-0000-0000-000000000001'::uuid, 'cccccccc-0000-0000-0000-000000000003'::uuid,
   'test_owner', 'https://example.test/a.mp3', 'complete', true),
  ('a1000000-0000-0000-0000-000000000002'::uuid, 'cccccccc-0000-0000-0000-000000000003'::uuid,
   'test_perm', 'https://example.test/a.mp3', 'complete', true),
  ('a1000000-0000-0000-0000-000000000003'::uuid, 'cccccccc-0000-0000-0000-000000000003'::uuid,
   'test_self', 'https://example.test/a.mp3', 'complete', true),
  ('a1000000-0000-0000-0000-000000000004'::uuid, 'cccccccc-0000-0000-0000-000000000003'::uuid,
   'test_disputed', 'https://example.test/a.mp3', 'complete', true)
on conflict (id) do nothing;

set local role authenticated;
select pg_temp.set_user('aaaaaaaa-0000-0000-0000-000000000001');

-- Refusals first: a rejected update writes nothing, so these leave the rows unanswered.
select pg_temp.assert(
  'an ownership claim with no basis is refused',
  pg_temp.allows($$
    update public.track_copyright_scans set acknowledgement = 'owner'
    where id = 'a1000000-0000-0000-0000-000000000001'::uuid
  $$),
  false);

select pg_temp.assert(
  'a permission claim naming nobody is refused',
  pg_temp.allows($$
    update public.track_copyright_scans
    set acknowledgement = 'permission', claim_scope = array['streaming']
    where id = 'a1000000-0000-0000-0000-000000000002'::uuid
  $$),
  false);

select pg_temp.assert(
  'a permission claim with no scope is refused',
  pg_temp.allows($$
    update public.track_copyright_scans
    set acknowledgement = 'permission', claim_grantor = 'Saregama'
    where id = 'a1000000-0000-0000-0000-000000000002'::uuid
  $$),
  false);

select pg_temp.assert(
  'a permission claim with an empty scope array is refused',
  pg_temp.allows($$
    update public.track_copyright_scans
    set acknowledgement = 'permission', claim_grantor = 'Saregama',
        claim_scope = array[]::text[]
    where id = 'a1000000-0000-0000-0000-000000000002'::uuid
  $$),
  false);

-- Fields belong to their own path, or the row describes a combination nobody chose.
select pg_temp.assert(
  'a grantor on an ownership claim is refused',
  pg_temp.allows($$
    update public.track_copyright_scans
    set acknowledgement = 'owner', claim_basis = 'created', claim_grantor = 'Saregama'
    where id = 'a1000000-0000-0000-0000-000000000001'::uuid
  $$),
  false);

-- Now the accepted shapes.
select pg_temp.assert(
  'an ownership claim with a basis is accepted',
  pg_temp.allows($$
    update public.track_copyright_scans
    set acknowledgement = 'owner', claim_basis = 'assigned', accepted_responsibility = true, granted_streaming_licence = true
    where id = 'a1000000-0000-0000-0000-000000000001'::uuid
  $$),
  true);

select pg_temp.assert(
  'a permission claim naming a grantor and a scope is accepted',
  pg_temp.allows($$
    update public.track_copyright_scans
    set acknowledgement = 'permission', claim_grantor = 'Saregama',
        claim_scope = array['streaming','ugc'], claim_reference = 'INH102506955', accepted_responsibility = true, granted_streaming_licence = true
    where id = 'a1000000-0000-0000-0000-000000000002'::uuid
  $$),
  true);

-- A bedroom artist has no label, no registration and no ISRC, and can still legitimately
-- own their recording. These two paths must ask for nothing at all.
select pg_temp.assert(
  'a self-recorded claim needs no paperwork',
  pg_temp.allows($$
    update public.track_copyright_scans set acknowledgement = 'self_recorded', accepted_responsibility = true, granted_streaming_licence = true
    where id = 'a1000000-0000-0000-0000-000000000003'::uuid
  $$),
  true);

select pg_temp.assert(
  'a disputed match needs no paperwork',
  pg_temp.allows($$
    update public.track_copyright_scans
    set acknowledgement = 'disputed', claim_note = 'this is my own song', accepted_responsibility = true, granted_streaming_licence = true
    where id = 'a1000000-0000-0000-0000-000000000004'::uuid
  $$),
  true);

-- ── 17. The reference cross-check ──────────────────────────────────────────
-- An ISRC identifies a RECORDING. The only question it answers for an operator is
-- whether the claimant is even discussing the recording we matched, so that comparison
-- is computed rather than left for someone to eyeball two strings.
select pg_temp.assert(
  'a claimed reference is stored verbatim for the operator to compare',
  exists (
    select 1 from public.track_copyright_scans
    where id = 'a1000000-0000-0000-0000-000000000002'::uuid
      and claim_reference = 'INH102506955'
  ),
  true);

rollback;
