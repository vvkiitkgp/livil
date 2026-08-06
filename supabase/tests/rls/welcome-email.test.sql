-- Welcome email — the send-exactly-once property, and who may touch the ledger.
--
-- The email itself is composed in the edge function and is not testable here. What IS
-- testable, and what a wrong change silently breaks, is the claim: every account is owed
-- at most one welcome, both clients ask for it on every launch, and the DATABASE is the
-- only thing standing between "asked five times" and five emails.
--
-- These assert the properties, not the statements:
--   * exactly one caller wins a claim
--   * an account that predates the feature never wins one
--   * a failed send may be retried, but only after a cooldown and only so many times
--   * a caller can neither read the ledger nor mark another account's welcome as sent
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/welcome-email.test.sql
--
-- Runs after every migration, in the same ephemeral Postgres as authorization.test.sql.

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

-- Reports whether the database allowed the statement at all. Only privilege denial is
-- caught, so a test cannot pass because of an unrelated error.
create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when insufficient_privilege then return false;
end $$;

-- The 15-minute cooldown is real time. Rather than wait, age the row — which is exactly
-- what the cooldown reads.
create or replace function pg_temp.age_claim(uid uuid, minutes int)
returns void language sql as $$
  update public.welcome_emails set claimed_at = now() - make_interval(mins => minutes)
   where user_id = uid;
$$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- NEW is created after the migration ran, so it has no ledger row and is owed a welcome.
-- OLD stands in for an account that existed when the migration applied: the backfill
-- could not see it (it is inserted here, later), so the suppression is written by hand to
-- reproduce the state the backfill produces in production.
insert into auth.users (id, email) values
  ('fe000000-0000-0000-0000-00000000000a'::uuid, 'new@example.invalid'),
  ('fe000000-0000-0000-0000-00000000000b'::uuid, 'old@example.invalid'),
  ('fe000000-0000-0000-0000-00000000000c'::uuid, 'other@example.invalid');

insert into public.welcome_emails (user_id, claimed_at, attempts, suppressed_at)
values ('fe000000-0000-0000-0000-00000000000b'::uuid, now(), 0, now());

-- ── The ledger is not client-readable ───────────────────────────────────────
--
-- Asserted through RLS (zero rows visible) rather than through the migration's
-- `revoke all on table ... from authenticated`, ON PURPOSE. The CI harness issues
-- `grant all on all tables in schema public to authenticated` after the migrations run,
-- so a privilege-based assertion would pass in production and fail here — measuring the
-- harness, not the perimeter. RLS with no policies is the guarantee that survives both.
set local role authenticated;
select pg_temp.assert(
  'a signed-in client sees no rows in welcome_emails, though rows exist',
  (select count(*) = 0 from public.welcome_emails), true);
select pg_temp.assert(
  'a signed-in client cannot write to welcome_emails',
  pg_temp.allows($$insert into public.welcome_emails (user_id) values ('fe000000-0000-0000-0000-00000000000a'::uuid)$$),
  false);
reset role;

-- ── Exactly one claim per account ───────────────────────────────────────────
select pg_temp.set_user('fe000000-0000-0000-0000-00000000000a'::uuid);
set local role authenticated;

select pg_temp.assert(
  'a fresh account wins its first claim',
  public.welcome_email_claim(), true);

select pg_temp.assert(
  'the same account immediately loses a second claim',
  public.welcome_email_claim(), false);

-- The successful outcome closes the row for good.
select public.welcome_email_mark(null);
reset role;
select pg_temp.age_claim('fe000000-0000-0000-0000-00000000000a'::uuid, 60);
set local role authenticated;

select pg_temp.assert(
  'a sent welcome is never claimed again, however much time passes',
  public.welcome_email_claim(), false);
reset role;

select pg_temp.assert(
  'a successful mark records sent_at',
  (select sent_at is not null from public.welcome_emails
    where user_id = 'fe000000-0000-0000-0000-00000000000a'::uuid), true);

-- ── Accounts that predate the feature are never mailed ──────────────────────
select pg_temp.set_user('fe000000-0000-0000-0000-00000000000b'::uuid);
set local role authenticated;
select pg_temp.assert(
  'a suppressed (pre-existing) account never wins a claim',
  public.welcome_email_claim(), false);
reset role;
select pg_temp.age_claim('fe000000-0000-0000-0000-00000000000b'::uuid, 60);
set local role authenticated;
select pg_temp.assert(
  'suppression does not expire with the cooldown',
  public.welcome_email_claim(), false);
reset role;

-- ── A failed send is retryable, with a cooldown and a cap ───────────────────
select pg_temp.set_user('fe000000-0000-0000-0000-00000000000c'::uuid);
set local role authenticated;

select pg_temp.assert('attempt 1 wins', public.welcome_email_claim(), true);
select public.welcome_email_mark('resend 500: boom');

select pg_temp.assert(
  'a retry inside the cooldown is refused',
  public.welcome_email_claim(), false);

-- Every assertion that READS the ledger runs outside the `authenticated` role. RLS hides
-- the row from it (asserted above), so a subquery left inside that role would return
-- NULL and the assertion would report on the wrong thing.
reset role;
select pg_temp.assert(
  'a failure does NOT mark the welcome as sent',
  (select sent_at is null from public.welcome_emails
    where user_id = 'fe000000-0000-0000-0000-00000000000c'::uuid), true);

select pg_temp.age_claim('fe000000-0000-0000-0000-00000000000c'::uuid, 20);
set local role authenticated;
select pg_temp.assert('attempt 2 wins after the cooldown', public.welcome_email_claim(), true);
select public.welcome_email_mark('resend 500: boom');

reset role;
select pg_temp.age_claim('fe000000-0000-0000-0000-00000000000c'::uuid, 20);
set local role authenticated;
select pg_temp.assert('attempt 3 wins after the cooldown', public.welcome_email_claim(), true);
select public.welcome_email_mark('resend 500: boom');

reset role;
select pg_temp.age_claim('fe000000-0000-0000-0000-00000000000c'::uuid, 20);
set local role authenticated;
select pg_temp.assert(
  'a permanently failing address stops being retried at the cap',
  public.welcome_email_claim(), false);

-- ── A caller can only act on their own row ──────────────────────────────────
-- `welcome_email_mark` takes no user id, so the only row it can reach is the caller's.
-- This account marks its own welcome sent; the suppressed stranger must not move.
select public.welcome_email_mark(null);
reset role;

select pg_temp.assert(
  'marking your own welcome does not touch a suppressed stranger',
  (select suppressed_at is not null and sent_at is null from public.welcome_emails
    where user_id = 'fe000000-0000-0000-0000-00000000000b'::uuid), true);

-- An unauthenticated caller has no row to act on and must be refused outright rather
-- than silently claiming on behalf of nobody.
select pg_temp.set_user(null);
set local role authenticated;
do $$
begin
  perform public.welcome_email_claim();
  raise exception 'FAIL  welcome_email_claim allowed an unauthenticated caller';
exception
  when sqlstate '28000' then raise notice 'ok    welcome_email_claim refuses an unauthenticated caller';
end $$;
reset role;

rollback;
