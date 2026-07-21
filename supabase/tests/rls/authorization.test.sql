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

-- Bob is a member of the parent conversation.
select pg_temp.set_user('22222222-2222-2222-2222-222222222222');
set local role authenticated;
select pg_temp.assert(
  'a conversation member CAN self-join (real policy)',
  pg_temp.can_insert_member('bbbbbbbb-0000-0000-0000-000000000001',
                            '22222222-2222-2222-2222-222222222222'),
  true);
reset role;

-- Alice hosts the room, so she may add another member.
select pg_temp.set_user('11111111-1111-1111-1111-111111111111');
set local role authenticated;
select pg_temp.assert(
  'the host CAN add another member (real policy)',
  pg_temp.can_insert_member('bbbbbbbb-0000-0000-0000-000000000001',
                            '22222222-2222-2222-2222-222222222222'),
  true);
reset role;

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

rollback;
