-- Never-confirmed accounts are hidden from other users (ADR-0025, change 1;
-- 20261010000000_hide_unconfirmed_accounts.sql).
--
-- What must hold:
--   * a stranger, a conversation peer and a blocker cannot read an unconfirmed profile;
--     its owner always can
--   * a CONFIRMED user whose profiles.email_confirmed cache is still false stays visible —
--     the cache may only ever hide less, never more
--   * search_discover_people never suggests an unconfirmed account, even as the newest
--     sign-up in the 'people' fallback
--   * send_friend_request refuses an unconfirmed target and a missing one with the SAME
--     error, and still works for a confirmed one
--   * ops_users_overview still lists unconfirmed accounts to an operator
--   * nobody can write profiles.email_confirmed = true unless it is true; ordinary
--     profile edits keep working, including for a confirmed user with a stale cache
--   * anon cannot execute auth_email_confirmed; authenticated can
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/unconfirmed-accounts.test.sql

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

create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
end $$;

-- The error text `sql` raises, or 'ok' when it succeeds.
create or replace function pg_temp.err(sql text)
returns text language plpgsql as $$
begin
  execute sql;
  return 'ok';
exception when others then
  return sqlerrm;
end $$;

create or replace function pg_temp.sees(target uuid)
returns boolean language sql as $$
  select exists (select 1 from public.profiles where id = target);
$$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   …01 ME        confirmed
--   …02 GHOST     never confirmed, newest sign-up of all
--   …03 LATE      confirmed, but profiles.email_confirmed cache still false
--   …04 PEER      confirmed; shares a conversation with GHOST
--   …05 BLOCKED   confirmed; GHOST blocked them
--   …06 OPS       confirmed operator
insert into auth.users (id, email, email_confirmed_at, created_at) values
  ('a0250000-0000-0000-0000-000000000001', 'uc_me@example.com',      now(), now() - interval '30 days'),
  ('a0250000-0000-0000-0000-000000000002', 'uc_ghost@example.com',   null,  now()),
  ('a0250000-0000-0000-0000-000000000003', 'uc_late@example.com',    now(), now() - interval '2 days'),
  ('a0250000-0000-0000-0000-000000000004', 'uc_peer@example.com',    now(), now() - interval '20 days'),
  ('a0250000-0000-0000-0000-000000000005', 'uc_blocked@example.com', now(), now() - interval '20 days'),
  ('a0250000-0000-0000-0000-000000000006', 'uc_ops@example.com',     now(), now() - interval '40 days');

insert into public.profiles (id, username, username_set, email_confirmed, created_at) values
  ('a0250000-0000-0000-0000-000000000001', 'uc_me',      true, true,  now() - interval '30 days'),
  ('a0250000-0000-0000-0000-000000000002', 'uc_ghost',   true, false, now()),
  ('a0250000-0000-0000-0000-000000000003', 'uc_late',    true, false, now() - interval '2 days'),
  ('a0250000-0000-0000-0000-000000000004', 'uc_peer',    true, true,  now() - interval '20 days'),
  ('a0250000-0000-0000-0000-000000000005', 'uc_blocked', true, true,  now() - interval '20 days'),
  ('a0250000-0000-0000-0000-000000000006', 'uc_ops',     true, true,  now() - interval '40 days');

insert into public.blocked_users (blocker_id, blocked_id) values
  ('a0250000-0000-0000-0000-000000000002', 'a0250000-0000-0000-0000-000000000005');

insert into public.conversations (id, kind) values
  ('a0250000-0000-0000-0000-0000000000c1', 'dm');
insert into public.conversation_members (conversation_id, user_id) values
  ('a0250000-0000-0000-0000-0000000000c1', 'a0250000-0000-0000-0000-000000000002'),
  ('a0250000-0000-0000-0000-0000000000c1', 'a0250000-0000-0000-0000-000000000004');

insert into public.ops_users (user_id) values ('a0250000-0000-0000-0000-000000000006');

-- ============================================================================
-- Visibility
-- ============================================================================
select pg_temp.set_user('a0250000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('a stranger cannot see an unconfirmed profile',
  pg_temp.sees('a0250000-0000-0000-0000-000000000002'), false);
select pg_temp.assert('a stranger cannot find it by username either',
  exists (select 1 from public.profiles where username ilike 'uc_gho%'), false);
select pg_temp.assert('a confirmed user whose cache is still false stays visible',
  pg_temp.sees('a0250000-0000-0000-0000-000000000003'), true);
select pg_temp.assert('an ordinary confirmed user is visible',
  pg_temp.sees('a0250000-0000-0000-0000-000000000004'), true);
reset role;

select pg_temp.set_user('a0250000-0000-0000-0000-000000000004');
set local role authenticated;
select pg_temp.assert('sharing a conversation does not reveal an unconfirmed profile',
  pg_temp.sees('a0250000-0000-0000-0000-000000000002'), false);
reset role;

select pg_temp.set_user('a0250000-0000-0000-0000-000000000005');
set local role authenticated;
select pg_temp.assert('the person it blocked cannot see it',
  pg_temp.sees('a0250000-0000-0000-0000-000000000002'), false);
reset role;

select pg_temp.set_user('a0250000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('its owner always sees their own profile',
  pg_temp.sees('a0250000-0000-0000-0000-000000000002'), true);
reset role;

-- ============================================================================
-- Writing the cache
-- ============================================================================
select pg_temp.set_user('a0250000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('an unconfirmed user cannot mark themselves confirmed',
  pg_temp.err($q$update public.profiles set email_confirmed = true
                 where id = 'a0250000-0000-0000-0000-000000000002'$q$) <> 'ok', true);
select pg_temp.assert('…but can still edit the rest of their own profile',
  pg_temp.err($q$update public.profiles set bio = 'hi'
                 where id = 'a0250000-0000-0000-0000-000000000002'$q$) = 'ok', true);
reset role;

select pg_temp.set_user('a0250000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert('a confirmed user with a stale cache can still edit their profile',
  pg_temp.err($q$update public.profiles set bio = 'hello'
                 where id = 'a0250000-0000-0000-0000-000000000003'$q$) = 'ok', true);
reset role;
select pg_temp.assert('…and the edit really landed (not silently filtered)',
  (select bio from public.profiles where id = 'a0250000-0000-0000-0000-000000000003') = 'hello', true);

-- ============================================================================
-- Suggestions
-- ============================================================================
select pg_temp.set_user('a0250000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('search_discover_people never suggests the unconfirmed newest sign-up',
  exists (select 1 from public.search_discover_people(20)
           where user_id = 'a0250000-0000-0000-0000-000000000002'), false);
select pg_temp.assert('…while a confirmed newcomer (stale cache) is still suggestible',
  exists (select 1 from public.search_discover_people(20)
           where user_id = 'a0250000-0000-0000-0000-000000000003'), true);
reset role;

-- ============================================================================
-- Friend requests
-- ============================================================================
select pg_temp.set_user('a0250000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('a request to an unconfirmed account is refused with user_not_found',
  pg_temp.err($q$select public.send_friend_request('a0250000-0000-0000-0000-000000000002')$q$)
    = 'user_not_found', true);
select pg_temp.assert('a request to a missing account gets the SAME error (no existence oracle)',
  pg_temp.err($q$select public.send_friend_request('a0250000-0000-0000-0000-0000000000ff')$q$)
    = 'user_not_found', true);
select pg_temp.assert('a request to a confirmed account still works',
  pg_temp.err($q$select public.send_friend_request('a0250000-0000-0000-0000-000000000004')$q$)
    = 'ok', true);
reset role;
select pg_temp.assert('…and the refused request left no row behind',
  exists (select 1 from public.friendships
           where 'a0250000-0000-0000-0000-000000000002' in (user_a_id, user_b_id)), false);

-- ============================================================================
-- Ops and grants
-- ============================================================================
select pg_temp.set_user('a0250000-0000-0000-0000-000000000006');
set local role authenticated;
select pg_temp.assert('ops_users_overview still lists the unconfirmed account to an operator',
  exists (select 1 from public.ops_users_overview()
           where id = 'a0250000-0000-0000-0000-000000000002'), true);
reset role;

select pg_temp.assert('anon cannot execute auth_email_confirmed',
  has_function_privilege('anon', 'public.auth_email_confirmed(uuid)', 'execute'), false);
select pg_temp.assert('authenticated can (the profiles policy needs it)',
  has_function_privilege('authenticated', 'public.auth_email_confirmed(uuid)', 'execute'), true);
select pg_temp.assert('new profiles default to the cache saying "not confirmed"',
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'email_confirmed') = 'false', true);

rollback;
