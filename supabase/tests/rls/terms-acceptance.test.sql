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

create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql as $$
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
end $$;

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
perform pg_temp.allows($$
  insert into public.terms_acceptances (user_id, version, source)
  values ('bbbbbbbb-0000-0000-0000-000000000002', '1.0', 'reaccept')
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
select pg_temp.assert(
  'a client-supplied accepted_at is overwritten',
  exists (
    select 1 from public.terms_acceptances
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and accepted_at < now() - interval '1 day'
  ),
  false);

-- ── 4. Append-only: no client may edit or delete ────────────────────────────
select pg_temp.assert(
  'a user cannot edit their own acceptance',
  pg_temp.allows($$
    update public.terms_acceptances set version = '0.9'
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  $$),
  false);

select pg_temp.assert(
  'a user cannot delete their own acceptance',
  pg_temp.allows($$
    delete from public.terms_acceptances
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  $$),
  false);

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

rollback;
