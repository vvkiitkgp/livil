-- DM-on-friend-accept tests — LIV-25 (client half: LIV-20).
--
-- Asserts the PROPERTY ("after an accept, the pair have exactly one DM and both can
-- read it"), not the change ("a trigger was added"). The distinction is the D-53
-- lesson recorded in authorization.test.sql: a guard on the front door is not a
-- guarantee about the building.
--
-- The accept is driven through `accept_friend_request` as `authenticated`, not by a
-- hand-written UPDATE, so what is under test is the deployed path a real client takes.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/dm-on-friend-accept.test.sql
--
-- Exercises the database, not PostgREST (P32).

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

create or replace function pg_temp.assert_eq(label text, actual bigint, expected bigint)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL  %  (expected %, got %)', label, expected, actual;
  end if;
  raise notice 'ok    %  (= %)', label, actual;
end $$;

-- auth.uid() is stubbed per-case because there is no JWT in this context.
create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
end $$;

-- How many DM conversations exist for a pair, ignoring RLS (owner role). This is the
-- assertion that actually catches duplication — a caller-side count would be filtered
-- by policy and could report 1 while 2 exist.
create or replace function pg_temp.dm_count(a uuid, b uuid)
returns bigint language sql as $$
  select count(*)
    from conversation_members cm1
    join conversation_members cm2 on cm2.conversation_id = cm1.conversation_id
    join conversations c on c.id = cm1.conversation_id
   where cm1.user_id = a and cm2.user_id = b and c.kind = 'dm';
$$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- REQUESTER sends, ACCEPTER accepts. OUTSIDER is friends with nobody and exists to
-- prove the new conversation is not readable by a third party.
insert into auth.users (id) values
  ('c5c5c5c5-0000-0000-0000-000000000001'),  -- requester
  ('c5c5c5c5-0000-0000-0000-000000000002'),  -- accepter
  ('c5c5c5c5-0000-0000-0000-000000000003')   -- outsider
on conflict do nothing;

insert into profiles (id, username, username_set) values
  ('c5c5c5c5-0000-0000-0000-000000000001', 'liv25_requester', true),
  ('c5c5c5c5-0000-0000-0000-000000000002', 'liv25_accepter',  true),
  ('c5c5c5c5-0000-0000-0000-000000000003', 'liv25_outsider',  true)
on conflict do nothing;

-- ============================================================================
-- Step 1 — the pair have no DM before the accept
-- ============================================================================
-- Establishes the baseline the later counts are measured against. Without it, a
-- fixture that accidentally shipped a conversation would make step 2 pass for the
-- wrong reason.
select pg_temp.assert_eq(
  'step 1: no DM exists for the pair before any friendship',
  pg_temp.dm_count('c5c5c5c5-0000-0000-0000-000000000001',
                   'c5c5c5c5-0000-0000-0000-000000000002'),
  0);

-- ============================================================================
-- Step 2 — accepting a friend request yields exactly one DM   (AC 1, AC 2)
-- ============================================================================
select pg_temp.set_user('c5c5c5c5-0000-0000-0000-000000000001');
set local role authenticated;
select send_friend_request('c5c5c5c5-0000-0000-0000-000000000002');
reset role;

select pg_temp.set_user('c5c5c5c5-0000-0000-0000-000000000002');
set local role authenticated;
select accept_friend_request('c5c5c5c5-0000-0000-0000-000000000001');
reset role;

select pg_temp.assert_eq(
  'step 2: accepting a friend request creates exactly one DM for the pair',
  pg_temp.dm_count('c5c5c5c5-0000-0000-0000-000000000001',
                   'c5c5c5c5-0000-0000-0000-000000000002'),
  1);

-- Both membership rows, not just the accepter's. A conversation only the accepter
-- belongs to would still count as one DM above but would never reach the other inbox.
select pg_temp.assert_eq(
  'step 2: both users are members of it',
  (select count(*)
     from conversation_members cm
     join conversations c on c.id = cm.conversation_id
    where c.kind = 'dm'
      and cm.user_id in ('c5c5c5c5-0000-0000-0000-000000000001',
                         'c5c5c5c5-0000-0000-0000-000000000002')),
  2);

-- It is genuinely empty — the ticket asks for an empty conversation, not a synthetic
-- "you are now friends" system message.
select pg_temp.assert_eq(
  'step 2: the conversation is created empty',
  (select count(*)
     from messages m
     join conversations c on c.id = m.conversation_id
    where c.kind = 'dm'
      and exists (select 1 from conversation_members cm
                   where cm.conversation_id = c.id
                     and cm.user_id = 'c5c5c5c5-0000-0000-0000-000000000001')),
  0);

-- created_by is the accepter, per the trigger's attribution rule.
select pg_temp.assert(
  'step 2: created_by is the accepter, not the requester',
  (select c.created_by = 'c5c5c5c5-0000-0000-0000-000000000002'
     from conversations c
     join conversation_members cm on cm.conversation_id = c.id
    where c.kind = 'dm'
      and cm.user_id = 'c5c5c5c5-0000-0000-0000-000000000001'
    limit 1),
  true);

-- ============================================================================
-- Step 3 — both members can read it under RLS                        (AC 3)
-- ============================================================================
-- list_my_conversations is the actual inbox query, so this asserts what the user
-- sees rather than what the table contains. `last_message_at desc nulls last` is the
-- reason a message-less row appears at all; a change to that ordering that dropped
-- nulls would fail here.
select pg_temp.set_user('c5c5c5c5-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert_eq(
  'step 3: the accepter sees the empty conversation in their inbox',
  (select count(*) from list_my_conversations()
    where other_user_id = 'c5c5c5c5-0000-0000-0000-000000000001'),
  1);
reset role;

select pg_temp.set_user('c5c5c5c5-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert_eq(
  'step 3: the requester sees it too — the half that has no client-side call',
  (select count(*) from list_my_conversations()
    where other_user_id = 'c5c5c5c5-0000-0000-0000-000000000002'),
  1);
reset role;

-- The perimeter still holds: a third party is not a member and sees nothing.
select pg_temp.set_user('c5c5c5c5-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert_eq(
  'step 3: an outsider sees no conversation at all',
  (select count(*) from list_my_conversations()),
  0);
reset role;

-- ============================================================================
-- Step 4 — get_or_create_dm returns the SAME conversation           (AC 4)
-- ============================================================================
-- The client still calls this from NewConversationScreen and UserProfileScreen. If it
-- created a second DM the inbox would show the pair twice, which is the duplication
-- LIV-25 names. This is the single most likely regression, because the two writers
-- are in different files.
savepoint step4;
select pg_temp.set_user('c5c5c5c5-0000-0000-0000-000000000001');
set local role authenticated;
select get_or_create_dm('c5c5c5c5-0000-0000-0000-000000000001',
                        'c5c5c5c5-0000-0000-0000-000000000002');
select get_or_create_dm('c5c5c5c5-0000-0000-0000-000000000001',
                        'c5c5c5c5-0000-0000-0000-000000000002');
-- Argument order must not matter either — the existence check is symmetric, and the
-- lock key normalizes. A caller that passed the friend first would otherwise duplicate.
select get_or_create_dm('c5c5c5c5-0000-0000-0000-000000000002',
                        'c5c5c5c5-0000-0000-0000-000000000001');
reset role;

select pg_temp.assert_eq(
  'step 4: three further get_or_create_dm calls create nothing new',
  pg_temp.dm_count('c5c5c5c5-0000-0000-0000-000000000001',
                   'c5c5c5c5-0000-0000-0000-000000000002'),
  1);
rollback to savepoint step4;

-- ============================================================================
-- Step 5 — the lock key is order-independent
-- ============================================================================
-- Asserted directly rather than only through behaviour. The lock is what makes the
-- concurrent case safe, and a concurrent case cannot be reproduced inside a single
-- transaction — two sessions would deadlock this test rather than prove anything. So
-- the property the serialization rests on is pinned here, and the observable
-- consequence is pinned in step 4.
select pg_temp.assert(
  'step 5: _dm_lock_key is identical in both argument orders',
  (select public._dm_lock_key('c5c5c5c5-0000-0000-0000-000000000001',
                              'c5c5c5c5-0000-0000-0000-000000000002')
        = public._dm_lock_key('c5c5c5c5-0000-0000-0000-000000000002',
                              'c5c5c5c5-0000-0000-0000-000000000001')),
  true);

select pg_temp.assert(
  'step 5: distinct pairs get distinct keys',
  (select public._dm_lock_key('c5c5c5c5-0000-0000-0000-000000000001',
                              'c5c5c5c5-0000-0000-0000-000000000002')
       <> public._dm_lock_key('c5c5c5c5-0000-0000-0000-000000000001',
                              'c5c5c5c5-0000-0000-0000-000000000003')),
  true);

-- ============================================================================
-- Step 6 — unfriend then re-accept reuses the existing DM
-- ============================================================================
-- remove_friend deletes the friendship row; a later request/accept runs the trigger
-- again while the old conversation and its history are still present. It must not
-- mint a second one. LIV-21/LIV-26 own hiding on unfriend — this only asserts that
-- re-befriending does not duplicate.
savepoint step6;
select pg_temp.set_user('c5c5c5c5-0000-0000-0000-000000000002');
set local role authenticated;
select remove_friend('c5c5c5c5-0000-0000-0000-000000000001');
reset role;

select pg_temp.set_user('c5c5c5c5-0000-0000-0000-000000000001');
set local role authenticated;
select send_friend_request('c5c5c5c5-0000-0000-0000-000000000002');
reset role;

select pg_temp.set_user('c5c5c5c5-0000-0000-0000-000000000002');
set local role authenticated;
select accept_friend_request('c5c5c5c5-0000-0000-0000-000000000001');
reset role;

select pg_temp.assert_eq(
  'step 6: re-accepting after an unfriend reuses the existing DM',
  pg_temp.dm_count('c5c5c5c5-0000-0000-0000-000000000001',
                   'c5c5c5c5-0000-0000-0000-000000000002'),
  1);
rollback to savepoint step6;

-- ============================================================================
-- Step 7 — the trigger did not weaken get_or_create_dm's authorization
-- ============================================================================
-- LIV-11 finding #1: assert_friendship proves the PAIR are friends, not that the
-- caller is one of them. get_or_create_dm was replaced in this migration, so the
-- guard is re-asserted here rather than assumed to have survived the transcription.
select pg_temp.set_user('c5c5c5c5-0000-0000-0000-000000000003');
set local role authenticated;
do $$
begin
  perform get_or_create_dm('c5c5c5c5-0000-0000-0000-000000000001',
                           'c5c5c5c5-0000-0000-0000-000000000002');
  raise exception 'FAIL  step 7: a non-participant was allowed to manufacture a DM between two friends';
exception
  when insufficient_privilege then
    raise notice 'ok    step 7: a third party calling get_or_create_dm for two friends is DENIED';
end $$;
reset role;

-- ============================================================================
-- Step 8 — a brand-new empty conversation does not sort to the bottom
-- ============================================================================
-- `last_message_at desc nulls last` put every message-less conversation BELOW every
-- stale one, so the DM this feature creates arrived at the far end of the inbox — the
-- one row the user has a reason to open, rendered least visibly, directly above a
-- footer that reads "New messages will tune in at the top". Ordering is not decoration
-- here; it is whether the feature is findable.
--
-- The fixture is an OLD group thread: it has a real last_message_at, so under the
-- previous ordering it outranked the null and came first.
savepoint step8;
insert into conversations (id, kind, name, last_message_at) values
  ('c5c5c5c5-1111-0000-0000-000000000001', 'group', 'old thread',
   timestamptz '2020-01-01 00:00:00+00');
insert into conversation_members (conversation_id, user_id, role) values
  ('c5c5c5c5-1111-0000-0000-000000000001', 'c5c5c5c5-0000-0000-0000-000000000002', 'member');

select pg_temp.set_user('c5c5c5c5-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert(
  'step 8: the just-created empty DM outranks a years-old thread in the inbox',
  (select (array_agg(kind order by ord))[1] = 'dm'
     from (select kind, row_number() over () as ord from list_my_conversations()) t),
  true);
reset role;
rollback to savepoint step8;

-- A conversation that HAS messages must still sort by its last message, not by when it
-- was created — the coalesce is only supposed to change the null case. Without this the
-- suite would accept "order by created_at", which would scramble every active inbox.
savepoint step8b;
insert into conversations (id, kind, name, created_at, last_message_at) values
  ('c5c5c5c5-2222-0000-0000-000000000001', 'group', 'old thread, recent message',
   timestamptz '2020-01-01 00:00:00+00', now() + interval '1 hour');
insert into conversation_members (conversation_id, user_id, role) values
  ('c5c5c5c5-2222-0000-0000-000000000001', 'c5c5c5c5-0000-0000-0000-000000000002', 'member');

select pg_temp.set_user('c5c5c5c5-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert(
  'step 8: an old conversation with a recent message still sorts by the message',
  (select (array_agg(name order by ord))[1] = 'old thread, recent message'
     from (select name, row_number() over () as ord from list_my_conversations()) t),
  true);
reset role;
rollback to savepoint step8b;

-- ============================================================================
-- Step 9 — list_my_conversations kept its pinned search_path
-- ============================================================================
-- CREATE OR REPLACE drops every attribute not restated, so replacing this DEFINER
-- function to change one ORDER BY is exactly how the LIV-16 pg_temp hardening gets
-- silently undone. definer-search-path.test.sql covers the whole set; this pins the one
-- this migration touched, next to the change that could break it.
select pg_temp.assert(
  'step 9: list_my_conversations is still pinned to public, pg_temp',
  (select proconfig @> array['search_path=public, pg_temp']
     from pg_proc where proname = 'list_my_conversations'),
  true);

rollback;
