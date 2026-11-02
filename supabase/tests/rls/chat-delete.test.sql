-- Chat delete (20261119010000_chat_delete.sql).
--
--   * delete for everyone: only the sender, only while in the chat, never a system line;
--     the words and attachment are ERASED (not just flagged); a client still cannot rewrite
--     or erase content directly; installed apps' `deleted_at is null` read hides it;
--   * the chat-list line never keeps a deleted message's words (v1, which installed apps
--     read, and v2);
--   * delete for me: only your own hide, only in a chat you are in, invisible to others;
--   * clear chat / delete chat: a private row only you can read — never on
--     conversation_members, never "Seen"; v2 hides a deleted chat until a new message, and
--     shows each person their own preview and unread count;
--   * a newer system line ("The Jam Room has ended.") does not keep a deleted message's
--     words in the chat list;
--   * anon can call none of it.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/chat-delete.test.sql

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

create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when insufficient_privilege then return false;
end $$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   RIYA (…01) and SAM (…02) share a DM; CAL (…03) is outside it.
insert into auth.users (id) values
  ('de100000-0000-0000-0000-000000000001'), ('de100000-0000-0000-0000-000000000002'),
  ('de100000-0000-0000-0000-000000000003')
on conflict do nothing;
insert into profiles (id, username, username_set) values
  ('de100000-0000-0000-0000-000000000001', 'del_riya', true),
  ('de100000-0000-0000-0000-000000000002', 'del_sam', true),
  ('de100000-0000-0000-0000-000000000003', 'del_cal', true)
on conflict do nothing;
insert into conversations (id, kind) values ('de200000-0000-0000-0000-000000000001', 'dm');
insert into conversation_members (conversation_id, user_id, role, last_read_at) values
  ('de200000-0000-0000-0000-000000000001', 'de100000-0000-0000-0000-000000000001', 'member', now() - interval '1 day'),
  ('de200000-0000-0000-0000-000000000001', 'de100000-0000-0000-0000-000000000002', 'member', now() - interval '1 day');
insert into messages (id, conversation_id, sender_id, kind, body, metadata, created_at) values
  ('de300000-0000-0000-0000-000000000001', 'de200000-0000-0000-0000-000000000001',
   'de100000-0000-0000-0000-000000000002', 'text', 'old news', null, now() - interval '3 hours'),
  ('de300000-0000-0000-0000-000000000002', 'de200000-0000-0000-0000-000000000001',
   'de100000-0000-0000-0000-000000000002', 'text', 'are you free tonight', null, now() - interval '2 hours'),
  ('de300000-0000-0000-0000-000000000003', 'de200000-0000-0000-0000-000000000001',
   'de100000-0000-0000-0000-000000000001', 'text', 'my number is 98765 43210', '{"x": 1}', now() - interval '1 hour'),
  ('de300000-0000-0000-0000-000000000004', 'de200000-0000-0000-0000-000000000001',
   null, 'system', 'The Jam Room has ended.', null, now() - interval '4 hours');

-- ── Delete for everyone ─────────────────────────────────────────────────────
select pg_temp.set_user('de100000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('#1 nobody deletes someone else''s message for everyone', pg_temp.allows($$
  select public.delete_message_for_everyone('de300000-0000-0000-0000-000000000003')$$), false);
select pg_temp.assert('#2 nor a system line', pg_temp.allows($$
  select public.delete_message_for_everyone('de300000-0000-0000-0000-000000000004')$$), false);
reset role;

select pg_temp.set_user('de100000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('#3 a client still cannot erase the words directly', pg_temp.allows($$
  update messages set body = null, metadata = null, deleted_at = now()
   where id = 'de300000-0000-0000-0000-000000000003'$$), false);
select pg_temp.assert('#4 the sender deletes their own message for everyone', pg_temp.allows($$
  select public.delete_message_for_everyone('de300000-0000-0000-0000-000000000003')$$), true);
select pg_temp.assert('#5 deleting it again is harmless', pg_temp.allows($$
  select public.delete_message_for_everyone('de300000-0000-0000-0000-000000000003')$$), true);
reset role;
select pg_temp.assert('#4 its words and attachment are gone, the row is marked deleted',
  (select deleted_at is not null and body is null and metadata is null and kind = 'text'
     from messages where id = 'de300000-0000-0000-0000-000000000003'), true);

-- What an installed app reads (fetchMessages: `deleted_at is null`), as Sam.
select pg_temp.set_user('de100000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('#6 an installed app no longer gets it',
  (select count(*) = 0 from messages
    where conversation_id = 'de200000-0000-0000-0000-000000000001'
      and deleted_at is null and id = 'de300000-0000-0000-0000-000000000003'), true);
select pg_temp.assert('#7 the chat list line (v1, installed apps) no longer has the words',
  (select last_message_preview = 'This message was deleted' from public.list_my_conversations()
    where id = 'de200000-0000-0000-0000-000000000001'), true);
select pg_temp.assert('#7b nor v2',
  (select last_message_preview = 'This message was deleted' from public.list_my_conversations_v2()
    where id = 'de200000-0000-0000-0000-000000000001'), true);
reset role;

-- Someone who left the chat cannot reach back into it.
delete from conversation_members
 where conversation_id = 'de200000-0000-0000-0000-000000000001'
   and user_id = 'de100000-0000-0000-0000-000000000002';
select pg_temp.set_user('de100000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('#8 not after leaving the chat', pg_temp.allows($$
  select public.delete_message_for_everyone('de300000-0000-0000-0000-000000000002')$$), false);
reset role;
insert into conversation_members (conversation_id, user_id, role, last_read_at) values
  ('de200000-0000-0000-0000-000000000001', 'de100000-0000-0000-0000-000000000002', 'member', now() - interval '1 day');

-- ── Delete for me ───────────────────────────────────────────────────────────
select pg_temp.set_user('de100000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('#9 a member hides a message for themselves', pg_temp.allows($$
  insert into message_hides (user_id, message_id)
  values ('de100000-0000-0000-0000-000000000001', 'de300000-0000-0000-0000-000000000002')$$), true);
select pg_temp.assert('#10 but not for someone else', pg_temp.allows($$
  insert into message_hides (user_id, message_id)
  values ('de100000-0000-0000-0000-000000000002', 'de300000-0000-0000-0000-000000000001')$$), false);
reset role;

select pg_temp.set_user('de100000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert('#11 an outsider cannot hide a message of a chat they are not in', pg_temp.allows($$
  insert into message_hides (user_id, message_id)
  values ('de100000-0000-0000-0000-000000000003', 'de300000-0000-0000-0000-000000000001')$$), false);
reset role;

select pg_temp.set_user('de100000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('#12 nobody else sees your hides',
  (select count(*) = 0 from message_hides), true);
reset role;

-- Riya now sees: 'old news' (…01) as the newest she has not hidden — after her deleted …03.
select pg_temp.set_user('de100000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('#13 v2 counts unread without what she hid (…01 only)',
  (select unread_count = 1 from public.list_my_conversations_v2()
    where id = 'de200000-0000-0000-0000-000000000001'), true);

-- ── Clear chat / delete chat ────────────────────────────────────────────────
select public.clear_conversation('de200000-0000-0000-0000-000000000001', false);
select pg_temp.assert('#14 after Clear chat: still listed, nothing to preview, nothing unread',
  (select last_message_preview is null and unread_count = 0
     from public.list_my_conversations_v2()
    where id = 'de200000-0000-0000-0000-000000000001'), true);
select public.clear_conversation('de200000-0000-0000-0000-000000000001', true);
select pg_temp.assert('#15 after Delete chat: gone from her list',
  (select count(*) = 0 from public.list_my_conversations_v2()
    where id = 'de200000-0000-0000-0000-000000000001'), true);
reset role;

-- Private: Sam is told nothing, and nothing reads as "Seen".
select pg_temp.assert('#16 clearing does not move her last_read_at (no "Seen" for unread messages)',
  (select last_read_at < now() - interval '12 hours' from conversation_members
    where conversation_id = 'de200000-0000-0000-0000-000000000001'
      and user_id = 'de100000-0000-0000-0000-000000000001'), true);
select pg_temp.set_user('de100000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('#16b the other member cannot see that she cleared or deleted the chat',
  (select count(*) = 0 from conversation_clears), true);
select pg_temp.assert('#16c and nobody writes a clear row directly', pg_temp.allows($$
  insert into conversation_clears (user_id, conversation_id)
  values ('de100000-0000-0000-0000-000000000002', 'de200000-0000-0000-0000-000000000001')$$), false);
reset role;
select pg_temp.set_user('de100000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert('#16d an outsider cannot clear a chat they are not in', pg_temp.allows($$
  select public.clear_conversation('de200000-0000-0000-0000-000000000001', true)$$), false);
reset role;

-- A new message brings the chat back, with only what came after.
select pg_temp.set_user('de100000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('#17 Sam still sees his chat as before',
  (select count(*) = 1 from public.list_my_conversations_v2()
    where id = 'de200000-0000-0000-0000-000000000001'), true);
reset role;
-- Sent by Sam (inserted as the owner: the fixture DM has no friendship row for msg_insert,
-- and now() is frozen inside the transaction, so it is dated just after her clear).
insert into messages (conversation_id, sender_id, kind, body, created_at)
values ('de200000-0000-0000-0000-000000000001', 'de100000-0000-0000-0000-000000000002', 'text',
        'hello again', now() + interval '1 minute');
select pg_temp.set_user('de100000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('#18 a new message brings the chat back, previewing only it',
  (select last_message_preview = 'hello again' and unread_count = 1
     from public.list_my_conversations_v2()
    where id = 'de200000-0000-0000-0000-000000000001'), true);
reset role;

-- ── A newer system line does not keep deleted words in the list ────────────
insert into conversations (id, kind) values ('de200000-0000-0000-0000-000000000002', 'dm');
insert into conversation_members (conversation_id, user_id, role) values
  ('de200000-0000-0000-0000-000000000002', 'de100000-0000-0000-0000-000000000001', 'member'),
  ('de200000-0000-0000-0000-000000000002', 'de100000-0000-0000-0000-000000000002', 'member');
insert into messages (id, conversation_id, sender_id, kind, body, created_at) values
  ('de300000-0000-0000-0000-000000000011', 'de200000-0000-0000-0000-000000000002',
   'de100000-0000-0000-0000-000000000001', 'text', 'my pin is 4321', now() - interval '2 minutes'),
  ('de300000-0000-0000-0000-000000000012', 'de200000-0000-0000-0000-000000000002',
   null, 'system', 'The Jam Room has ended.', now() - interval '1 minute');
select pg_temp.set_user('de100000-0000-0000-0000-000000000001');
set local role authenticated;
select public.delete_message_for_everyone('de300000-0000-0000-0000-000000000011');
reset role;
select pg_temp.set_user('de100000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('#20 deleted under a newer system line: gone from v1''s line (installed apps)',
  (select last_message_preview = 'This message was deleted' from public.list_my_conversations()
    where id = 'de200000-0000-0000-0000-000000000002'), true);
select pg_temp.assert('#20b and from v2''s',
  (select last_message_preview = 'This message was deleted' from public.list_my_conversations_v2()
    where id = 'de200000-0000-0000-0000-000000000002'), true);
reset role;

-- ── anon ────────────────────────────────────────────────────────────────────
select pg_temp.assert('#19 anon can call none of it',
  not has_function_privilege('anon', 'public.delete_message_for_everyone(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.clear_conversation(uuid, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.list_my_conversations_v2()', 'execute'), true);

rollback;
