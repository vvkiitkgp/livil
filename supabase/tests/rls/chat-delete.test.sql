-- Chat delete (20261119010000_chat_delete.sql, 20261119020000_chat_delete_rules.sql).
--
--   * delete a message: only the sender, only while in the chat, never a system line; the
--     words and attachment are ERASED (not just flagged); a client still cannot rewrite or
--     erase content directly; installed apps' `deleted_at is null` read hides it;
--   * the chat-list line never keeps a deleted message's words (v1, which installed apps
--     read, and v2);
--   * delete chat: private, for one person; no message is touched and no "Seen" is sent; it
--     leaves their list until a new message, and the icon badge agrees;
--   * clear chat: one-to-one chats only; every message is gone for both people, one line says
--     who did it, and the chat list and icon badge are empty for both;
--   * a newer system line ("The Jam Room has ended.") does not keep a deleted message's
--     words in the chat list;
--   * anon can call none of it, and the per-person parts of 20261119010000 are gone.
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

-- ── Delete chat: hides it for one person, touches nothing else ──────────────
-- Riya has two unread messages from Sam (…01, …02).
select pg_temp.set_user('de100000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('#9 before: two unread',
  (select unread_count = 2 from public.list_my_conversations_v2()
    where id = 'de200000-0000-0000-0000-000000000001'), true);
select pg_temp.assert('#10 Delete chat works for a member', pg_temp.allows($$
  select public.hide_conversation('de200000-0000-0000-0000-000000000001')$$), true);
select pg_temp.assert('#10b it leaves her list',
  (select count(*) = 0 from public.list_my_conversations_v2()
    where id = 'de200000-0000-0000-0000-000000000001'), true);
select pg_temp.assert('#10c her own row, which she can read',
  (select count(*) = 1 from conversation_hides), true);
reset role;
select pg_temp.assert('#10d the icon badge agrees: a chat out of the list counts nothing',
  public.unread_badge_count_for('de100000-0000-0000-0000-000000000001') = 0, true);
select pg_temp.assert('#10e no message was touched',
  (select count(*) = 4 from messages where conversation_id = 'de200000-0000-0000-0000-000000000001'), true);
select pg_temp.assert('#10f her read marker did not move (no "Seen" for unread messages)',
  (select last_read_at < now() - interval '12 hours' from conversation_members
    where conversation_id = 'de200000-0000-0000-0000-000000000001'
      and user_id = 'de100000-0000-0000-0000-000000000001'), true);

select pg_temp.set_user('de100000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('#11 Sam still has his chat',
  (select count(*) = 1 from public.list_my_conversations_v2()
    where id = 'de200000-0000-0000-0000-000000000001'), true);
select pg_temp.assert('#11b and cannot see that she hid it',
  (select count(*) = 0 from conversation_hides), true);
select pg_temp.assert('#11c nobody writes a hide directly', pg_temp.allows($$
  insert into conversation_hides (user_id, conversation_id)
  values ('de100000-0000-0000-0000-000000000002', 'de200000-0000-0000-0000-000000000001')$$), false);
reset role;
select pg_temp.set_user('de100000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert('#11d an outsider cannot hide a chat they are not in', pg_temp.allows($$
  select public.hide_conversation('de200000-0000-0000-0000-000000000001')$$), false);
reset role;

-- A new message brings it back with everything still there. Inserted as the owner: the fixture
-- DM has no friendship row for msg_insert, and now() is frozen inside the transaction, so it is
-- dated just after her hide.
insert into messages (id, conversation_id, sender_id, kind, body, created_at)
values ('de300000-0000-0000-0000-000000000005', 'de200000-0000-0000-0000-000000000001',
        'de100000-0000-0000-0000-000000000002', 'text', 'hello again', now() + interval '1 minute');
select pg_temp.set_user('de100000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('#12 a new message brings the chat back, with the old unread still counted',
  (select last_message_preview = 'hello again' and unread_count = 3
     from public.list_my_conversations_v2()
    where id = 'de200000-0000-0000-0000-000000000001'), true);
reset role;
select pg_temp.assert('#12b the icon badge agrees',
  public.unread_badge_count_for('de100000-0000-0000-0000-000000000001') = 3, true);

-- ── Clear chat: for both people ─────────────────────────────────────────────
-- A reply and a reaction, which a clear must not trip over.
insert into messages (conversation_id, sender_id, kind, body, reply_to_id, created_at)
values ('de200000-0000-0000-0000-000000000001', 'de100000-0000-0000-0000-000000000001', 'text',
        'yes I am', 'de300000-0000-0000-0000-000000000002', now() + interval '2 minutes');
insert into message_reactions (message_id, user_id, emoji)
values ('de300000-0000-0000-0000-000000000001', 'de100000-0000-0000-0000-000000000001', '🔥');
insert into conversations (id, kind, name) values ('de200000-0000-0000-0000-000000000009', 'group', 'Band');
insert into conversation_members (conversation_id, user_id, role) values
  ('de200000-0000-0000-0000-000000000009', 'de100000-0000-0000-0000-000000000001', 'member');
insert into messages (conversation_id, sender_id, kind, body)
values ('de200000-0000-0000-0000-000000000009', 'de100000-0000-0000-0000-000000000001', 'text', 'band practice');

select pg_temp.set_user('de100000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert('#13 an outsider cannot clear a chat', pg_temp.allows($$
  select public.clear_chat_for_both('de200000-0000-0000-0000-000000000001')$$), false);
reset role;
select pg_temp.set_user('de100000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('#13b a group cannot be cleared, even by a member', pg_temp.allows($$
  select public.clear_chat_for_both('de200000-0000-0000-0000-000000000009')$$), false);
select pg_temp.allows($$
  delete from messages where conversation_id = 'de200000-0000-0000-0000-000000000001'$$);
reset role;
select pg_temp.assert('#13c a client still cannot delete messages directly',
  (select count(*) = 6 from messages where conversation_id = 'de200000-0000-0000-0000-000000000001'), true);
select pg_temp.set_user('de100000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('#14 either person can clear the chat', pg_temp.allows($$
  select public.clear_chat_for_both('de200000-0000-0000-0000-000000000001')$$), true);
reset role;
select pg_temp.assert('#14b every message is gone from the database, for both',
  (select count(*) = 0 from messages
    where conversation_id = 'de200000-0000-0000-0000-000000000001' and kind <> 'system'), true);
select pg_temp.assert('#14c and so are their reactions',
  (select count(*) = 0 from message_reactions
    where message_id = 'de300000-0000-0000-0000-000000000001'), true);
select pg_temp.assert('#14d one line says who cleared it, and marks it for the app',
  (select count(*) = 1 and bool_and(sender_id is null and body = 'del_riya cleared this chat'
                                    and metadata = '{"chat_cleared": true}'::jsonb)
     from messages where conversation_id = 'de200000-0000-0000-0000-000000000001'), true);
select pg_temp.assert('#14e the group was not touched',
  (select count(*) = 1 from messages where conversation_id = 'de200000-0000-0000-0000-000000000009'), true);

select pg_temp.assert('#15 the icon badge is empty for both',
  public.unread_badge_count_for('de100000-0000-0000-0000-000000000001') = 0
  and public.unread_badge_count_for('de100000-0000-0000-0000-000000000002') = 0, true);
select pg_temp.set_user('de100000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('#16 Sam: no line and nothing unread in v2',
  (select last_message_preview is null and last_message_at is null and unread_count = 0
     from public.list_my_conversations_v2()
    where id = 'de200000-0000-0000-0000-000000000001'), true);
select pg_temp.assert('#16b nor in v1, which installed apps read',
  (select last_message_preview is null and unread_count = 0
     from public.list_my_conversations()
    where id = 'de200000-0000-0000-0000-000000000001'), true);
select pg_temp.assert('#16c what an installed app loads is only the line',
  (select count(*) = 1 from messages
    where conversation_id = 'de200000-0000-0000-0000-000000000001' and deleted_at is null), true);
select pg_temp.assert('#17 clearing an empty chat adds no second line', pg_temp.allows($$
  select public.clear_chat_for_both('de200000-0000-0000-0000-000000000001')$$), true);
reset role;
select pg_temp.assert('#17b still one line',
  (select count(*) = 1 from messages where conversation_id = 'de200000-0000-0000-0000-000000000001'), true);

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
  and not has_function_privilege('anon', 'public.clear_chat_for_both(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.hide_conversation(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.list_my_conversations_v2()', 'execute'), true);
select pg_temp.assert('#22 the per-person parts are gone',
  to_regclass('public.message_hides') is null
  and to_regclass('public.conversation_clears') is null
  and to_regprocedure('public.clear_conversation(uuid, boolean)') is null, true);
-- Not asserted for `authenticated`: CI's harness grants it every function after the replay.
select pg_temp.assert('#21 anon cannot read someone''s badge number; send-push (service_role) can',
  not has_function_privilege('anon', 'public.unread_badge_count_for(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.unread_badge_count_for(uuid)', 'execute'), true);

rollback;
