-- list_profile_friends / profile_friend_count tests (20260930010000_profile_friends_public.sql).
--
-- Anyone's accepted friends are visible to any signed-in viewer, friend or not. What must
-- hold: a stranger sees the full accepted list; PENDING rows never appear; a blocked pair
-- gets nothing; a friend blocked with the viewer is left out; the count equals the list.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/profile-friends.test.sql

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

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   …01 RIYA     the profile being viewed
--   …02 ARJUN    Riya's friend (accepted first)
--   …03 SAM      Riya's friend (accepted later)
--   …04 KIRAN    PENDING request with Riya — must never show
--   …05 VIEWER   a stranger to everyone
--   …06 MEERA    Riya's friend, but Meera blocked VIEWER
--   …07 BLOCKER  a stranger who blocked Riya
insert into auth.users (id) values
  ('a8000000-0000-0000-0000-000000000001'),
  ('a8000000-0000-0000-0000-000000000002'),
  ('a8000000-0000-0000-0000-000000000003'),
  ('a8000000-0000-0000-0000-000000000004'),
  ('a8000000-0000-0000-0000-000000000005'),
  ('a8000000-0000-0000-0000-000000000006'),
  ('a8000000-0000-0000-0000-000000000007')
on conflict do nothing;

insert into profiles (id, username, username_set) values
  ('a8000000-0000-0000-0000-000000000001', 'pf_riya',    true),
  ('a8000000-0000-0000-0000-000000000002', 'pf_arjun',   true),
  ('a8000000-0000-0000-0000-000000000003', 'pf_sam',     true),
  ('a8000000-0000-0000-0000-000000000004', 'pf_kiran',   true),
  ('a8000000-0000-0000-0000-000000000005', 'pf_viewer',  true),
  ('a8000000-0000-0000-0000-000000000006', 'pf_meera',   true),
  ('a8000000-0000-0000-0000-000000000007', 'pf_blocker', true)
on conflict do nothing;

-- user_a_id < user_b_id is a table constraint; Riya (…01) is always user_a here.
insert into friendships (user_a_id, user_b_id, status, requested_by, accepted_at) values
  ('a8000000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-000000000002',
   'accepted', 'a8000000-0000-0000-0000-000000000001', '2026-01-01 00:00:00+00'),
  ('a8000000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-000000000003',
   'accepted', 'a8000000-0000-0000-0000-000000000003', '2026-03-01 00:00:00+00'),
  ('a8000000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-000000000004',
   'pending',  'a8000000-0000-0000-0000-000000000004', null),
  ('a8000000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-000000000006',
   'accepted', 'a8000000-0000-0000-0000-000000000001', '2026-02-01 00:00:00+00')
on conflict do nothing;

-- Inserted directly (not via block_user) so Meera's friendship with Riya survives:
-- the block is between Meera and the VIEWER, not Riya.
insert into blocked_users (blocker_id, blocked_id) values
  ('a8000000-0000-0000-0000-000000000006', 'a8000000-0000-0000-0000-000000000005'),
  ('a8000000-0000-0000-0000-000000000007', 'a8000000-0000-0000-0000-000000000001')
on conflict do nothing;

-- ============================================================================
-- Step 1 — a stranger sees Riya's accepted friends, newest first
-- ============================================================================
-- Run as ARJUN first: no blocks involve him, so all three accepted friends show.
select pg_temp.set_user('a8000000-0000-0000-0000-000000000002');
set local role authenticated;

select pg_temp.assert('Arjun sees all three of Riya''s accepted friends, himself included, newest first',
  (select array_agg(username)
     from list_profile_friends('a8000000-0000-0000-0000-000000000001'))
    = array['pf_sam', 'pf_meera', 'pf_arjun'], true);
reset role;

select pg_temp.set_user('a8000000-0000-0000-0000-000000000005');
set local role authenticated;

select pg_temp.assert('under caller rights the stranger sees none of Riya''s friendships (why DEFINER)',
  (select count(*) = 0 from friendships
     where user_a_id = 'a8000000-0000-0000-0000-000000000001'), true);

select pg_temp.assert('a PENDING request never appears in the list',
  (select count(*) = 0
     from list_profile_friends('a8000000-0000-0000-0000-000000000001')
    where username = 'pf_kiran'), true);

select pg_temp.assert('a friend who blocked the viewer is left out of the viewer''s copy',
  (select array_agg(username)
     from list_profile_friends('a8000000-0000-0000-0000-000000000001'))
    = array['pf_sam', 'pf_arjun'], true);

select pg_temp.assert('the count equals the list the same viewer sees',
  profile_friend_count('a8000000-0000-0000-0000-000000000001') = 2, true);

reset role;

-- ============================================================================
-- Step 2 — a blocked pair gets nothing, in both directions
-- ============================================================================
select pg_temp.set_user('a8000000-0000-0000-0000-000000000007');
set local role authenticated;
select pg_temp.assert('the blocker sees no friends for the person they blocked',
  (select count(*) = 0
     from list_profile_friends('a8000000-0000-0000-0000-000000000001')), true);
select pg_temp.assert('and a zero count',
  profile_friend_count('a8000000-0000-0000-0000-000000000001') = 0, true);
reset role;

select pg_temp.set_user('a8000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('the blocked person sees nothing for their blocker either',
  (select count(*) = 0
     from list_profile_friends('a8000000-0000-0000-0000-000000000007')), true);
reset role;

-- ============================================================================
-- Step 3 — surface
-- ============================================================================
select pg_temp.set_user(null);
set local role authenticated;
select pg_temp.assert('no caller identity → empty list',
  (select count(*) = 0
     from list_profile_friends('a8000000-0000-0000-0000-000000000001')), true);
reset role;

select pg_temp.assert('anon CANNOT execute list_profile_friends',
  has_function_privilege('anon', 'public.list_profile_friends(uuid)', 'EXECUTE'), false);
select pg_temp.assert('anon CANNOT execute profile_friend_count',
  has_function_privilege('anon', 'public.profile_friend_count(uuid)', 'EXECUTE'), false);
select pg_temp.assert('accepted_at is not part of the public shape',
  (select count(*) = 0 from information_schema.routines r
     join information_schema.parameters pa using (specific_schema, specific_name)
    where r.routine_name = 'list_profile_friends' and pa.parameter_mode = 'OUT'
      and pa.parameter_name not in ('user_id', 'username', 'display_name', 'avatar_url')), true);
select pg_temp.assert('authenticated CAN execute list_profile_friends',
  has_function_privilege('authenticated', 'public.list_profile_friends(uuid)', 'EXECUTE'), true);

rollback;
