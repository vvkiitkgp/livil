-- messages write-boundary tests — LIV-78. See ADR-0014 for the decision.
--
-- Covers both halves of the fix, which fail differently: the policy's WITH CHECK stops a
-- move into a conversation the caller is not in; the freeze trigger stops a move between
-- two they are in, which RLS cannot see because it cannot compare OLD to NEW.
--
-- Runs as `authenticated` against the deployed policy and trigger. Every denial is paired
-- with an assertion on the stored row: an UPDATE filtered out by USING affects zero rows
-- and raises nothing, so "no error" is not "no effect".
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/messages-write-boundary.test.sql
--
-- Exercises the database, not PostgREST (P32); where PostgREST behaviour is under test its
-- statement shape is replayed as SQL and labelled.

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

-- auth.uid() is stubbed per-case because there is no JWT in this context.
create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
end $$;

-- Runs a statement as the CURRENT role and reports whether the database allowed
-- it. SECURITY INVOKER (default), so `set local role authenticated` is respected
-- and RLS applies as it would to a PostgREST request. Both a WITH CHECK
-- violation and the freeze trigger raise insufficient_privilege (42501) → false.
create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when insufficient_privilege then return false;
end $$;

-- Real Supabase grants `authenticated` USAGE on the auth schema; the bare-Postgres
-- CI shim (ci.yml) does not. Policy subqueries here call auth.uid() as the
-- authenticated role. Granting it makes the environment faithful to production,
-- weakens no policy, and is rolled back with the transaction.
grant usage on schema auth to authenticated;

-- ── Fixtures (inserted as the table owner → RLS not applied to the setup) ────
-- SENDER writes the messages. RECIPIENT shares the source conversation with them
-- and is the person whose record the defect lets SENDER alter. OUTSIDER shares a
-- different conversation with SENDER, which is what makes the "move it somewhere
-- I am also allowed to be" case reachable.
insert into auth.users (id) values
  ('dddddddd-0000-0000-0000-000000000001'),  -- sender / author
  ('dddddddd-0000-0000-0000-000000000002'),  -- recipient (member, not author)
  ('dddddddd-0000-0000-0000-000000000003')   -- outsider (not in the source conv)
on conflict do nothing;

insert into profiles (id, username, username_set) values
  ('dddddddd-0000-0000-0000-000000000001', 'liv78_sender',    true),
  ('dddddddd-0000-0000-0000-000000000002', 'liv78_recipient', true),
  ('dddddddd-0000-0000-0000-000000000003', 'liv78_outsider',  true)
on conflict do nothing;

-- created_by is deliberately left null: `conversations.created_by` is ON DELETE
-- SET NULL, and step 6 deletes a profile — that cascade would UPDATE conversations
-- and trip conversations_freeze_derived, failing this test for an unrelated reason.
insert into conversations (id, kind) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'dm'),   -- SRC:     sender + recipient
  ('eeeeeeee-0000-0000-0000-000000000002', 'dm'),   -- ALT:     sender + outsider   (sender IS a member)
  ('eeeeeeee-0000-0000-0000-000000000003', 'dm')    -- FOREIGN: recipient + outsider (sender is NOT)
on conflict do nothing;

insert into conversation_members (conversation_id, user_id, role) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'member'),
  ('eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002', 'member'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001', 'member'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000003', 'member'),
  ('eeeeeeee-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000002', 'member'),
  ('eeeeeeee-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000003', 'member')
on conflict do nothing;

-- One message per attack, so no case can be masked by a previous one's effect.
insert into messages (id, conversation_id, sender_id, kind, body, created_at) values
  ('ffffffff-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000001', 'text', 'm1', timestamptz '2026-01-01 00:00:00+00'),
  ('ffffffff-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000001', 'text', 'm2', timestamptz '2026-01-01 00:00:01+00'),
  ('ffffffff-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000001', 'text', 'm3', timestamptz '2026-01-01 00:00:02+00'),
  ('ffffffff-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000001', 'text', 'm4', timestamptz '2026-01-01 00:00:03+00'),
  ('ffffffff-0000-0000-0000-000000000005', 'eeeeeeee-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000001', 'text', 'm5', timestamptz '2026-01-01 00:00:04+00'),
  ('ffffffff-0000-0000-0000-000000000006', 'eeeeeeee-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000001', 'text', 'm6', timestamptz '2026-01-01 00:00:05+00')
on conflict do nothing;

-- ============================================================================
-- Step 1 — relocating your own message into a conversation you DO belong to
-- ============================================================================
-- THE PRIMARY DEFECT. The new row satisfies authorship and membership perfectly,
-- so the policy's WITH CHECK cannot see this case — only the freeze trigger can.
-- The harm does not depend on where the message lands: it is REMOVED from the
-- recipient's thread either way.
--
-- EVERY ATTACK STEP IS WRAPPED IN A SAVEPOINT AND ROLLED BACK AFTER ITS OWN
-- ASSERTIONS. `pg_temp.allows()` runs the statement for real, so against a
-- regressed policy a successful attack would persist and contaminate the fixture
-- for every later step — one broken policy would then produce a cascade of
-- confusing unrelated failures. Isolated, each step's verdict stands alone.
savepoint step1;
select pg_temp.set_user('dddddddd-0000-0000-0000-000000000001');
set local role authenticated;

select pg_temp.assert(
  'step 1: the author relocating their own message into another conversation they belong to is DENIED',
  pg_temp.allows($$update messages
                      set conversation_id = 'eeeeeeee-0000-0000-0000-000000000002'
                    where id = 'ffffffff-0000-0000-0000-000000000001'$$),
  false);

reset role;
select pg_temp.assert(
  'step 1: the message is still in the conversation it was sent to',
  (select conversation_id = 'eeeeeeee-0000-0000-0000-000000000001'
     from messages where id = 'ffffffff-0000-0000-0000-000000000001'),
  true);
rollback to savepoint step1;

-- ============================================================================
-- Step 2 — relocating into a conversation you do NOT belong to
-- ============================================================================
-- Blocked before this fix ONLY by an accident: PostgreSQL applies the SELECT
-- policy to the new row when the statement requires SELECT privilege on the
-- relation, which `where id = ...` happens to do. 2b removes that accident.
savepoint step2;
select pg_temp.set_user('dddddddd-0000-0000-0000-000000000001');
set local role authenticated;

select pg_temp.assert(
  'step 2a: the author relocating their own message into a conversation they are NOT in is DENIED',
  pg_temp.allows($$update messages
                      set conversation_id = 'eeeeeeee-0000-0000-0000-000000000003'
                    where id = 'ffffffff-0000-0000-0000-000000000002'$$),
  false);

-- 2b — THE SHAPE THAT WAS NOT BLOCKED. PostgREST emits, for an unfiltered
-- `PATCH /rest/v1/messages` with the default `Prefer: return=minimal`, an UPDATE
-- with NO WHERE clause and `RETURNING 1`. Neither references a column of
-- `messages`, so no SELECT privilege is required on it, so `msg_select` is NOT
-- applied to the new row and the accidental protection above does not exist.
-- Measured on this migration tree before the fix: UPDATE 5, five rows relocated
-- into a conversation the caller is not a member of. This assertion is the whole
-- reason the WITH CHECK spells the membership term out instead of inheriting it.
select pg_temp.assert(
  'step 2b: the same relocation via the unfiltered PostgREST PATCH shape (no WHERE, RETURNING 1) is DENIED',
  pg_temp.allows($$with pgrst_body as (
                     select '[{"conversation_id":"eeeeeeee-0000-0000-0000-000000000003"}]'::json as json_data)
                   update messages set conversation_id = pgrst_source.conversation_id
                     from (select * from json_populate_recordset(
                             null::messages, (select json_data from pgrst_body))) pgrst_source
                   returning 1$$),
  false);

reset role;
select pg_temp.assert(
  'step 2: no message of the author''s reached the conversation they are not a member of',
  exists(select 1 from messages
          where conversation_id = 'eeeeeeee-0000-0000-0000-000000000003'
            and sender_id = 'dddddddd-0000-0000-0000-000000000001'),
  false);
select pg_temp.assert(
  'step 2: all six of the author''s messages are still in the conversation they were sent to',
  (select count(*) = 6 from messages
     where conversation_id = 'eeeeeeee-0000-0000-0000-000000000001'
       and sender_id = 'dddddddd-0000-0000-0000-000000000001'),
  true);
rollback to savepoint step2;

-- ============================================================================
-- Step 3 — the intended use MUST still work
-- ============================================================================
-- The point of this fix is to narrow the perimeter, not to close the table. An
-- author editing their own message body in place is the write `msg_update` exists
-- to permit. If this goes red the fix has overshot, and a green step 1/2 would be
-- passing for the wrong reason.
savepoint step3;
select pg_temp.set_user('dddddddd-0000-0000-0000-000000000001');
set local role authenticated;

select pg_temp.assert(
  'step 3: the author editing their own message body IN PLACE is ALLOWED',
  pg_temp.allows($$update messages set body = 'edited by the author'
                    where id = 'ffffffff-0000-0000-0000-000000000003'$$),
  true);

reset role;
-- "Allowed" is not "happened": a USING clause that filtered the row out would
-- also raise nothing. Assert the stored value.
select pg_temp.assert(
  'step 3: the edit actually persisted',
  (select body = 'edited by the author'
     from messages where id = 'ffffffff-0000-0000-0000-000000000003'),
  true);
rollback to savepoint step3;

-- ============================================================================
-- Step 4 — a non-author cannot update, whether or not they are a member
-- ============================================================================
-- NOTE ON WHY THESE ASSERT ON THE ROW AND NOT ON AN EXCEPTION: a row excluded by
-- the USING clause is simply not visible to the UPDATE. It affects zero rows and
-- raises nothing, so `allows()` returns true. The denial is observable only in
-- the stored value.
savepoint step4;
select pg_temp.set_user('dddddddd-0000-0000-0000-000000000003');  -- outsider
set local role authenticated;

select pg_temp.allows($$update messages set body = 'forged by an outsider'
                         where id = 'ffffffff-0000-0000-0000-000000000004'$$);
select pg_temp.allows($$update messages
                          set conversation_id = 'eeeeeeee-0000-0000-0000-000000000002'
                        where id = 'ffffffff-0000-0000-0000-000000000004'$$);

reset role;
select pg_temp.assert(
  'step 4a: an outsider''s update left the message body untouched',
  (select body = 'm4' from messages where id = 'ffffffff-0000-0000-0000-000000000004'),
  true);
select pg_temp.assert(
  'step 4a: an outsider''s update left the message in its conversation',
  (select conversation_id = 'eeeeeeee-0000-0000-0000-000000000001'
     from messages where id = 'ffffffff-0000-0000-0000-000000000004'),
  true);

-- The recipient IS a member of the conversation and can READ the message. Being
-- able to read it must not imply being able to write it.
select pg_temp.set_user('dddddddd-0000-0000-0000-000000000002');  -- recipient
set local role authenticated;

select pg_temp.assert(
  'step 4b: the recipient can READ the message (so the next assertion is about write, not visibility)',
  exists(select 1 from messages where id = 'ffffffff-0000-0000-0000-000000000004'),
  true);
select pg_temp.allows($$update messages set body = 'forged by a fellow member'
                         where id = 'ffffffff-0000-0000-0000-000000000004'$$);

reset role;
select pg_temp.assert(
  'step 4b: a fellow member who is not the author left the message body untouched',
  (select body = 'm4' from messages where id = 'ffffffff-0000-0000-0000-000000000004'),
  true);
rollback to savepoint step4;

-- ============================================================================
-- Step 5 — the rest of the row's identity is frozen too
-- ============================================================================
-- created_at is what makes a relocated or resurfaced message read as authentic
-- history; the primary key is what every reply_to_id and message_reactions row
-- hangs off. Both are decided once, at insert.
savepoint step5;
select pg_temp.set_user('dddddddd-0000-0000-0000-000000000001');
set local role authenticated;

select pg_temp.assert(
  'step 5a: the author re-dating their own message is DENIED',
  pg_temp.allows($$update messages set created_at = now()
                    where id = 'ffffffff-0000-0000-0000-000000000005'$$),
  false);
select pg_temp.assert(
  'step 5b: the author rewriting their own message''s primary key is DENIED',
  pg_temp.allows($$update messages set id = 'ffffffff-0000-0000-0000-0000000000ff'
                    where id = 'ffffffff-0000-0000-0000-000000000006'$$),
  false);

reset role;
select pg_temp.assert(
  'step 5a: the original timestamp survived',
  (select created_at = timestamptz '2026-01-01 00:00:04+00'
     from messages where id = 'ffffffff-0000-0000-0000-000000000005'),
  true);
select pg_temp.assert(
  'step 5b: the primary key survived',
  exists(select 1 from messages where id = 'ffffffff-0000-0000-0000-000000000006'),
  true);
rollback to savepoint step5;

-- Step 6 — a member who LEFT cannot still edit the messages they left behind.
--
-- The only assertion that isolates the WITH CHECK's membership clause: stripping that
-- clause leaves every other assertion here green, because the freeze trigger blocks
-- relocation before the membership term is ever reached (P29).
--
-- Authorship is not membership. `members_delete` lets a user leave or be removed while
-- their messages stay; under the old policy they stayed the author and could keep
-- rewriting a thread they are no longer part of.
--
-- Unfiltered shape, as in step 2b: a `where id =` filter makes msg_select hide the row,
-- so the UPDATE matches zero rows — invisibility, not denial.
savepoint step6;

-- Give the author a message in ALT, then remove them from ALT.
insert into messages (id, conversation_id, sender_id, kind, body, created_at) values
  ('ffffffff-0000-0000-0000-000000000007', 'eeeeeeee-0000-0000-0000-000000000002',
   'dddddddd-0000-0000-0000-000000000001', 'text', 'm7', timestamptz '2026-01-01 00:00:06+00');
delete from conversation_members
  where conversation_id = 'eeeeeeee-0000-0000-0000-000000000002'
    and user_id = 'dddddddd-0000-0000-0000-000000000001';

select pg_temp.set_user('dddddddd-0000-0000-0000-000000000001');
set local role authenticated;

select pg_temp.assert(
  'step 6: a departed member rewriting the body of the messages they left behind is DENIED',
  pg_temp.allows($$update messages set body = 'rewritten after leaving' returning 1$$),
  false);

reset role;
select pg_temp.assert(
  'step 6: the message they left behind still reads as it did',
  (select body = 'm7' from messages where id = 'ffffffff-0000-0000-0000-000000000007'),
  true);
rollback to savepoint step6;

-- ============================================================================
-- Step 7 — the freeze trigger must NOT break account deletion
-- ============================================================================
-- `messages_sender_id_fkey ... on delete set null` (20260722200000:80) is what
-- makes delete_my_account() possible, and a referential SET NULL performs a real
-- UPDATE that fires row triggers. If the freeze trigger were widened to include
-- sender_id, account deletion would start raising — on the one table in this
-- product with an external Play Store deadline. This is the assertion that would
-- catch that.
delete from profiles where id = 'dddddddd-0000-0000-0000-000000000001';

select pg_temp.assert(
  'step 7: the ON DELETE SET NULL cascade still runs through the freeze trigger',
  (select count(*) = 6 from messages
     where conversation_id = 'eeeeeeee-0000-0000-0000-000000000001'
       and sender_id is null),
  true);

rollback;
