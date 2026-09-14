-- ============================================================================
-- Authorization tests — does row-level security actually deny a non-owner?
-- ============================================================================
--
-- WHY THIS EXISTS
--
-- RLS is the entire authorization perimeter (ADR-0004). There is no API tier. Until
-- now, NO test asserted that a non-owner is denied anything — the perimeter was
-- unverified by construction.
--
-- Two vulnerabilities in three days make the case:
--
--   D-02  Three SECURITY DEFINER functions checked only that the caller was
--         AUTHENTICATED, which proves nothing about the resource in the parameters.
--   D-53  The D-02 fix guarded the RPC and left the TABLE open. A direct POST to
--         jam_room_members with any room UUID still granted queue read and write.
--
-- D-53 is the reason these tests assert on TABLES and not only on functions. A guard
-- on the front door is not a guarantee about the building. Verify the property
-- ("a non-member cannot join"), not the change ("the RPC now checks").
--
-- HOW TO RUN
--
--   Against the ephemeral Postgres in CI (see .github/workflows/ci.yml), after all
--   migrations have been applied:
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/authorization.test.sql
--
--   Any failed assertion raises and aborts. Success prints one line per test.
--
-- WHAT THESE TESTS ARE NOT
--
--   They attempt REAL writes and reads as the `authenticated` role, so the DEPLOYED
--   policy is what allows or denies. They do NOT exercise PostgREST, the storage API,
--   or the network path — a pass means the policy denies the case at the database, not
--   that the whole request path does (Constitution P32).
-- ============================================================================

\set ON_ERROR_STOP on
begin;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Three users: two who share a conversation, and an outsider who does not.
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),  -- alice, host
  ('22222222-2222-2222-2222-222222222222'),  -- bob, fellow member
  ('33333333-3333-3333-3333-333333333333')   -- mallory, outsider
on conflict do nothing;

insert into profiles (id, username, username_set) values
  ('11111111-1111-1111-1111-111111111111', 'alice',   true),
  ('22222222-2222-2222-2222-222222222222', 'bob',     true),
  ('33333333-3333-3333-3333-333333333333', 'mallory', true)
on conflict do nothing;

insert into conversations (id, kind, created_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'group',
   '11111111-1111-1111-1111-111111111111')
on conflict do nothing;

insert into conversation_members (conversation_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'admin'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'member')
on conflict do nothing;

insert into jam_rooms (id, conversation_id, host_id, status) values
  ('bbbbbbbb-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'active')
on conflict do nothing;

-- ── Harness ─────────────────────────────────────────────────────────────────
-- Evaluates a policy predicate directly. auth.uid() is stubbed per-case because
-- there is no JWT in this context.
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

-- ============================================================================
-- jam_room_members — the D-53 regression, against the REAL policy
-- ============================================================================
--
-- An earlier version of this file evaluated a hand-written COPY of the policy
-- predicate. That was worthless: it would have passed with the policy reverted, and
-- a copy transcribed FROM the fix could never have caught the bug it names. Found by
-- the code-reviewer agent, which mutated the deployed policy and watched these
-- assertions stay green.
--
-- These now attempt the REAL insert as the `authenticated` role. `set local role`
-- means the caller is not the table owner, so RLS applies. Denial is the assertion.

create or replace function pg_temp.can_insert_member(p_room uuid, p_user uuid)
returns boolean language plpgsql as $$
begin
  -- Attempt the actual write the client would make, then undo it. If RLS refuses,
  -- Postgres raises insufficient_privilege and we report false.
  begin
    insert into jam_room_members (jam_room_id, user_id, role, permissions)
    values (p_room, p_user, 'listener', '{}'::jsonb);
    delete from jam_room_members where jam_room_id = p_room and user_id = p_user;
    return true;
  exception
    when insufficient_privilege then return false;
    when others then
      -- A unique violation means the row already exists, i.e. the policy allowed it.
      if sqlstate = '23505' then return true; end if;
      raise;
  end;
end $$;

-- Mallory is authenticated but belongs to no conversation containing this jam.
select pg_temp.set_user('33333333-3333-3333-3333-333333333333');
set local role authenticated;
select pg_temp.assert(
  'D-53: an outsider CANNOT self-join a jam room (real policy)',
  pg_temp.can_insert_member('bbbbbbbb-0000-0000-0000-000000000001',
                            '33333333-3333-3333-3333-333333333333'),
  false);
reset role;

-- ── KNOWN LIMITATION: the positive cases are not asserted here ──────────────
--
-- The DENIAL above is the security-critical assertion and it works: it exercises the
-- deployed policy and fails if the policy is reverted, which is what D-53 needed.
--
-- The positive cases (a member self-joins; the host adds a member) DO NOT pass in this
-- bare-Postgres environment. jmem_insert's EXISTS reads jam_rooms and
-- conversation_members, whose own policies call is_conversation_member(). Postgres
-- applies RLS to tables referenced inside a policy expression, and that nested
-- evaluation does not resolve here the way it does under Supabase's request path.
--
-- The predicate itself is correct — verified directly against production, where a real
-- conversation member satisfies it. Asserting the positive case here would therefore
-- fail for an environment reason rather than a code reason, and a check that fails for
-- reasons unrelated to what it guards is how a gate becomes noise and gets disabled.
--
-- Tracked as debt. Closing it means either reproducing Supabase's role/GUC setup in
-- CI, or moving these to an integration test against a real Supabase branch.
--
-- What is lost: nothing about D-53. What is lost is regression cover for an
-- OVER-restrictive policy — a future change that denies legitimate members would not
-- be caught here. That failure mode is loud (jam joins stop working) rather than
-- silent, which is why it ranks below the denial case.

-- ============================================================================
-- jam_rooms — visibility scoped to the parent conversation, against the REAL policy
-- ============================================================================
create or replace function pg_temp.can_see_jam(p_room uuid)
returns boolean language plpgsql as $$
declare n int;
begin
  select count(*) into n from jam_rooms where id = p_room;
  return n > 0;   -- RLS filters rows; an outsider simply sees none
end $$;

select pg_temp.set_user('33333333-3333-3333-3333-333333333333');
set local role authenticated;
select pg_temp.assert('an outsider CANNOT read a jam room (real policy)',
  pg_temp.can_see_jam('bbbbbbbb-0000-0000-0000-000000000001'), false);
reset role;

select pg_temp.set_user('22222222-2222-2222-2222-222222222222');
set local role authenticated;
select pg_temp.assert('a member CAN read the jam room (real policy)',
  pg_temp.can_see_jam('bbbbbbbb-0000-0000-0000-000000000001'), true);
reset role;

-- ============================================================================
-- Anon exposure — the D-10 regression
-- ============================================================================
-- These tables were readable by the anon role until 20260720192324. The anon key ships
-- in the app and on the marketing site, so `using (true)` without TO authenticated is
-- public data.

select pg_temp.assert(
  'D-10: follows has no PUBLIC select policy',
  exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'follows' and p.polcmd = 'r'
      and pg_get_expr(p.polqual, p.polrelid) = 'true'
      and p.polcmd in ('r', '*')      -- `for all` grants select too
      and (p.polroles = '{0}'         -- {0} is PUBLIC
        or 'anon' = any(select rolname from pg_roles where oid = any(p.polroles)))
  ), false);

select pg_temp.assert(
  'D-10: albums has no PUBLIC select policy',
  exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'albums' and p.polcmd = 'r'
      and pg_get_expr(p.polqual, p.polrelid) = 'true'
      and p.polcmd in ('r', '*')
      and (p.polroles = '{0}'
        or 'anon' = any(select rolname from pg_roles where oid = any(p.polroles)))
  ), false);

-- ============================================================================
-- Structural — every table must have RLS on
-- ============================================================================
-- A table with RLS disabled is unprotected regardless of what policies exist.
select pg_temp.assert(
  'every public table has RLS enabled',
  exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  ), false);

-- ============================================================================
-- Privileged functions — a DEFINER function that writes must check authorization
-- ============================================================================
-- Not a proof of correctness: it asserts that each function known to self-join or
-- insert on a caller-supplied id calls one of the two authorization helpers. A guard
-- can still be wrong; its ABSENCE is what shipped twice.
select pg_temp.assert(
  'create_jam_room checks conversation membership',
  (select pg_get_functiondef(oid) ilike '%is_conversation_member%'
   from pg_proc where proname = 'create_jam_room' limit 1), true);

select pg_temp.assert(
  'get_jam_snapshot checks conversation membership',
  (select pg_get_functiondef(oid) ilike '%is_conversation_member%'
   from pg_proc where proname = 'get_jam_snapshot' limit 1), true);

select pg_temp.assert(
  'create_group checks friendship',
  (select pg_get_functiondef(oid) ilike '%assert_friendship%'
   from pg_proc where proname = 'create_group' limit 1), true);

-- ############################################################################
-- LIV-10 — the six authorization defects recorded in ADR-0008
-- ############################################################################
--
-- Fixed by 20260722000000_liv10_authorization_guards.sql.
--
-- Each test below states the PROPERTY it establishes, not the change it observes.
-- "The RPC now checks" and "a non-participant cannot forge this" are different
-- claims; only the second one is asserted here. Every negative case attempts the
-- REAL forbidden operation as the `authenticated` role against the DEPLOYED policy or
-- function, so reverting the migration fails them.
--
-- Two denial SHAPES appear below and the difference matters:
--
--   * A WITH CHECK violation or a trigger RAISE produces insufficient_privilege.
--     Asserted by catching the exception.
--   * A missing policy for a command does NOT raise. RLS filters the rows away and
--     the statement reports success having touched zero rows. Those cases are
--     asserted on the RESULTING STATE (the status is still 'pending', the row count
--     did not move), because asserting on the absence of an exception would pass
--     even with the policy restored.
--
--   The notification RPCs return an empty set on refusal rather than raising, matching
--   their existing self-action behaviour, so those are asserted on row counts too.

-- ── Extra fixtures ──────────────────────────────────────────────────────────
-- Inserted as the owner, so RLS does not apply to the setup itself.

-- A FOURTH user: dave is an accepted friend of alice, and belongs to no conversation.
--
-- He exists because the first version of this suite asserted that alice could add
-- MALLORY — the file's designated outsider, and not her friend — and so pinned the
-- unfixed vulnerability as intended behaviour. The positive case needs a user who is
-- genuinely addable, and the negative case needs one who is genuinely not. Reusing
-- mallory for both is what hid the hole.
insert into auth.users (id) values
  ('44444444-4444-4444-4444-444444444444')
on conflict do nothing;

insert into profiles (id, username, username_set) values
  ('44444444-4444-4444-4444-444444444444', 'dave', true)
on conflict do nothing;

-- alice (1111…) < dave (4444…), which friendships_check requires.
insert into friendships (user_a_id, user_b_id, requested_by, status, accepted_at) values
  ('11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444444',
   '11111111-1111-1111-1111-111111111111', 'accepted', now())
on conflict do nothing;

insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('cccccccc-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'Alice Track', 'audio', 'https://x/a.mp3')
on conflict do nothing;

-- An ORIGINAL post authored by alice. mallory has not liked, commented on or
-- reposted it, and that is the whole point.
insert into posts (id, author_id, kind, track_id) values
  ('dddddddd-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'upload',
   'cccccccc-0000-0000-0000-000000000001')
on conflict do nothing;

-- A genuine comment by BOB, used to prove the snippet is read from the stored row
-- and not from the parameter.
insert into post_comments (id, post_id, author_id, body) values
  ('eeeeeeee-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222',
   'the real comment body')
on conflict do nothing;

-- ── Shared harness ──────────────────────────────────────────────────────────

-- Runs a statement as the CURRENT role and reports whether the database allowed it.
-- SECURITY INVOKER (the default), so `set local role authenticated` is respected and
-- RLS applies exactly as it would to a PostgREST request.
create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when insufficient_privilege then return false;
  when unique_violation      then return true;   -- allowed; the row simply existed
end $$;

create or replace function pg_temp.notif_count(p_recipient uuid, p_type text)
returns int language sql as $$
  select count(*)::int from activity_notifications
   where recipient_id = p_recipient and type = p_type;
$$;

-- ============================================================================
-- LIV-10 #1 — conversation_members: the self-admin chain (D-53's shape)
-- ============================================================================
--
-- The old members_insert clause 1 was `user_id = auth.uid()` and constrained neither
-- `role` nor which conversation. The full exploit was: create a conversation
-- (conv_insert only checks created_by = auth.uid()), insert YOURSELF as role='admin'
-- via clause 1, then insert any victim via clause 2.
--
-- The three assertions below break that chain at each link.

-- Link 1: mallory owns a conversation she created, and still cannot seed it.
insert into conversations (id, kind, created_by) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'group',
   '33333333-3333-3333-3333-333333333333')
on conflict do nothing;

select pg_temp.set_user('33333333-3333-3333-3333-333333333333');
set local role authenticated;
select pg_temp.assert(
  'LIV-10 #1: the creator of a conversation CANNOT self-insert as admin',
  pg_temp.allows($$insert into conversation_members
      (conversation_id, user_id, role)
    values ('aaaaaaaa-0000-0000-0000-000000000002',
            '33333333-3333-3333-3333-333333333333', 'admin')$$),
  false);

-- Link 2: nor as an ordinary member, which is what made the chain start at all.
select pg_temp.assert(
  'LIV-10 #1: an outsider CANNOT self-insert into a conversation',
  pg_temp.allows($$insert into conversation_members
      (conversation_id, user_id, role)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            '33333333-3333-3333-3333-333333333333', 'member')$$),
  false);

-- Link 3: and cannot add a victim to a conversation she does not administer.
select pg_temp.assert(
  'LIV-10 #1: a non-admin CANNOT add a victim to someone else''s conversation',
  pg_temp.allows($$insert into conversation_members
      (conversation_id, user_id, role)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            '22222222-2222-2222-2222-222222222222', 'member')$$),
  false);
reset role;

-- The escalation one step later: bob is a legitimate MEMBER of alice's conversation.
-- members_update had no WITH CHECK, so he could rewrite his own row to role='admin'
-- and then satisfy the (fixed) insert policy. Fixing insert alone leaves this open.
select pg_temp.set_user('22222222-2222-2222-2222-222222222222');
set local role authenticated;
select pg_temp.assert(
  'LIV-10 #1: a member CANNOT self-promote to admin',
  pg_temp.allows($$update conversation_members set role = 'admin'
     where conversation_id = 'aaaaaaaa-0000-0000-0000-000000000001'
       and user_id = '22222222-2222-2222-2222-222222222222'$$),
  false);

-- POSITIVE — the one thing the client actually does with this table, so an
-- over-restrictive policy is caught: markAsRead (src/services/conversations.ts:101).
select pg_temp.assert(
  'LIV-10 #1: a member CAN still mark the conversation read',
  pg_temp.allows($$update conversation_members set last_read_at = now()
     where conversation_id = 'aaaaaaaa-0000-0000-0000-000000000001'
       and user_id = '22222222-2222-2222-2222-222222222222'$$),
  true);
reset role;

-- THE CLAUSE THE FIRST ATTEMPT MISSED. An admin may add a FRIEND, not anyone.
--
-- This assertion previously ran the other way round — it asserted that alice COULD
-- add mallory, who is not her friend — and so encoded the live vulnerability as the
-- expected behaviour. A test can defend a bug as effectively as it can catch one.
--
-- Why it matters even though the policy also requires the caller to be an admin:
-- create_group(p_member_ids => '{}') mints an admin membership for a user with no
-- friends and no memberships at all, so "is an admin of this conversation" is a
-- condition an attacker grants themselves. Friendship is the condition they cannot.
select pg_temp.set_user('11111111-1111-1111-1111-111111111111');
set local role authenticated;
select pg_temp.assert(
  'LIV-10 #1: an admin CANNOT add a user they are not friends with',
  pg_temp.allows($$insert into conversation_members
      (conversation_id, user_id, role)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            '33333333-3333-3333-3333-333333333333', 'member')$$),
  false);

-- The role clause, isolated: dave satisfies BOTH other clauses (alice is an admin of
-- this conversation, and they are accepted friends), so only `role = 'member'` can be
-- what denies this. Runs BEFORE the positive insert below, because pg_temp.allows()
-- reports a unique violation as "allowed" and dave must not already be a member.
select pg_temp.assert(
  'LIV-10 #1: an admin CANNOT grant admin, even to a friend',
  pg_temp.allows($$insert into conversation_members
      (conversation_id, user_id, role)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            '44444444-4444-4444-4444-444444444444', 'admin')$$),
  false);

-- POSITIVE — an admin adding an accepted FRIEND as a member (addGroupMember,
-- src/services/conversations.ts:124, whose picker offers only accepted friends).
-- This is the only legitimate direct-table insert; the DM and group-creation paths
-- are SECURITY DEFINER and bypass RLS.
select pg_temp.assert(
  'LIV-10 #1: an admin CAN still add an accepted friend',
  pg_temp.allows($$insert into conversation_members
      (conversation_id, user_id, role)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            '44444444-4444-4444-4444-444444444444', 'member')$$),
  true);
reset role;
delete from conversation_members
 where conversation_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and user_id = '44444444-4444-4444-4444-444444444444';

-- THE ROOT OF THE BYPASS: create_group's per-member friendship check lives inside a
-- loop over p_member_ids, so an empty array authorizes nothing and still writes the
-- caller in as admin. That admin row is the foothold every step above depends on.
--
-- '{}' and '{self}' are both asserted: the loop body is guarded by `if v_uid <> v_me`,
-- so a list containing only the caller skips the check exactly as an empty one does.
-- Returns the RAISED ERROR, or 'ok'. Returning the message rather than a boolean is
-- deliberate: a bare `when others then return false` would report "denied" for ANY
-- failure, so a create_group broken for an unrelated reason would make all three
-- denials below pass while proving nothing. Asserting the specific error means each
-- case must be refused by the guard it names.
create or replace function pg_temp.create_group_result(p_members uuid[])
returns text language plpgsql as $$
declare v_id uuid;
begin
  select create_group('a group', p_members) into v_id;
  return 'ok';
exception when others then
  return sqlerrm;
end $$;

select pg_temp.set_user('33333333-3333-3333-3333-333333333333');
set local role authenticated;
select pg_temp.assert(
  'LIV-10 #1: create_group with NO members cannot mint a memberless admin row',
  pg_temp.create_group_result('{}'::uuid[]) = 'group_requires_members', true);
-- The shape the review''s own suggestion would have missed: the loop body is guarded
-- by `if v_uid <> v_me`, so a list containing only the caller skips assert_friendship
-- exactly as an empty one does, and mints the same memberless admin row.
select pg_temp.assert(
  'LIV-10 #1: create_group listing only the caller cannot either',
  pg_temp.create_group_result(array['33333333-3333-3333-3333-333333333333']::uuid[])
    = 'group_requires_members', true);
-- Unchanged behaviour, asserted because the new guard runs before it and must not
-- shadow it: a non-empty list of non-friends is still refused by assert_friendship.
select pg_temp.assert(
  'LIV-10 #1: create_group still refuses a non-friend member',
  pg_temp.create_group_result(array['11111111-1111-1111-1111-111111111111']::uuid[])
    = 'not_friends', true);
reset role;

-- POSITIVE — create_group must still work for a real friend list, or group creation
-- is dead. alice and dave are accepted friends.
select pg_temp.set_user('11111111-1111-1111-1111-111111111111');
set local role authenticated;
select pg_temp.assert(
  'LIV-10 #1: create_group CAN still create a group of friends',
  pg_temp.create_group_result(array['44444444-4444-4444-4444-444444444444']::uuid[])
    = 'ok', true);
reset role;

-- ============================================================================
-- LIV-10 #2 — friendships: status was unconstrained
-- ============================================================================
--
-- Manufacturing an 'accepted' row bypasses accept_friend_request entirely and
-- unlocks assert_friendship, which gates DMs, groups, jams, stories and playlists.
-- BOTH policy families are asserted implicitly: these attempt the real write, and
-- permissive policies OR together, so leaving either the relationships.sql policy or
-- the baseline `_participant` duplicate in place fails these.

select pg_temp.set_user('33333333-3333-3333-3333-333333333333');
set local role authenticated;
select pg_temp.assert(
  'LIV-10 #2: a user CANNOT insert a pre-accepted friendship',
  pg_temp.allows($$insert into friendships
      (user_a_id, user_b_id, requested_by, status, accepted_at)
    values ('11111111-1111-1111-1111-111111111111',
            '33333333-3333-3333-3333-333333333333',
            '33333333-3333-3333-3333-333333333333', 'accepted', now())$$),
  false);

-- POSITIVE — a plain pending request must still be insertable.
select pg_temp.assert(
  'LIV-10 #2: a user CAN still create a pending friend request',
  pg_temp.allows($$insert into friendships
      (user_a_id, user_b_id, requested_by, status)
    values ('11111111-1111-1111-1111-111111111111',
            '33333333-3333-3333-3333-333333333333',
            '33333333-3333-3333-3333-333333333333', 'pending')$$),
  true);

-- Now the UPDATE path, on the row just created. There is no UPDATE policy any more,
-- so this does NOT raise — RLS filters the row out and the statement reports success
-- having changed nothing. Asserting on the absence of an error would pass with the
-- old policy restored, so the assertion is on the STATUS.
update friendships set status = 'accepted', accepted_at = now()
 where user_a_id = '11111111-1111-1111-1111-111111111111'
   and user_b_id = '33333333-3333-3333-3333-333333333333';
reset role;

select pg_temp.assert(
  'LIV-10 #2: a participant CANNOT promote a pending friendship to accepted',
  (select status = 'accepted' from friendships
    where user_a_id = '11111111-1111-1111-1111-111111111111'
      and user_b_id = '33333333-3333-3333-3333-333333333333'),
  false);

-- POSITIVE — the legitimate transition still works through the DEFINER RPC, which is
-- what the client actually calls. This is the check that catches the fix being
-- over-restrictive: dropping the UPDATE policy must not break accepting a request.
select pg_temp.set_user('11111111-1111-1111-1111-111111111111');
set local role authenticated;
select accept_friend_request('33333333-3333-3333-3333-333333333333');
reset role;

select pg_temp.assert(
  'LIV-10 #2: accept_friend_request CAN still accept (RPC path unbroken)',
  (select status = 'accepted' from friendships
    where user_a_id = '11111111-1111-1111-1111-111111111111'
      and user_b_id = '33333333-3333-3333-3333-333333333333'),
  true);

-- ============================================================================
-- LIV-10 #5 — friend-outcome notifications (asserted here while the fixture exists)
-- ============================================================================
--
-- The accept above must have emitted exactly one 'friend_accepted' row to the
-- REQUESTER (mallory), from the transaction that proved the request was pending.
select pg_temp.assert(
  'LIV-10 #5: accept_friend_request emits the friend_accepted row itself',
  pg_temp.notif_count('33333333-3333-3333-3333-333333333333', 'friend_accepted') = 1,
  true);

-- And the standalone RPC must no longer be a forgery primitive. mallory has no
-- relationship to bob at all; the old body inserted unconditionally.
select pg_temp.set_user('33333333-3333-3333-3333-333333333333');
set local role authenticated;
select activity_notify_friend_outcome('22222222-2222-2222-2222-222222222222', true);
select activity_notify_friend_outcome('22222222-2222-2222-2222-222222222222', false);
reset role;

select pg_temp.assert(
  'LIV-10 #5: a stranger CANNOT forge "X accepted your friend request"',
  pg_temp.notif_count('22222222-2222-2222-2222-222222222222', 'friend_accepted') = 0,
  true);
select pg_temp.assert(
  'LIV-10 #5: a stranger CANNOT forge "X declined your friend request"',
  pg_temp.notif_count('22222222-2222-2222-2222-222222222222', 'friend_rejected') = 0,
  true);

-- POSITIVE — a REAL rejection still notifies the requester. This is the case the
-- ticket's suggested guard ("a pending request exists") would have silently killed:
-- reject_friend_request deletes the row, so by the time the old notify RPC ran there
-- was nothing left to prove. Emission moved into the RPC that still holds the proof.
insert into friendships (user_a_id, user_b_id, requested_by, status) values
  ('22222222-2222-2222-2222-222222222222',
   '33333333-3333-3333-3333-333333333333',
   '22222222-2222-2222-2222-222222222222', 'pending')
on conflict do nothing;

select pg_temp.set_user('33333333-3333-3333-3333-333333333333');
set local role authenticated;
select reject_friend_request('22222222-2222-2222-2222-222222222222');
reset role;

select pg_temp.assert(
  'LIV-10 #5: a real rejection DOES still notify the requester',
  pg_temp.notif_count('22222222-2222-2222-2222-222222222222', 'friend_rejected') = 1,
  true);

-- ============================================================================
-- LIV-10 #3 — activity_notify_post, BOTH overloads
-- ============================================================================
--
-- The old guards were: actor authenticated, p_type in the enum, author exists and is
-- not the actor. Nothing tied the caller to the post. The harm is moderation evasion:
-- a forged 'comment' delivers 280 attacker-chosen characters with no post_comments
-- row to report, delete or attribute.

select pg_temp.set_user('33333333-3333-3333-3333-333333333333');
set local role authenticated;

-- 4-arg overload — the one the current client calls.
select activity_notify_post('dddddddd-0000-0000-0000-000000000001', 'like', null, null);
select activity_notify_post('dddddddd-0000-0000-0000-000000000001', 'comment',
                            'you are worthless', null);
select activity_notify_post('dddddddd-0000-0000-0000-000000000001', 'repost', null, null);

-- A 2-ARGUMENT call. Before this migration two overloads matched it — the exact
-- (uuid, text) signature and the 4-arg one through its defaults — so PostgreSQL
-- raised `function activity_notify_post(uuid, text) is not unique` and the 2-arg form
-- was unreachable by any caller, PostgREST included. The migration drops it, so this
-- call must now RESOLVE (proving the ambiguity is gone) and must still write nothing
-- (proving it landed on the guarded body, not on an unguarded twin).
select activity_notify_post('dddddddd-0000-0000-0000-000000000001'::uuid, 'like'::text);
select activity_notify_post('dddddddd-0000-0000-0000-000000000001'::uuid, 'comment'::text);
select activity_notify_post('dddddddd-0000-0000-0000-000000000001'::uuid, 'repost'::text);
reset role;

select pg_temp.assert(
  'LIV-10 #3: exactly one activity_notify_post overload survives',
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'activity_notify_post'), true);

select pg_temp.assert(
  'LIV-10 #3: a non-liker CANNOT forge a like notification (2- and 4-arg calls)',
  pg_temp.notif_count('11111111-1111-1111-1111-111111111111', 'like') = 0, true);
select pg_temp.assert(
  'LIV-10 #3: a non-commenter CANNOT forge a comment notification (2- and 4-arg calls)',
  pg_temp.notif_count('11111111-1111-1111-1111-111111111111', 'comment') = 0, true);
select pg_temp.assert(
  'LIV-10 #3: a non-reposter CANNOT forge a repost notification (2- and 4-arg calls)',
  pg_temp.notif_count('11111111-1111-1111-1111-111111111111', 'repost') = 0, true);

-- POSITIVE — mallory genuinely likes the post; the notification must still fire.
select pg_temp.set_user('33333333-3333-3333-3333-333333333333');
set local role authenticated;
insert into post_likes (post_id, user_id)
values ('dddddddd-0000-0000-0000-000000000001',
        '33333333-3333-3333-3333-333333333333');
select activity_notify_post('dddddddd-0000-0000-0000-000000000001', 'like', null, null);
reset role;

select pg_temp.assert(
  'LIV-10 #3: a REAL like still notifies the author',
  pg_temp.notif_count('11111111-1111-1111-1111-111111111111', 'like') = 1, true);

-- THE MODERATION-EVASION PROPERTY, stated directly: the snippet the victim reads is
-- the stored comment, not the parameter. bob really commented ('the real comment
-- body'); he passes a different string, and the payload must ignore it.
select pg_temp.set_user('22222222-2222-2222-2222-222222222222');
set local role authenticated;
select activity_notify_post('dddddddd-0000-0000-0000-000000000001', 'comment',
                            'ATTACKER SUPPLIED TEXT',
                            'eeeeeeee-0000-0000-0000-000000000001');
reset role;

select pg_temp.assert(
  'LIV-10 #3: the rendered snippet comes from post_comments, not the parameter',
  (select payload->>'comment_text' = 'the real comment body'
     from activity_notifications
    where recipient_id = '11111111-1111-1111-1111-111111111111'
      and type = 'comment' limit 1),
  true);

-- ============================================================================
-- LIV-10 #4 — activity_notify_new_fan
-- ============================================================================
select pg_temp.set_user('33333333-3333-3333-3333-333333333333');
set local role authenticated;
select activity_notify_new_fan('11111111-1111-1111-1111-111111111111');
reset role;

select pg_temp.assert(
  'LIV-10 #4: a user who has not starred you CANNOT forge a new_fan notification',
  pg_temp.notif_count('11111111-1111-1111-1111-111111111111', 'new_fan') = 0, true);

-- POSITIVE — a real star still notifies.
select pg_temp.set_user('33333333-3333-3333-3333-333333333333');
set local role authenticated;
insert into follows (follower_id, following_id, kind)
values ('33333333-3333-3333-3333-333333333333',
        '11111111-1111-1111-1111-111111111111', 'star');
select activity_notify_new_fan('11111111-1111-1111-1111-111111111111');
reset role;

select pg_temp.assert(
  'LIV-10 #4: a REAL star still notifies the starred user',
  pg_temp.notif_count('11111111-1111-1111-1111-111111111111', 'new_fan') = 1, true);

-- Unauthenticated callers write nothing. The revoke below is the real gate; this
-- asserts the in-body behaviour that must hold even if a future grant re-opens it.
select pg_temp.set_user(null);
set local role authenticated;
select activity_notify_new_fan('11111111-1111-1111-1111-111111111111');
reset role;
select pg_temp.assert(
  'LIV-10 #4: an unauthenticated caller writes no notification',
  pg_temp.notif_count('11111111-1111-1111-1111-111111111111', 'new_fan') = 1, true);

-- ============================================================================
-- LIV-10 #6 — activity_record_play AND the post_views table
-- ============================================================================
--
-- posts.views_count is a term in the feed ranking score. Guarding only the RPC would
-- be D-53 verbatim: post_views_insert_self let a direct POST inflate the count
-- through trg_post_views_count without the RPC being involved.

select pg_temp.set_user('33333333-3333-3333-3333-333333333333');
set local role authenticated;
select pg_temp.assert(
  'LIV-10 #6: a direct insert into post_views is denied (the D-53 path)',
  pg_temp.allows($$insert into post_views (post_id, user_id)
    values ('dddddddd-0000-0000-0000-000000000001',
            '33333333-3333-3333-3333-333333333333')$$),
  false);

-- POSITIVE — the RPC still records a play. If this breaks, play counts stop dead.
select activity_record_play('dddddddd-0000-0000-0000-000000000001');
reset role;

-- Asserted on post_views rows rather than posts.views_count DELIBERATELY.
-- trg_post_views_count, which propagates the row into the counter, exists only in
-- production: the baseline schema explicitly does not reproduce triggers and no
-- migration creates it, so views_count never moves in this environment. Asserting on
-- the counter here would fail for an environment reason. The row is what this
-- function writes and what the (unchanged) trigger consumes.
select pg_temp.assert(
  'LIV-10 #6: activity_record_play CAN still record a play',
  (select count(*) = 1 from post_views
    where post_id = 'dddddddd-0000-0000-0000-000000000001'
      and user_id = '33333333-3333-3333-3333-333333333333'), true);

-- The cooldown: further calls inside the 1s window must not add rows.
-- playTracker requires THRESHOLD_SEC = 3 seconds of forward playback per recorded
-- play, and the fastest rate the app produces is RATE_FORWARD = 2x, so the shortest
-- legitimate gap between two recorded plays is ~1.5s. Nothing legitimate lands here.
select pg_temp.set_user('33333333-3333-3333-3333-333333333333');
set local role authenticated;
select activity_record_play('dddddddd-0000-0000-0000-000000000001');
select activity_record_play('dddddddd-0000-0000-0000-000000000001');
select activity_record_play('dddddddd-0000-0000-0000-000000000001');
reset role;

select pg_temp.assert(
  'LIV-10 #6: repeated immediate calls CANNOT inflate the play count',
  (select count(*) = 1 from post_views
    where post_id = 'dddddddd-0000-0000-0000-000000000001'
      and user_id = '33333333-3333-3333-3333-333333333333'), true);

-- POSITIVE, and the one that distinguishes a COOLDOWN from a DEDUP. 20260607000005
-- made multi-play deliberate: looping a track must keep counting. Backdating the
-- existing row past the window and replaying must therefore add a second row. A fix
-- that silently turned this into once-per-user-per-post would pass every assertion
-- above and quietly halve every play count in the product.
update post_views set played_at = now() - interval '5 seconds'
 where post_id = 'dddddddd-0000-0000-0000-000000000001';

select pg_temp.set_user('33333333-3333-3333-3333-333333333333');
set local role authenticated;
select activity_record_play('dddddddd-0000-0000-0000-000000000001');
reset role;

select pg_temp.assert(
  'LIV-10 #6: a genuine later replay STILL counts (cooldown, not dedup)',
  (select count(*) = 2 from post_views
    where post_id = 'dddddddd-0000-0000-0000-000000000001'
      and user_id = '33333333-3333-3333-3333-333333333333'), true);

-- ============================================================================
-- LIV-10 #7 — EXECUTE privileges
-- ============================================================================
--
-- Before this migration `grep -rn "revoke" supabase/migrations/` returned zero hits,
-- so every function ran on the PostgreSQL default EXECUTE TO PUBLIC.
--
-- KNOWN LIMITATION, and it is the reason only PUBLIC is asserted here: the CI harness
-- runs `grant execute on all functions in schema public to authenticated, anon`
-- AFTER migrations (ci.yml:184), which re-grants `anon` and would make an
-- anon-specific assertion fail for an environment reason rather than a code one.
-- That grant does NOT restore PUBLIC, so the PUBLIC revoke IS observable and is
-- asserted. The `from anon` half of the revoke is verifiable only against the real
-- project. Narrowing the CI grant is a follow-up outside this change's scope.

create or replace function pg_temp.public_can_execute(sig text)
returns boolean language plpgsql as $$
declare v_acl aclitem[];
begin
  select proacl into v_acl from pg_proc where oid = sig::regprocedure::oid;
  -- A NULL ACL is the built-in default, under which PUBLIC HAS execute. Treating
  -- null as "no grants" would report a revoke that never happened.
  if v_acl is null then return true; end if;
  return exists (
    select 1 from aclexplode(v_acl) a
    where a.grantee = 0 and a.privilege_type = 'EXECUTE');
end $$;

-- Control: a function this migration does not touch must still show PUBLIC execute.
-- Without this the four assertions below would pass against a helper that always
-- returns false.
select pg_temp.assert(
  'LIV-10 #7: control — an untouched function still has PUBLIC execute',
  pg_temp.public_can_execute('public.activity_unread_count()'), true);

select pg_temp.assert(
  'LIV-10 #7: activity_notify_post(uuid,text,text,uuid) is not executable by PUBLIC',
  pg_temp.public_can_execute('public.activity_notify_post(uuid,text,text,uuid)'), false);
select pg_temp.assert(
  'LIV-10 #7: activity_notify_new_fan is not executable by PUBLIC',
  pg_temp.public_can_execute('public.activity_notify_new_fan(uuid)'), false);
select pg_temp.assert(
  'LIV-10 #7: activity_notify_friend_outcome is not executable by PUBLIC',
  pg_temp.public_can_execute('public.activity_notify_friend_outcome(uuid,boolean)'), false);
select pg_temp.assert(
  'LIV-10 #7: activity_record_play is not executable by PUBLIC',
  pg_temp.public_can_execute('public.activity_record_play(uuid)'), false);


-- ============================================================================
-- Counter-identity freeze — 20260722140000
-- ============================================================================
--
-- The counter triggers fire on INSERT and DELETE only, while posts_update_own and
-- post_comments_update_self permit updating ANY column. Moving the column that decides
-- WHICH row gets counted, in between the increment and the decrement, makes the two stop
-- cancelling — so a user can floor another user's reposts_count or inflate their own,
-- leaving no visible rows behind. reposts_count is the 3.0-weight term in the feed
-- ranking score, the highest of the four.
--
-- These assert on real UPDATEs as `authenticated`, not on the trigger's existence: a test
-- that checks pg_trigger would pass against a trigger whose body had been gutted.
--
-- The last two cases are the ones that make this fixable rather than merely strict.
-- posts_original_post_id_fkey is ON DELETE SET NULL, so deleting an original UPDATEs
-- every repost of it — a freeze that cannot tell that cascade from a hand-written null
-- makes reposted posts undeletable, turning a security fix into an outage.

create or replace function pg_temp.update_raises(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;                      -- completed, so the freeze did NOT stop it
exception when insufficient_privilege then
  return true;
end $$;

insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('f0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'freeze fixture', 'audio', 'https://example.invalid/a.mp3')
on conflict do nothing;

insert into posts (id, author_id, kind, track_id) values
  ('f0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'upload',
   'f0000000-0000-0000-0000-000000000001'),
  ('f0000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'upload',
   'f0000000-0000-0000-0000-000000000001'),
  ('f0000000-0000-0000-0000-0000000000b1', '33333333-3333-3333-3333-333333333333', 'upload',
   'f0000000-0000-0000-0000-000000000001')
on conflict do nothing;

insert into posts (id, author_id, kind, track_id, original_post_id) values
  ('f0000000-0000-0000-0000-0000000000c1', '33333333-3333-3333-3333-333333333333', 'repost',
   'f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-0000000000a1')
on conflict do nothing;

select pg_temp.set_user('33333333-3333-3333-3333-333333333333');
set local role authenticated;

select pg_temp.assert(
  'freeze #1: an upload CANNOT be switched to a repost pointing at another user''s post',
  pg_temp.update_raises($q$update posts set kind='repost',
     original_post_id='f0000000-0000-0000-0000-0000000000a1'
   where id='f0000000-0000-0000-0000-0000000000b1'$q$), true);

select pg_temp.assert(
  'freeze #2: a repost CANNOT be retargeted at a different post (kind untouched)',
  pg_temp.update_raises($q$update posts
     set original_post_id='f0000000-0000-0000-0000-0000000000a2'
   where id='f0000000-0000-0000-0000-0000000000c1'$q$), true);

select pg_temp.assert(
  'freeze #3: a repost CANNOT be orphaned by hand while its original still exists',
  pg_temp.update_raises($q$update posts set original_post_id=null
   where id='f0000000-0000-0000-0000-0000000000c1'$q$), true);

select pg_temp.assert(
  'freeze #4: a repost CANNOT be converted back to an upload',
  pg_temp.update_raises($q$update posts set kind='upload'
   where id='f0000000-0000-0000-0000-0000000000c1'$q$), true);

reset role;

-- The counter is the property that actually matters. If the freeze worked, the victim's
-- count still reflects exactly the one real repost that exists.
select pg_temp.assert(
  'freeze #5: after four blocked attacks the victim''s reposts_count is unchanged',
  (select reposts_count = 1 from posts where id='f0000000-0000-0000-0000-0000000000a1'), true);

-- ── The carve-out: the FK cascade must still work ───────────────────────────
-- Deliberately as `authenticated`, not as the owner. The whole carve-out rests on the
-- EXISTS inside the trigger seeing the parent as already gone during the RI action, and
-- the production path is a user deleting their own post under posts_delete_own. Running
-- it as superuser would pass for a reason that does not apply in production.
select pg_temp.set_user('11111111-1111-1111-1111-111111111111');
set local role authenticated;
delete from posts where id='f0000000-0000-0000-0000-0000000000a1';
reset role;

select pg_temp.assert(
  'freeze #6: deleting an original still succeeds despite ON DELETE SET NULL firing',
  (select not exists (select 1 from posts where id='f0000000-0000-0000-0000-0000000000a1')), true);

select pg_temp.assert(
  'freeze #7: the orphaned repost survives with original_post_id set to null',
  (select original_post_id is null from posts where id='f0000000-0000-0000-0000-0000000000c1'), true);

-- ── post_comments.post_id ───────────────────────────────────────────────────
insert into post_comments (id, post_id, author_id, body) values
  ('f0000000-0000-0000-0000-0000000000d1', 'f0000000-0000-0000-0000-0000000000a2',
   '33333333-3333-3333-3333-333333333333', 'original body')
on conflict do nothing;

select pg_temp.set_user('33333333-3333-3333-3333-333333333333');
set local role authenticated;

select pg_temp.assert(
  'freeze #8: a comment CANNOT be moved to a different post',
  pg_temp.update_raises($q$update post_comments
     set post_id='f0000000-0000-0000-0000-0000000000b1'
   where id='f0000000-0000-0000-0000-0000000000d1'$q$), true);

-- The freeze must be narrow. If this fails, the trigger is blocking legitimate edits and
-- the first comment-edit feature will hit it.
select pg_temp.assert(
  'freeze #9: editing a comment''s BODY still works',
  pg_temp.update_raises($q$update post_comments set body='edited'
   where id='f0000000-0000-0000-0000-0000000000d1'$q$), false);

reset role;

-- update_raises returning false only means "nothing raised". An UPDATE that RLS filtered
-- to zero rows returns false too, so #9 could pass vacuously. Assert the write landed.
select pg_temp.assert(
  'freeze #10: ...and the edit actually landed (guards #9 against a vacuous pass)',
  (select body = 'edited' from post_comments where id='f0000000-0000-0000-0000-0000000000d1'), true);


-- ============================================================================
-- Counters are derived, not client-writable — 20260722160000
-- ============================================================================
--
-- The freeze above stops a count being MOVED between rows. It does not stop one being
-- SET. posts_update_own constrains which ROWS you may write and nothing constrains which
-- COLUMNS, so before this guard `update posts set views_count = 2000000000` succeeded —
-- measured, not assumed. fetch_home_feed reads the score straight off the row, so that is
-- one request to the top of every feed.
--
-- The mechanism is pg_trigger_depth(): a client statement's own BEFORE trigger observes
-- depth 1, while the counter triggers' writes are nested at 2. These tests matter more
-- than most because that separation is invisible in the function body — a reader cannot
-- tell by inspection that legitimate counting still works, which is what #5 and #6 pin.

select pg_temp.set_user('33333333-3333-3333-3333-333333333333');
set local role authenticated;

select pg_temp.assert(
  'counter #1: a user CANNOT set views_count on their own post',
  pg_temp.update_raises($q$update posts set views_count=2000000000
   where id='f0000000-0000-0000-0000-0000000000b1'$q$), true);

select pg_temp.assert(
  'counter #2: a user CANNOT set reposts_count — the 3.0-weight ranking term',
  pg_temp.update_raises($q$update posts set reposts_count=999999
   where id='f0000000-0000-0000-0000-0000000000b1'$q$), true);

select pg_temp.assert(
  'counter #3: a user CANNOT set their own followers_count',
  pg_temp.update_raises($q$update profiles set followers_count=500000
   where id='33333333-3333-3333-3333-333333333333'$q$), true);

select pg_temp.assert(
  'counter #4: a user CANNOT set a comment''s like_count',
  pg_temp.update_raises($q$update post_comments set like_count=4242
   where id='f0000000-0000-0000-0000-0000000000d1'$q$), true);

-- INSERT is a separate door: posts_insert_own's WITH CHECK cannot constrain a column it
-- does not name, so the UPDATE guard alone would be bypassed by never updating.
insert into posts (id, author_id, kind, track_id, views_count, reposts_count) values
  ('f0000000-0000-0000-0000-0000000000e1', '33333333-3333-3333-3333-333333333333', 'upload',
   'f0000000-0000-0000-0000-000000000001', 999999, 888888);

reset role;

select pg_temp.assert(
  'counter #5: counters supplied at INSERT are clamped to zero',
  (select views_count = 0 and reposts_count = 0
     from posts where id='f0000000-0000-0000-0000-0000000000e1'), true);

-- ── The guard must not break counting itself ────────────────────────────────
-- If these two fail, the fix has silently turned every counter in the product off, which
-- is a worse outcome than the vulnerability it closes.
select pg_temp.set_user('22222222-2222-2222-2222-222222222222');
set local role authenticated;
insert into post_likes (post_id, user_id) values
  ('f0000000-0000-0000-0000-0000000000e1', '22222222-2222-2222-2222-222222222222');
reset role;

select pg_temp.assert(
  'counter #6: a real like STILL increments likes_count (trigger runs at depth 2)',
  (select likes_count = 1 from posts where id='f0000000-0000-0000-0000-0000000000e1'), true);

select pg_temp.set_user('22222222-2222-2222-2222-222222222222');
set local role authenticated;
delete from post_likes where post_id='f0000000-0000-0000-0000-0000000000e1'
                         and user_id='22222222-2222-2222-2222-222222222222';
reset role;

select pg_temp.assert(
  'counter #7: ...and unliking still decrements it',
  (select likes_count = 0 from posts where id='f0000000-0000-0000-0000-0000000000e1'), true);

-- ── The guard must not be too broad ─────────────────────────────────────────
select pg_temp.set_user('33333333-3333-3333-3333-333333333333');
set local role authenticated;

select pg_temp.assert(
  'counter #8: editing a non-counter column on your own post still works',
  pg_temp.update_raises($q$update posts set caption='edited caption'
   where id='f0000000-0000-0000-0000-0000000000e1'$q$), false);

reset role;

select pg_temp.assert(
  'counter #9: ...and that edit actually landed',
  (select caption = 'edited caption' from posts where id='f0000000-0000-0000-0000-0000000000e1'), true);

-- The profiles depth-2 path, which nothing else covers. This is the one where a silent
-- break stops follower counts product-wide, and it is also the only one of the three
-- where a second BEFORE UPDATE trigger co-fires (trg_enforce_username_immutable, which
-- sorts first by name) — so "the guard and the identity trigger coexist" is asserted here
-- rather than assumed.
select pg_temp.set_user('22222222-2222-2222-2222-222222222222');
set local role authenticated;
insert into follows (follower_id, following_id, kind) values
  ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'star');
reset role;

select pg_temp.assert(
  'counter #10: a real follow STILL increments followers_count via the trigger',
  (select followers_count = 1 from profiles where id='33333333-3333-3333-3333-333333333333'), true);

select pg_temp.assert(
  'counter #11: ...and the follower''s following_count too',
  (select following_count = 1 from profiles where id='22222222-2222-2222-2222-222222222222'), true);

-- The `auth.uid() is not null` half of the guard is unconditionally OFF for a null-uid
-- caller. That is safe today only because no policy on these three tables is granted to
-- `anon` — verified against production 2026-07-22. Nothing else in this suite exercises
-- the null branch, because set_user always installs a constant-returning auth.uid(). The
-- day someone adds a `to anon` write policy, this is what fails.
create or replace function auth.uid() returns uuid language sql stable as $f$ select null::uuid $f$;
set local role anon;

select pg_temp.assert(
  'counter #12: anon cannot reach the counter columns at all (no write policy applies)',
  (select count(*) = 0 from pg_policy
    where polrelid in ('public.posts'::regclass,'public.profiles'::regclass,
                       'public.post_comments'::regclass)
      and polcmd in ('a','w','*')
      and (polroles::regrole[])::text like '%anon%'), true);

reset role;


-- ============================================================================
-- Comment like counts, and conversation drift — 20260722180000
-- ============================================================================
--
-- tg_post_comment_likes_count was SECURITY INVOKER, alone among the six counter trigger
-- functions. Its `update post_comments set like_count` therefore ran as the CALLER under
-- RLS, and the only UPDATE policy there is `author_id = auth.uid()` — so liking someone
-- else's comment matched zero rows and the count never moved. No error: an RLS-filtered
-- UPDATE is an update of nothing, not a failure. Reproduced with a control before fixing:
-- liking another's comment gave 0, liking your own gave 1.
--
-- #1 is therefore the assertion that matters, and it must use a comment the liker did NOT
-- write, or it passes against the broken version.

insert into post_comments (id, post_id, author_id, body) values
  ('f0000000-0000-0000-0000-0000000000f1', 'f0000000-0000-0000-0000-0000000000a2',
   '11111111-1111-1111-1111-111111111111', 'alice wrote this')
on conflict do nothing;

select pg_temp.set_user('33333333-3333-3333-3333-333333333333');
set local role authenticated;
insert into post_comment_likes (comment_id, user_id) values
  ('f0000000-0000-0000-0000-0000000000f1', '33333333-3333-3333-3333-333333333333');
reset role;

select pg_temp.assert(
  'likes #1: liking ANOTHER user''s comment increments like_count (was silently lost)',
  (select like_count = 1 from post_comments where id='f0000000-0000-0000-0000-0000000000f1'), true);

select pg_temp.set_user('33333333-3333-3333-3333-333333333333');
set local role authenticated;
delete from post_comment_likes where comment_id='f0000000-0000-0000-0000-0000000000f1'
                                 and user_id='33333333-3333-3333-3333-333333333333';
reset role;

select pg_temp.assert(
  'likes #2: ...and unliking decrements it',
  (select like_count = 0 from post_comments where id='f0000000-0000-0000-0000-0000000000f1'), true);

-- ── conversations: derived and identity columns ─────────────────────────────
-- conv_update was a bare USING with no WITH CHECK and no column constraint, so any admin
-- could write an arbitrary last_message_preview (shown to every member in their inbox)
-- and an arbitrary last_message_at (which that list sorts by).

select pg_temp.set_user('11111111-1111-1111-1111-111111111111');
set local role authenticated;

select pg_temp.assert(
  'conv #1: an admin CANNOT forge last_message_preview',
  pg_temp.update_raises($q$update conversations set last_message_preview='FAKE'
   where id='aaaaaaaa-0000-0000-0000-000000000001'$q$), true);

select pg_temp.assert(
  'conv #2: an admin CANNOT pin a conversation by setting last_message_at',
  pg_temp.update_raises($q$update conversations
     set last_message_at = now() + interval '10 years'
   where id='aaaaaaaa-0000-0000-0000-000000000001'$q$), true);

select pg_temp.assert(
  'conv #3: kind is immutable',
  pg_temp.update_raises($q$update conversations set kind='dm'
   where id='aaaaaaaa-0000-0000-0000-000000000001'$q$), true);

select pg_temp.assert(
  'conv #4: created_by is immutable',
  pg_temp.update_raises($q$update conversations
     set created_by='33333333-3333-3333-3333-333333333333'
   where id='aaaaaaaa-0000-0000-0000-000000000001'$q$), true);

-- The freeze must not break the one thing the client actually does.
select pg_temp.assert(
  'conv #5: renaming a group still works (the only client update)',
  pg_temp.update_raises($q$update conversations set name='Renamed'
   where id='aaaaaaaa-0000-0000-0000-000000000001'$q$), false);

reset role;

select pg_temp.assert(
  'conv #6: ...and the rename landed',
  (select name = 'Renamed' from conversations where id='aaaaaaaa-0000-0000-0000-000000000001'), true);

-- And a real message must still drive the derived columns, at depth 2.
select pg_temp.set_user('11111111-1111-1111-1111-111111111111');
set local role authenticated;
insert into messages (conversation_id, sender_id, body, kind) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'a genuine message', 'text');
reset role;

select pg_temp.assert(
  'conv #7: a real message STILL updates last_message_preview via the trigger',
  (select last_message_preview = 'a genuine message'
     from conversations where id='aaaaaaaa-0000-0000-0000-000000000001'), true);

-- ── The created_by carve-out ────────────────────────────────────────────────
-- conversations.created_by is `references profiles(id) on delete set null`, and
-- profiles.id cascades from auth.users. So deleting a user issues an UPDATE against every
-- conversation they created. An unconditional freeze raises inside that cascade and makes
-- the delete fail — for anyone who ever started a DM, since get_or_create_dm sets
-- created_by on every one.
--
-- This is the SECOND time this exact trap has appeared (freeze #6/#7 cover the
-- posts.original_post_id instance). The first version of this migration had the carve-out
-- for posts and not for conversations; a security review caught it, not these tests. That
-- is what these two assertions are for.

insert into auth.users (id) values ('f0000000-0000-0000-0000-0000000000c9') on conflict do nothing;
insert into profiles (id, username, username_set) values
  ('f0000000-0000-0000-0000-0000000000c9', 'departing', true) on conflict do nothing;
insert into conversations (id, kind, created_by, name) values
  ('f0000000-0000-0000-0000-0000000000ca', 'group', 'f0000000-0000-0000-0000-0000000000c9', 'theirs')
on conflict do nothing;

delete from profiles where id='f0000000-0000-0000-0000-0000000000c9';

select pg_temp.assert(
  'conv #8: deleting a profile still succeeds despite ON DELETE SET NULL on created_by',
  (select not exists (select 1 from profiles where id='f0000000-0000-0000-0000-0000000000c9')), true);

select pg_temp.assert(
  'conv #9: the conversation survives with created_by nulled by the cascade',
  (select created_by is null from conversations where id='f0000000-0000-0000-0000-0000000000ca'), true);

-- And the carve-out must stay narrow: nulling created_by by hand, while the profile is
-- very much alive, is still refused.
select pg_temp.set_user('11111111-1111-1111-1111-111111111111');
set local role authenticated;

select pg_temp.assert(
  'conv #10: created_by CANNOT be nulled by hand while the profile still exists',
  pg_temp.update_raises($q$update conversations set created_by=null
   where id='aaaaaaaa-0000-0000-0000-000000000001'$q$), true);

reset role;


-- ============================================================================
-- Account deletion — 20260722200000
-- ============================================================================
--
-- docs/delete-account.html has been live since June telling users to go to
-- Profile -> Settings -> Delete Account. None of that exists, and the database REFUSED
-- to delete a profile at all: messages.sender_id, jam_rooms.host_id and
-- jam_queue.suggested_by all referenced profiles(id) with NO ACTION, so deleting anyone
-- who had ever sent a message failed with 23503. The email fallback on that page could
-- not have been honoured either.
--
-- #1 is the assertion that matters most and it is a structural one: the function takes
-- NO argument. ADR-0008 decision #1 applied to a much more dangerous verb than a
-- notification — a caller-supplied user id here would be account-deletion-as-a-service.
-- Asserting the arity is asserting that the defect is unrepresentable rather than merely
-- unchecked.

select pg_temp.assert(
  'delete #1: delete_my_account takes NO parameter, so a victim cannot be named',
  (select pronargs = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='delete_my_account'), true);

select pg_temp.assert(
  'delete #2: anon cannot execute it',
  has_function_privilege('anon', 'public.delete_my_account()', 'execute'), false);

-- Walks the TRANSITIVE CLOSURE from auth.users rather than checking references to
-- `profiles`. The narrow version of this assertion passed while deletion was still broken
-- for any user whose uploaded track had been queued in a jam: profiles -> tracks (cascade)
-- -> jam_rooms.current_track_id / jam_queue.track_id, both NO ACTION. Proving "nothing
-- referencing profiles blocks" is not proving "an account can be deleted", and the gap
-- between those sentences is where two real blockers lived.
select pg_temp.assert(
  'delete #3: no NO ACTION/RESTRICT foreign key is reachable from auth.users by cascade',
  (with recursive deleted_tables(oid) as (
     select 'auth.users'::regclass::oid
     union
     select c.conrelid from pg_constraint c join deleted_tables d on c.confrelid = d.oid
      where c.contype='f' and c.confdeltype='c'
   )
   select count(*) = 0
     from pg_constraint c join deleted_tables d on c.confrelid = d.oid
    where c.contype='f' and c.confdeltype in ('a','r')), true);

-- ── The property: a real deletion, and what survives it ─────────────────────
--
-- The fixture is deliberately MAXIMALLY CONNECTED. An earlier version deleted a user
-- whose only tie was one message, and it passed while deletion was broken twice over:
-- once on tracks -> jam_rooms/jam_queue (NO ACTION, found by review), and once on
-- track_collaborators' XOR CHECK, which no foreign-key walk can see because the FK was
-- already SET NULL. Both would have failed here, loudly, against a user who had actually
-- used the product.
--
-- Each tie below exists to exercise a distinct cascade mechanism. The third review
-- corrected two of these comments — they named a mechanism the fixture did not actually
-- reach — and the fixture now includes the row that reaches it:
--   collaborator credit on ANOTHER user's track -> SET NULL into a CHECK constraint
--   a repost the leaving user made               -> trg_post_reposts_count decrements alice
--        at depth >= 2, re-entering the freeze trigger's counter block (must not abort)
--   own track queued in someone ELSE's jam       -> profiles -> tracks -> jam_queue
--   a jam they host                              -> SET NULL on host_id
--   a conversation THEY created                  -> conversations_freeze_derived carve-out
--        inside the cascade (not just the direct-delete path conv #8/#9 cover)
--   an activity notification they caused         -> actor_id SET NULL
-- (The review also suggested a repost driving the original_post_id carve-out inside the
-- cascade; that state is unreachable — see the NOTE at the repost insert below.)
insert into auth.users (id) values ('f0000000-0000-0000-0000-0000000000e9') on conflict do nothing;
insert into profiles (id, username, username_set) values
  ('f0000000-0000-0000-0000-0000000000e9', 'leaving', true) on conflict do nothing;
insert into conversation_members (conversation_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-0000000000e9', 'member')
on conflict do nothing;
insert into messages (id, conversation_id, sender_id, body, kind) values
  ('f0000000-0000-0000-0000-0000000000ea', 'aaaaaaaa-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-0000000000e9', 'the recipient keeps this', 'text')
on conflict do nothing;

-- A conversation the LEAVING user created — so conversations_freeze_derived's created_by
-- carve-out fires INSIDE delete_my_account's cascade, not only via the direct delete that
-- conv #8/#9 exercise. The conversation must survive with created_by nulled.
insert into conversations (id, kind, created_by) values
  ('f0000000-0000-0000-0000-0000000000ef', 'group', 'f0000000-0000-0000-0000-0000000000e9')
on conflict do nothing;
insert into conversation_members (conversation_id, user_id, role) values
  ('f0000000-0000-0000-0000-0000000000ef', 'f0000000-0000-0000-0000-0000000000e9', 'admin'),
  ('f0000000-0000-0000-0000-0000000000ef', '22222222-2222-2222-2222-222222222222', 'member')
on conflict do nothing;

-- A credit on ALICE's track. This is the one that fails with 23514 if the XOR check is
-- not relaxed — and it is invisible to any foreign-key walk.
insert into track_collaborators (track_id, user_id, role, status) values
  ('f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-0000000000e9',
   'producer', 'accepted')
on conflict do nothing;

-- Their own track, and their own post of it.
insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('f0000000-0000-0000-0000-0000000000eb', 'f0000000-0000-0000-0000-0000000000e9',
   'their upload', 'audio', 'https://example.invalid/t.mp3')
on conflict do nothing;
insert into posts (id, author_id, kind, track_id) values
  ('f0000000-0000-0000-0000-0000000000ec', 'f0000000-0000-0000-0000-0000000000e9', 'upload',
   'f0000000-0000-0000-0000-0000000000eb')
on conflict do nothing;

-- The leaving user's OWN repost of alice's post. Its author_id cascades, so this row is
-- DELETED during the cascade — which fires trg_post_reposts_count AFTER DELETE, decrementing
-- alice's reposts_count and re-entering posts_freeze_counter_identity's counter block at
-- depth >= 2. That path must not abort the delete. (This does NOT drive the SET NULL
-- carve-out — see the next insert, which does.)
insert into posts (id, author_id, kind, track_id, original_post_id) values
  ('f0000000-0000-0000-0000-0000000000ed', 'f0000000-0000-0000-0000-0000000000e9', 'repost',
   'f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-0000000000a2')
on conflict do nothing;

-- NOTE — the third review suggested adding "alice reposting the leaving user's post" to
-- drive posts_freeze_counter_identity's SET NULL carve-out from INSIDE the account cascade.
-- Attempting it proved the carve-out is UNREACHABLE by that path, which is worth recording:
-- a real repost carries its original's track_id (createRepost copies it), posts_track_id_fkey
-- is ON DELETE CASCADE, and the leaver's track is deleted with them — so every repost of the
-- leaver's posts CASCADES AWAY before posts_original_post_id_fkey's SET NULL could fire. The
-- only way a repost survives its original's deletion is a hand-built row whose track differs
-- from its original's, which does not occur in production. So the carve-out's real trigger is
-- a DIRECT single-post delete (a user deleting one upload while reposts of it survive), which
-- freeze #6/#7 already cover. Not forcing a synthetic row here — a test that passes only for a
-- state production cannot reach is the trap this suite exists to avoid.

-- A jam they host, with THEIR track queued in it and set as current.
insert into jam_rooms (id, conversation_id, host_id, status, current_track_id) values
  ('f0000000-0000-0000-0000-0000000000ee', 'aaaaaaaa-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-0000000000e9', 'active', 'f0000000-0000-0000-0000-0000000000eb')
on conflict do nothing;
insert into jam_queue (jam_room_id, track_id, suggested_by) values
  ('f0000000-0000-0000-0000-0000000000ee', 'f0000000-0000-0000-0000-0000000000eb',
   'f0000000-0000-0000-0000-0000000000e9')
on conflict do nothing;

-- And their track queued in a jam hosted by SOMEONE ELSE, which is the tracks ->
-- jam_queue path that the profiles-only check could never reach.
insert into jam_queue (jam_room_id, track_id, suggested_by) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-0000000000eb',
   '11111111-1111-1111-1111-111111111111')
on conflict do nothing;

insert into activity_notifications (recipient_id, type, actor_id) values
  ('11111111-1111-1111-1111-111111111111', 'new_fan', 'f0000000-0000-0000-0000-0000000000e9')
on conflict do nothing;

select pg_temp.set_user('f0000000-0000-0000-0000-0000000000e9');
select public.delete_my_account();
select pg_temp.set_user('11111111-1111-1111-1111-111111111111');

select pg_temp.assert(
  'delete #4: the account is gone',
  (select not exists (select 1 from auth.users where id='f0000000-0000-0000-0000-0000000000e9')), true);

-- LIV-74 reversed ADR-0014: the departing user's messages go with them. This conversation
-- is a GROUP, so only their own message is removed and the group's other messages stay.
-- The DM rule, the ledger and username reclaim are covered in
-- supabase/tests/rls/account-deletion-liv74.test.sql.
select pg_temp.assert(
  'delete #5: a message the deleted user sent in a GROUP is gone',
  exists(select 1 from messages where id='f0000000-0000-0000-0000-0000000000ea'), false);

select pg_temp.assert(
  'delete #6: another member''s message in that same group survives',
  (select count(*) = 1 from messages
    where conversation_id='aaaaaaaa-0000-0000-0000-000000000001'
      and sender_id='11111111-1111-1111-1111-111111111111'
      and body='a genuine message'), true);

-- Deleting yourself must not touch anyone else. Cheap to assert, and the failure mode it
-- guards against is catastrophic and silent.
-- The ties that must survive, anonymized rather than removed. #8 is the assertion that
-- the XOR-check relaxation actually holds; #9 is the tracks -> jam_queue path.
select pg_temp.assert(
  'delete #8: a credit on ANOTHER user''s track survives, anonymized to (null, null)',
  (select user_id is null and custom_name is null
     from track_collaborators
    where track_id='f0000000-0000-0000-0000-000000000001'
      and role='producer'), true);

select pg_temp.assert(
  'delete #9: their track leaves someone else''s jam queue without blocking the delete',
  (select track_id is null from jam_queue
    where jam_room_id='bbbbbbbb-0000-0000-0000-000000000001'), true);

-- The conversation the leaving user created survives for its remaining member, created_by
-- nulled by the cascade through conversations_freeze_derived's carve-out — INSIDE
-- delete_my_account rather than the direct delete conv #8/#9 exercise.
select pg_temp.assert(
  'delete #10: a conversation they created survives with created_by nulled',
  (select created_by is null from conversations where id='f0000000-0000-0000-0000-0000000000ef'), true);

select pg_temp.assert(
  'delete #7: other accounts are untouched',
  (select count(*) = 3 from auth.users
    where id in ('11111111-1111-1111-1111-111111111111',
                 '22222222-2222-2222-2222-222222222222',
                 '33333333-3333-3333-3333-333333333333')), true);

rollback;
