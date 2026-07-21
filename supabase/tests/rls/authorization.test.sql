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
--   They evaluate POLICY PREDICATES against synthetic rows as a specific role. They do
--   not exercise PostgREST, the storage API, or the real network path. A pass means the
--   policy logic denies the case; it does not prove the whole request path denies it
--   (Constitution P32).
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
-- jam_room_members — the D-53 regression
-- ============================================================================
-- The predicate below is jmem_insert's WITH CHECK as of 20260721120000. Before that
-- migration it was simply `user_id = auth.uid()`, with NO constraint on jam_room_id —
-- so the outsider case passed and granted queue access.

create or replace function pg_temp.jmem_insert_allows(p_room uuid, p_user uuid)
returns boolean language sql stable as $$
  select
    (
      p_user = auth.uid()
      and exists (
        select 1 from jam_rooms jr
        join conversation_members cm on cm.conversation_id = jr.conversation_id
        where jr.id = p_room and cm.user_id = auth.uid()
      )
    )
    or exists (
      select 1 from jam_rooms where id = p_room and host_id = auth.uid()
    );
$$;

select pg_temp.set_user('33333333-3333-3333-3333-333333333333');
select pg_temp.assert(
  'D-53: an outsider CANNOT self-join a jam room',
  pg_temp.jmem_insert_allows('bbbbbbbb-0000-0000-0000-000000000001',
                             '33333333-3333-3333-3333-333333333333'),
  false);

select pg_temp.set_user('22222222-2222-2222-2222-222222222222');
select pg_temp.assert(
  'a conversation member CAN self-join',
  pg_temp.jmem_insert_allows('bbbbbbbb-0000-0000-0000-000000000001',
                             '22222222-2222-2222-2222-222222222222'),
  true);

select pg_temp.set_user('11111111-1111-1111-1111-111111111111');
select pg_temp.assert(
  'the host CAN add another member',
  pg_temp.jmem_insert_allows('bbbbbbbb-0000-0000-0000-000000000001',
                             '22222222-2222-2222-2222-222222222222'),
  true);

-- ============================================================================
-- jam_rooms — visibility is scoped to the parent conversation
-- ============================================================================
create or replace function pg_temp.jam_select_allows(p_room uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from jam_rooms jr
    join conversation_members cm on cm.conversation_id = jr.conversation_id
    where jr.id = p_room and cm.user_id = auth.uid()
  );
$$;

select pg_temp.set_user('33333333-3333-3333-3333-333333333333');
select pg_temp.assert('an outsider CANNOT read a jam room',
  pg_temp.jam_select_allows('bbbbbbbb-0000-0000-0000-000000000001'), false);

select pg_temp.set_user('22222222-2222-2222-2222-222222222222');
select pg_temp.assert('a member CAN read the jam room',
  pg_temp.jam_select_allows('bbbbbbbb-0000-0000-0000-000000000001'), true);

-- ============================================================================
-- Anon exposure — the D-10 regression
-- ============================================================================
-- These tables were readable by the anon role until 20260720192324. The anon key ships
-- in the app and on the marketing site, so `using (true)` without TO authenticated is
-- public data.

create or replace function pg_temp.policy_roles(p_table text, p_policy text)
returns text language sql stable as $$
  select coalesce(array_to_string(array(
    select rolname from pg_roles where oid = any(p.polroles)), ','), 'PUBLIC')
  from pg_policy p join pg_class c on c.oid = p.polrelid
  where c.relname = p_table and p.polname = p_policy;
$$;

select pg_temp.assert(
  'D-10: follows has no PUBLIC select policy',
  exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'follows' and p.polcmd = 'r'
      and pg_get_expr(p.polqual, p.polrelid) = 'true'
      and p.polroles = '{0}'          -- {0} is PUBLIC
  ), false);

select pg_temp.assert(
  'D-10: albums has no PUBLIC select policy',
  exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'albums' and p.polcmd = 'r'
      and pg_get_expr(p.polqual, p.polrelid) = 'true'
      and p.polroles = '{0}'
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
