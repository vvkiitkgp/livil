-- LIV-74 — account deletion removes the user's messages, and records the departure.
--
-- Asserts the PROPERTIES, not the statements: a DM is gone, a group keeps everyone else's
-- messages, a third party's DM is untouched, the ledger holds a hash rather than an
-- address and no client can read it, and the recorded username is released only back to
-- the same address.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/account-deletion-liv74.test.sql
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

-- Reports whether the database allowed the statement. Only the two refusals under test
-- are caught — RLS/trigger denial (42501) and the reservation's unique_violation (23505).
-- Anything else propagates, so a test cannot pass because of an unrelated error.
create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when insufficient_privilege then return false;
  when unique_violation      then return false;
end $$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- created_by is left null throughout: it is ON DELETE SET NULL, and the resulting cascade
-- UPDATE would trip conversations_freeze_derived, failing this file for an unrelated
-- reason (the same trap messages-write-boundary.test.sql documents).
insert into auth.users (id, email) values
  ('d7000000-0000-0000-0000-000000000001', 'departing@example.invalid'),
  ('d7000000-0000-0000-0000-000000000002', 'friend@example.invalid'),
  ('d7000000-0000-0000-0000-000000000003', 'mate@example.invalid'),
  ('d7000000-0000-0000-0000-000000000004', 'stranger@example.invalid'),
  ('d7000000-0000-0000-0000-000000000005', 'other@example.invalid');

insert into profiles (id, username, username_set) values
  ('d7000000-0000-0000-0000-000000000001', 'liv74_departing', true),
  ('d7000000-0000-0000-0000-000000000002', 'liv74_friend',    true),
  ('d7000000-0000-0000-0000-000000000003', 'liv74_mate',      true),
  ('d7000000-0000-0000-0000-000000000004', 'liv74_stranger',  true),
  ('d7000000-0000-0000-0000-000000000005', 'liv74_other',     true);

insert into conversations (id, kind) values
  ('c7000000-0000-0000-0000-000000000001', 'dm'),      -- departing + friend
  ('c7000000-0000-0000-0000-000000000002', 'group'),   -- departing + mate
  ('c7000000-0000-0000-0000-000000000003', 'dm');      -- stranger + other, a third party

insert into conversation_members (conversation_id, user_id, role) values
  ('c7000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-000000000001', 'member'),
  ('c7000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-000000000002', 'member'),
  ('c7000000-0000-0000-0000-000000000002', 'd7000000-0000-0000-0000-000000000001', 'member'),
  ('c7000000-0000-0000-0000-000000000002', 'd7000000-0000-0000-0000-000000000003', 'member'),
  ('c7000000-0000-0000-0000-000000000003', 'd7000000-0000-0000-0000-000000000004', 'member'),
  ('c7000000-0000-0000-0000-000000000003', 'd7000000-0000-0000-0000-000000000005', 'member');

insert into messages (id, conversation_id, sender_id, kind, body) values
  ('e7000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000001',
   'd7000000-0000-0000-0000-000000000001', 'text', 'dm sent by the departing user'),
  ('e7000000-0000-0000-0000-000000000002', 'c7000000-0000-0000-0000-000000000001',
   'd7000000-0000-0000-0000-000000000002', 'text', 'dm sent by the friend'),
  ('e7000000-0000-0000-0000-000000000003', 'c7000000-0000-0000-0000-000000000002',
   'd7000000-0000-0000-0000-000000000001', 'text', 'group message by the departing user'),
  ('e7000000-0000-0000-0000-000000000004', 'c7000000-0000-0000-0000-000000000002',
   'd7000000-0000-0000-0000-000000000003', 'text', 'group message by the mate'),
  ('e7000000-0000-0000-0000-000000000006', 'c7000000-0000-0000-0000-000000000003',
   'd7000000-0000-0000-0000-000000000004', 'text', 'a third party''s DM');

-- The mate's REPLY to the departing user's group message. messages_reply_to_id_fkey was
-- NO ACTION, so before LIV-74 §1 this row alone made the delete abort with 23503 — and it
-- is invisible to the cascade walk in 20260722200000, because the delete is explicit.
insert into messages (id, conversation_id, sender_id, kind, body, reply_to_id) values
  ('e7000000-0000-0000-0000-000000000005', 'c7000000-0000-0000-0000-000000000002',
   'd7000000-0000-0000-0000-000000000003', 'text', 'the mate quoting them',
   'e7000000-0000-0000-0000-000000000003');

-- A reaction by someone else on a message that is about to be deleted, and one by the
-- departing user on a message that survives.
insert into message_reactions (message_id, user_id, emoji) values
  ('e7000000-0000-0000-0000-000000000003', 'd7000000-0000-0000-0000-000000000003', '🔥'),
  ('e7000000-0000-0000-0000-000000000004', 'd7000000-0000-0000-0000-000000000001', '🎵');


-- ============================================================================
-- The deletion itself
-- ============================================================================
select pg_temp.set_user('d7000000-0000-0000-0000-000000000001');
select public.delete_my_account();
select pg_temp.set_user(null);

select pg_temp.assert(
  'liv74 #1: delete_my_account completed and the account is gone',
  exists(select 1 from auth.users where id='d7000000-0000-0000-0000-000000000001'), false);

-- The brief asked this be verified rather than changed: profiles.id cascades from
-- auth.users, so the username is destroyed with no extra work, and
-- enforce_username_immutable is BEFORE UPDATE and never sees a DELETE.
select pg_temp.assert(
  'liv74 #2: the profile, and with it the username, went with the account',
  exists(select 1 from profiles where id='d7000000-0000-0000-0000-000000000001'), false);


-- ============================================================================
-- DMs go whole; groups keep everyone else's messages
-- ============================================================================
select pg_temp.assert(
  'liv74 #3: the DM conversation row is gone',
  exists(select 1 from conversations where id='c7000000-0000-0000-0000-000000000001'), false);

select pg_temp.assert(
  'liv74 #4: both participants'' messages in that DM are gone, the friend''s included',
  (select count(*) = 0 from messages
    where conversation_id='c7000000-0000-0000-0000-000000000001'), true);

select pg_temp.assert(
  'liv74 #5: the friend''s membership row went with the conversation',
  exists(select 1 from conversation_members
          where conversation_id='c7000000-0000-0000-0000-000000000001'), false);

select pg_temp.assert(
  'liv74 #6: the GROUP survives',
  exists(select 1 from conversations where id='c7000000-0000-0000-0000-000000000002'), true);

select pg_temp.assert(
  'liv74 #7: the departing user''s group message is gone',
  exists(select 1 from messages where id='e7000000-0000-0000-0000-000000000003'), false);

-- THE ASSERTION THAT MATTERS MOST: deleting a departing user must not take a member of
-- the group with them. A CASCADE on conversation, or a delete keyed on conversation
-- rather than sender, passes every other assertion here and fails this one.
select pg_temp.assert(
  'liv74 #8: the mate''s own group messages BOTH survive, bodies intact',
  (select count(*) = 2 from messages
    where conversation_id='c7000000-0000-0000-0000-000000000002'
      and sender_id='d7000000-0000-0000-0000-000000000003'
      and body in ('group message by the mate', 'the mate quoting them')), true);

-- A referential SET NULL is a real UPDATE and fires trg_messages_freeze_identity
-- (LIV-78). Widening that trigger to reply_to_id would abort every deletion of a message
-- somebody answered; this is the assertion that catches it.
select pg_temp.assert(
  'liv74 #9: the mate''s reply survives with reply_to_id nulled, so the freeze trigger did not fire',
  (select reply_to_id is null from messages where id='e7000000-0000-0000-0000-000000000005'), true);

select pg_temp.assert(
  'liv74 #10: a DM between two OTHER users is untouched',
  (select count(*) = 1 from messages
    where conversation_id='c7000000-0000-0000-0000-000000000003'), true);

select pg_temp.assert(
  'liv74 #11: the mate''s reaction on the deleted message went with it',
  exists(select 1 from message_reactions
          where message_id='e7000000-0000-0000-0000-000000000003'), false);

select pg_temp.assert(
  'liv74 #12: the mate''s message the departing user reacted to still stands',
  exists(select 1 from messages where id='e7000000-0000-0000-0000-000000000004'), true);


-- ============================================================================
-- The ledger
-- ============================================================================
select pg_temp.assert(
  'liv74 #13: exactly one ledger row was written, with the username and a timestamp',
  (select count(*) = 1 from deleted_accounts
    where username = 'liv74_departing' and deleted_at is not null), true);

-- Two independent forms: the value IS the expected digest, and it is not an address. The
-- second is what catches "store the email" being restored, whatever the column is called.
select pg_temp.assert(
  'liv74 #14: the ledger holds sha256(lower(trim(email)))',
  (select email_sha256 = encode(sha256(convert_to('departing@example.invalid', 'UTF8')), 'hex')
     from deleted_accounts where username='liv74_departing'), true);

select pg_temp.assert(
  'liv74 #15: ...and nothing resembling the plaintext address',
  exists(select 1 from deleted_accounts
          where username='liv74_departing'
            and (email_sha256 like '%@%' or email_sha256 ilike '%departing@%')), false);

-- ci.yml grants every table in public to `authenticated` after migrations, so a REVOKE
-- alone would not hold. RLS with no policy is the control being tested here.
set local role authenticated;
select pg_temp.assert(
  'liv74 #16: `authenticated` cannot read the ledger, despite holding the table grant',
  (select count(*) = 0 from deleted_accounts), true);
select pg_temp.assert(
  'liv74 #17: `authenticated` cannot write the ledger either',
  pg_temp.allows($$insert into deleted_accounts (email_sha256, username)
                   values ('deadbeef', 'forged')$$), false);
reset role;

select pg_temp.assert(
  'liv74 #18: no forged row landed',
  exists(select 1 from deleted_accounts where username='forged'), false);


-- ============================================================================
-- Re-signup, and username reclaim
-- ============================================================================
-- The ledger records; it must not block. The same address signing up again is the case
-- the maintainer named explicitly.
insert into auth.users (id, email) values
  ('d7000000-0000-0000-0000-0000000000a1', 'departing@example.invalid'),
  ('d7000000-0000-0000-0000-0000000000a2', 'someoneelse@example.invalid');

select pg_temp.assert(
  'liv74 #19: the deleted address is free to register again',
  exists(select 1 from auth.users where email='departing@example.invalid'), true);

-- Availability, before anyone has taken the name back. An anonymous caller has no address
-- to compare and must be told "taken" rather than being given an oracle.
select pg_temp.set_user(null);
select pg_temp.assert(
  'liv74 #20: a reserved username reads as unavailable to an anonymous caller',
  is_username_available('liv74_departing'), false);

select pg_temp.set_user('d7000000-0000-0000-0000-0000000000a2');
select pg_temp.assert(
  'liv74 #21: ...and to a signed-in account with a DIFFERENT address',
  is_username_available('liv74_departing'), false);

select pg_temp.set_user('d7000000-0000-0000-0000-0000000000a1');
select pg_temp.assert(
  'liv74 #22: ...but available to the address that gave it up',
  is_username_available('liv74_departing'), true);

-- And the write must agree with the pre-flight. Enforced on `profiles`, because
-- profiles_update_own lets an account with username_set = false PATCH `username`
-- directly, bypassing claim_username entirely.
--
-- The wrong claimant is tested FIRST: once the rightful owner holds the name, a denial
-- here would be the unique constraint rather than the reservation.
--
-- set_user is the WRONG CLAIMANT, not the previous case's account. Without that, mutation
-- testing showed this assertion passing on `profiles_insert_self` (`id = auth.uid()`) with
-- the reservation trigger removed entirely — green for a reason that has nothing to do
-- with what it claims to test.
select pg_temp.set_user('d7000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select pg_temp.assert(
  'liv74 #23: a different address CANNOT take the reserved username',
  pg_temp.allows($$insert into profiles (id, username, username_set)
                   values ('d7000000-0000-0000-0000-0000000000a2', 'liv74_departing', true)$$),
  false);
reset role;

select pg_temp.assert(
  'liv74 #24: ...and no profile holds it',
  exists(select 1 from profiles where username='liv74_departing'), false);

select pg_temp.set_user('d7000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select pg_temp.assert(
  'liv74 #25: the original address CAN reclaim it',
  pg_temp.allows($$insert into profiles (id, username, username_set)
                   values ('d7000000-0000-0000-0000-0000000000a1', 'liv74_departing', true)$$),
  true);
reset role;

select pg_temp.assert(
  'liv74 #26: the reclaimed username is really held by the re-registered account',
  (select username = 'liv74_departing'
     from profiles where id='d7000000-0000-0000-0000-0000000000a1'), true);

-- A username nobody gave up is unaffected by any of this.
select pg_temp.set_user('d7000000-0000-0000-0000-0000000000a2');
select pg_temp.assert(
  'liv74 #27: an unledgered, unused username is still available',
  is_username_available('liv74_never_used'), true);
select pg_temp.assert(
  'liv74 #28: a username held by a LIVE account is still unavailable',
  is_username_available('liv74_mate'), false);

rollback;
