-- last_seen is ops-only (20260925010000_last_seen_is_ops_only.sql).
--
-- THE DEFECT. profiles.last_seen_at was readable row-wide by every signed-in user, so a
-- stranger could tell whether someone had the app open in the last few minutes — and
-- the Play Store build still renders it as "Online". Product rule: whether someone has
-- the app open is never indicated to other users. Step 1 is that exact read.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/last-seen-ops-only.test.sql

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

-- Rows of user_last_seen visible to the CURRENT role; -1 if the read is refused
-- outright. Either way "nothing readable" is <= 0.
create or replace function pg_temp.visible_last_seen()
returns bigint language plpgsql as $$
declare n bigint;
begin
  select count(*) into n from public.user_last_seen;
  return n;
exception
  when insufficient_privilege then return -1;
end $$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   RIYA     — has the app open (writes a heartbeat)
--   STRANGER — any other signed-in user
--   OPERATOR — in ops_users
insert into auth.users (id, email) values
  ('f1111111-0000-0000-0000-000000000001', 'riya@example.invalid'),
  ('f1111111-0000-0000-0000-000000000002', 'stranger@example.invalid'),
  ('f1111111-0000-0000-0000-000000000003', 'operator@example.invalid')
on conflict do nothing;

insert into profiles (id, username) values
  ('f1111111-0000-0000-0000-000000000001', 'ls_riya'),
  ('f1111111-0000-0000-0000-000000000002', 'ls_stranger'),
  ('f1111111-0000-0000-0000-000000000003', 'ls_operator')
on conflict do nothing;

insert into ops_users (user_id) values ('f1111111-0000-0000-0000-000000000003')
on conflict do nothing;

-- ============================================================================
-- Step 1 — the Play Store build's heartbeat: a direct UPDATE of profiles
-- ============================================================================
select pg_temp.set_user('f1111111-0000-0000-0000-000000000001');
set local role authenticated;
update profiles set last_seen_at = now()
  where id = 'f1111111-0000-0000-0000-000000000001';
reset role;

select pg_temp.set_user('f1111111-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert(
  'a stranger reads NULL for profiles.last_seen_at after the old-build heartbeat',
  (select last_seen_at is null from profiles where id = 'f1111111-0000-0000-0000-000000000001'),
  true);
select pg_temp.assert(
  'a stranger cannot read user_last_seen at all',
  pg_temp.visible_last_seen() <= 0,
  true);
reset role;

select pg_temp.assert(
  '…but the old-build heartbeat was redirected into user_last_seen (ops keeps it)',
  (select last_seen_at > now() - interval '1 minute' from user_last_seen
    where user_id = 'f1111111-0000-0000-0000-000000000001'),
  true);

-- ============================================================================
-- Step 2 — the new heartbeat: touch_last_seen() stamps the CALLER only
-- ============================================================================
update user_last_seen set last_seen_at = now() - interval '1 day'
  where user_id = 'f1111111-0000-0000-0000-000000000001';

select pg_temp.set_user('f1111111-0000-0000-0000-000000000001');
set local role authenticated;
select public.touch_last_seen();
reset role;

select pg_temp.assert(
  'touch_last_seen() stamps the caller with the server clock',
  (select last_seen_at > now() - interval '1 minute' from user_last_seen
    where user_id = 'f1111111-0000-0000-0000-000000000001'),
  true);
select pg_temp.assert(
  '…and nobody else',
  (select count(*) = 0 from user_last_seen
    where user_id = 'f1111111-0000-0000-0000-000000000002'),
  true);

select pg_temp.set_user('f1111111-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert(
  'the owner cannot read user_last_seen either — it is not a user feature',
  pg_temp.visible_last_seen() <= 0,
  true);
reset role;

-- ============================================================================
-- Step 3 — the ops roster still shows "last active"
-- ============================================================================
select pg_temp.set_user('f1111111-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert(
  'ops_users_overview() shows Riya''s last active time to an operator',
  (select last_seen_at > now() - interval '1 minute' from ops_users_overview()
    where id = 'f1111111-0000-0000-0000-000000000001'),
  true);
reset role;

select pg_temp.set_user('f1111111-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert(
  'ops_users_overview() returns nothing to a non-operator',
  (select count(*) = 0 from ops_users_overview()),
  true);
reset role;

-- ============================================================================
-- Step 4 — surface
-- ============================================================================
select pg_temp.assert('anon CANNOT execute touch_last_seen',
  has_function_privilege('anon', 'public.touch_last_seen()', 'EXECUTE'), false);
select pg_temp.assert('no profile carries a last_seen_at after the migration',
  (select count(*) = 0 from profiles where last_seen_at is not null),
  true);

rollback;
