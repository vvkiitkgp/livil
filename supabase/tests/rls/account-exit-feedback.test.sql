-- The optional "why are you leaving?" answer (20261012000000_account_exit_feedback.sql).
--
-- What has to hold:
--   * the answer is stamped with the CALLER, never a supplied id, and one person counts once;
--   * nobody but ops can read it, and nobody can write it except through the function;
--   * it SURVIVES delete_my_account, with the link to the person gone — the phone promises
--     "kept without your name", and the deletion screen promises everything else goes.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/account-exit-feedback.test.sql

\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.assert(label text, actual boolean, expected boolean)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL  %  (expected %, got %)', label, expected, actual;
  end if;
  raise notice 'ok    %', label;
end $$;

-- DISCARD PLANS: is_ops() is STABLE SQL and is inlined into cached plans (see
-- ops-track-review.test.sql).
create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
  discard plans;
end $$;

-- Did the statement fail with the given SQLSTATE?
create or replace function pg_temp.fails_with(stmt text, state text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception when others then
  return sqlstate = state;
end $$;

create or replace function pg_temp.visible_rows()
returns bigint language plpgsql as $$
declare n bigint;
begin
  select count(*) into n from public.account_exit_feedback;
  return n;
exception
  when insufficient_privilege then return -1;
end $$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   NOOR     — signed up 10 days ago, leaving
--   STRANGER — any other signed-in user
--   OPERATOR — in ops_users
insert into auth.users (id, email, created_at) values
  ('e1111111-0000-0000-0000-000000000001', 'noor@example.invalid', now() - interval '10 days'),
  ('e1111111-0000-0000-0000-000000000002', 'stranger@example.invalid', now()),
  ('e1111111-0000-0000-0000-000000000003', 'operator@example.invalid', now())
on conflict do nothing;

insert into profiles (id, username) values
  ('e1111111-0000-0000-0000-000000000001', 'xf_noor'),
  ('e1111111-0000-0000-0000-000000000002', 'xf_stranger'),
  ('e1111111-0000-0000-0000-000000000003', 'xf_operator')
on conflict do nothing;

insert into ops_users (user_id) values ('e1111111-0000-0000-0000-000000000003')
on conflict do nothing;

-- ============================================================================
-- Step 1 — skipping writes nothing
-- ============================================================================
select pg_temp.set_user('e1111111-0000-0000-0000-000000000001');
set local role authenticated;
select public.submit_account_exit_feedback(null, '   ', 'ios');
select public.submit_account_exit_feedback();
reset role;

select pg_temp.assert(
  'an empty answer (no reason, blank note) is a skip — no row',
  (select count(*) = 0 from account_exit_feedback),
  true);

-- ============================================================================
-- Step 2 — an answer is stamped with the caller, trimmed, and aged server-side
-- ============================================================================
select pg_temp.set_user('e1111111-0000-0000-0000-000000000001');
set local role authenticated;
select public.submit_account_exit_feedback('bugs', '  Upload kept failing  ', 'android');
reset role;

select pg_temp.assert(
  'the row belongs to the caller, with the note trimmed and the platform kept',
  (select user_id = 'e1111111-0000-0000-0000-000000000001'
      and reason = 'bugs' and note = 'Upload kept failing' and platform = 'android'
     from account_exit_feedback),
  true);
select pg_temp.assert(
  'the time is stored to the day only, so it cannot be matched to the deletion log',
  (select created_at = date_trunc('day', now()) from account_exit_feedback),
  true);
select pg_temp.assert(
  'account age comes from auth.users, not the client',
  (select account_age_days = 10 from account_exit_feedback),
  true);

-- ============================================================================
-- Step 3 — answering again replaces, so one person counts once
-- ============================================================================
select pg_temp.set_user('e1111111-0000-0000-0000-000000000001');
set local role authenticated;
select public.submit_account_exit_feedback('privacy', null, 'android');
reset role;

select pg_temp.assert(
  'a second answer from the same account replaces the first',
  (select count(*) = 1 and bool_and(reason = 'privacy' and note is null)
     from account_exit_feedback),
  true);

-- ============================================================================
-- Step 4 — the boundaries
-- ============================================================================
select pg_temp.set_user('e1111111-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert(
  'a reason outside the list is rejected by the CHECK',
  pg_temp.fails_with($$select public.submit_account_exit_feedback('made_up', null, 'ios')$$, '23514'),
  true);
select pg_temp.assert(
  'a direct insert is refused — writes go through the function only',
  pg_temp.fails_with(
    $$insert into public.account_exit_feedback (user_id, reason)
      values ('e1111111-0000-0000-0000-000000000001', 'bugs')$$,
    '42501'),
  true);
select pg_temp.assert(
  'a non-ops user reads nothing',
  pg_temp.visible_rows() <= 0,
  true);
reset role;

select pg_temp.set_user(null);
set local role authenticated;
select pg_temp.assert(
  'no session, no answer',
  pg_temp.fails_with($$select public.submit_account_exit_feedback('bugs', null, 'ios')$$, '42501'),
  true);
reset role;

select pg_temp.assert(
  'anon cannot execute the function',
  has_function_privilege('anon', 'public.submit_account_exit_feedback(text, text, text)', 'execute'),
  false);

select pg_temp.set_user('e1111111-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert(
  'ops reads every answer',
  pg_temp.visible_rows() = 1,
  true);
reset role;

-- ============================================================================
-- Step 5 — the answer outlives the account, without the person
-- ============================================================================
select pg_temp.set_user('e1111111-0000-0000-0000-000000000001');
set local role authenticated;
select public.delete_my_account();
reset role;

select pg_temp.assert(
  'the account is gone',
  (select count(*) = 0 from auth.users where id = 'e1111111-0000-0000-0000-000000000001'),
  true);
select pg_temp.assert(
  'the answer survives deletion, unlinked from the person',
  (select count(*) = 1 and bool_and(user_id is null and reason = 'privacy')
     from account_exit_feedback),
  true);

rollback;
\echo 'account-exit-feedback: all assertions passed'
