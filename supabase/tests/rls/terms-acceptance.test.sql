-- Terms acceptance — the record has to be trustworthy, so test what it REFUSES.
--
-- The value of terms_acceptances is entirely in what cannot be done to it. Policies
-- stop clients; triggers stop the owner. This asserts both, because the migration
-- claims both, and a claim in a comment is not a guarantee.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/terms-acceptance.test.sql
--
-- Runs after every migration, in the same ephemeral Postgres as authorization.test.sql.
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

-- SECURITY DEFINER so it works whatever role is currently assumed.
--
-- Replacing auth.uid() needs CREATE on schema auth, which `authenticated` does not have.
-- The fixtures above switch to that role and never drop back, so without this the first
-- call fails with "permission denied for schema auth" and aborts the whole file — which
-- is exactly what it did in CI. Same reasoning, and same fix, as credits-accept-decline.
create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql security definer as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
end $$;

-- Only the refusals under test are caught: privilege denial (RLS) and raise_exception
-- (our triggers). Anything else propagates, so a test cannot pass by accident.
create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when insufficient_privilege then return false;
  when raise_exception        then return false;
  -- Section 7's refusal IS a CHECK constraint, so without this the statement it puts
  -- under test raises straight past the handler and aborts the file.
  when check_violation        then return false;
  -- Section 8 tests IDEMPOTENCY, whose refusal is a unique index rather than a policy or
  -- a trigger. Without this the duplicate insert escapes the handler and kills the file.
  when unique_violation       then return false;
end $$;

-- The insert policy and the pin trigger both call auth.uid(), and the trigger is NOT
-- SECURITY DEFINER, so it runs as `authenticated` and needs to reach the schema. Real
-- Supabase grants this; the CI shim does not, so an RLS denial here would otherwise be
-- a missing USAGE in disguise — the exact failure mode the header disclaims.
grant usage on schema auth to authenticated;

-- A SECOND published version, used only by the forgery attempt in section 2. Without
-- it that insert is re-pinned onto (owner, '1.0') — which section 1 has already
-- written — and dies on terms_acceptances_one_per_version before the assertion it
-- exists to make can be reached.
insert into public.terms_versions (version, effective_at, url, sha256)
values ('0.9', '2026-09-01T00:00:00Z', 'https://livil-music.com/terms.html', repeat('a', 64)),
       ('0.8', '2026-08-01T00:00:00Z', 'https://livil-music.com/terms.html', repeat('b', 64))
on conflict (version) do nothing;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'other@example.com')
on conflict (id) do nothing;

set local role authenticated;
select pg_temp.set_user('aaaaaaaa-0000-0000-0000-000000000001');

-- ── 1. A user may record their own acceptance ───────────────────────────────
select pg_temp.assert(
  'own acceptance is allowed',
  pg_temp.allows($$
    insert into public.terms_acceptances (user_id, version, source)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '1.0', 'signup')
  $$),
  true);

-- ── 2. user_id cannot be forged ─────────────────────────────────────────────
-- The insert policy pins user_id to auth.uid(). Even if it slipped through, the
-- BEFORE INSERT trigger overwrites it — so this asserts the OUTCOME, which is what
-- actually matters: no row exists attributing an acceptance to someone else.
-- `perform` is PL/pgSQL only; at psql top level it is a syntax error. The result is
-- discarded on purpose — whether the write is refused outright or silently re-pinned
-- is not the claim; the claim is the assertion below, that no such row exists.
select pg_temp.allows($$
  insert into public.terms_acceptances (user_id, version, source)
  values ('bbbbbbbb-0000-0000-0000-000000000002', '0.9', 'reaccept')
$$);

select pg_temp.assert(
  'no acceptance can be attributed to another user',
  exists (
    select 1 from public.terms_acceptances
    where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'
  ),
  false);

-- ── 3. accepted_at is the server's, not the client's ────────────────────────
-- Without the pinning trigger a client could date an acceptance to any moment it
-- liked, which would make the "when" in the record worthless.
--
-- This has to SUPPLY a backdated accepted_at to mean anything. The original asserted
-- that no backdated row existed without any statement ever offering one, so it held
-- with the trigger dropped — a test that cannot fail. The second assertion is what
-- keeps the first honest: it pins that the row was written at all, so "no backdated
-- row" cannot be satisfied by there being no row.
select pg_temp.allows($$
  insert into public.terms_acceptances (user_id, version, source, accepted_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '0.8', 'reaccept',
          timestamptz '2020-01-01 00:00:00Z')
$$);

select pg_temp.assert(
  'a client-supplied accepted_at is overwritten',
  exists (
    select 1 from public.terms_acceptances
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and version = '0.8'
      and accepted_at < now() - interval '1 day'
  ),
  false);

select pg_temp.assert(
  'and that row was written, stamped with the server clock',
  exists (
    select 1 from public.terms_acceptances
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and version = '0.8'
      and accepted_at > now() - interval '1 minute'
  ),
  true);

-- ── 4. Append-only: no client may edit or delete ────────────────────────────
-- The refusal here is SILENT, and that is the subtlety. With RLS enabled and no UPDATE
-- or DELETE policy, no row QUALIFIES — so the statement succeeds against zero rows
-- instead of raising, and `allows` correctly reports true. Asserting false against it,
-- as this section originally did, could never have passed. The property that matters is
-- the outcome, so assert that: the record is still there, still saying what it said.
-- Mutates `source`, not `version`: by this point the owner holds a row for every
-- published version, so an edit to `version` would collide on
-- terms_acceptances_one_per_version and abort the file with a constraint error instead
-- of failing the assertion below. A guard that has been removed should read as a FAIL,
-- not as a crash.
select pg_temp.allows($$
  update public.terms_acceptances set source = 'reaccept'
  where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    and version = '1.0'
$$);

select pg_temp.assert(
  'a user cannot edit their own acceptance',
  exists (
    select 1 from public.terms_acceptances
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and version = '1.0'
      and source  = 'signup'
  ),
  true);

select pg_temp.allows($$
  delete from public.terms_acceptances
  where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
$$);

select pg_temp.assert(
  'a user cannot delete their own acceptance',
  exists (
    select 1 from public.terms_acceptances
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  ),
  true);

-- ── 5. Nobody reads anybody else's ──────────────────────────────────────────
select pg_temp.set_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.assert(
  'acceptances are not readable across users',
  exists (
    select 1 from public.terms_acceptances
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  ),
  false);

-- ── 6. The catalogue is immutable, to the OWNER too ─────────────────────────
-- The point of the triggers: RLS would not have stopped this role.
reset role;

select pg_temp.assert(
  'the table owner cannot edit an acceptance',
  pg_temp.allows($$
    update public.terms_acceptances set version = '0.9' where version = '1.0'
  $$),
  false);

select pg_temp.assert(
  'the table owner cannot rewrite a published version hash',
  pg_temp.allows($$
    update public.terms_versions set sha256 = repeat('0', 64) where version = '1.0'
  $$),
  false);

select pg_temp.assert(
  'the table owner cannot delete a published version',
  pg_temp.allows($$
    delete from public.terms_versions where version = '1.0'
  $$),
  false);

-- ── 7. A placeholder hash cannot be stored ──────────────────────────────────
select pg_temp.assert(
  'a non-sha256 hash is rejected',
  pg_temp.allows($$
    insert into public.terms_versions (version, effective_at, url, sha256)
    values ('9.9', now(), 'https://example.com', 'PENDING')
  $$),
  false);

-- ── 8. The per-upload streaming grant ──────────────────────────────────────
--
-- `source='upload'` was reserved from the beginning, with three stated preconditions: the
-- value, a track_id, and a unique index. The fourth thing the original header could not
-- do was pin the track — the server has no way to know which one was meant — so a client
-- could have logged a confirmation naming somebody else's upload. That is what section 3
-- of 20260923030000 closes, and it is what these assert.
set local role postgres;
-- This file's own fixtures create auth.users but no profiles, and `tracks.uploader_id`
-- references profiles.
insert into public.profiles (id, username) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'ta_owner'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'ta_other')
on conflict (id) do nothing;

insert into public.tracks (id, uploader_id, title, media_kind, audio_url)
values ('0a1c0000-0000-0000-0000-00000000c001', 'aaaaaaaa-0000-0000-0000-000000000001',
        'mine', 'audio', 'https://example.test/mine.mp3'),
       ('0a1c0000-0000-0000-0000-00000000c002', 'bbbbbbbb-0000-0000-0000-000000000002',
        'theirs', 'audio', 'https://example.test/theirs.mp3')
on conflict (id) do nothing;

set local role authenticated;
select pg_temp.set_user('aaaaaaaa-0000-0000-0000-000000000001');

select pg_temp.assert(
  'an uploader can grant the streaming licence for their own track',
  pg_temp.allows($$
    insert into public.terms_acceptances (user_id, version, source, track_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '1.0', 'upload',
            '0a1c0000-0000-0000-0000-00000000c001')
  $$),
  true);

-- THE HOLE THE BOARD NAMED. Without the verify trigger this succeeds, and the table ends
-- up holding a confirmation about a track the confirmer has nothing to do with.
select pg_temp.assert(
  'nobody can grant a licence for SOMEBODY ELSE''S track',
  pg_temp.allows($$
    insert into public.terms_acceptances (user_id, version, source, track_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '1.0', 'upload',
            '0a1c0000-0000-0000-0000-00000000c002')
  $$),
  false);

-- An 'upload' row with no track names nothing, which is the unbounded row type the
-- original header refused to admit early.
select pg_temp.assert(
  'an upload grant must name a track',
  pg_temp.allows($$
    insert into public.terms_acceptances (user_id, version, source)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '1.0', 'upload')
  $$),
  false);

select pg_temp.assert(
  'a signup acceptance must NOT name a track',
  pg_temp.allows($$
    insert into public.terms_acceptances (user_id, version, source, track_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '0.9', 'signup',
            '0a1c0000-0000-0000-0000-00000000c001')
  $$),
  false);

-- Idempotent: a retry after a timeout that actually succeeded is not a second grant.
select pg_temp.assert(
  'the same grant twice is refused by the unique index',
  pg_temp.allows($$
    insert into public.terms_acceptances (user_id, version, source, track_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '1.0', 'upload',
            '0a1c0000-0000-0000-0000-00000000c001')
  $$),
  false);

-- THE RULING THE ORIGINAL MIGRATION DEFERRED TO THE BOARD: deleting a track must not
-- destroy its attestation. `on delete set null` cannot deliver that — it runs as an
-- UPDATE, which the append-only trigger vetoes, aborting the parent delete — and CASCADE
-- would destroy the record at the moment somebody most wants it gone. So: no FK at all.
set local role postgres;
select pg_temp.assert(
  'deleting the track still works',
  pg_temp.allows($$
    delete from public.tracks where id = '0a1c0000-0000-0000-0000-00000000c001'
  $$),
  true);

select pg_temp.assert(
  'and the grant SURVIVES the track it describes',
  exists (
    select 1 from public.terms_acceptances
     where source = 'upload' and track_id = '0a1c0000-0000-0000-0000-00000000c001'
  ),
  true);

rollback;
