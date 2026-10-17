-- Chat write rules (20261107000000_chat_write_rules.sql).
--
--   * a sent message's words, kind, attachment and quoted message cannot be rewritten —
--     soft delete still works, and deleting a quoted message still clears the quote;
--   * only a member of the chat can react; a reaction can be changed to another emoji;
--   * nobody can change someone else's reaction or move theirs into a chat they're not in.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/chat-write-rules.test.sql

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
--   ANU (…01) and BEN (…02) share a group; CAL (…03) is outside it, in his own chat
insert into auth.users (id) values
  ('f4000000-0000-0000-0000-000000000001'), ('f4000000-0000-0000-0000-000000000002'),
  ('f4000000-0000-0000-0000-000000000003')
on conflict do nothing;
insert into profiles (id, username, username_set) values
  ('f4000000-0000-0000-0000-000000000001', 'cw_anu', true),
  ('f4000000-0000-0000-0000-000000000002', 'cw_ben', true),
  ('f4000000-0000-0000-0000-000000000003', 'cw_cal', true)
on conflict do nothing;
insert into conversations (id, kind) values
  ('f5000000-0000-0000-0000-000000000001', 'group'),
  ('f5000000-0000-0000-0000-000000000002', 'group');
insert into conversation_members (conversation_id, user_id, role) values
  ('f5000000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000001', 'member'),
  ('f5000000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000002', 'member'),
  ('f5000000-0000-0000-0000-000000000002', 'f4000000-0000-0000-0000-000000000003', 'member');
insert into messages (id, conversation_id, sender_id, kind, body, metadata, reply_to_id) values
  ('f6000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001',
   'f4000000-0000-0000-0000-000000000001', 'text', 'you are awful', null, null),
  ('f6000000-0000-0000-0000-000000000002', 'f5000000-0000-0000-0000-000000000001',
   'f4000000-0000-0000-0000-000000000001', 'track_share', '', '{"post_id": "x"}', null),
  ('f6000000-0000-0000-0000-000000000003', 'f5000000-0000-0000-0000-000000000001',
   'f4000000-0000-0000-0000-000000000002', 'text', 'what?', null, 'f6000000-0000-0000-0000-000000000001'),
  ('f6000000-0000-0000-0000-000000000004', 'f5000000-0000-0000-0000-000000000001',
   'f4000000-0000-0000-0000-000000000001', 'text', 'never mind', null, 'f6000000-0000-0000-0000-000000000003'),
  ('f6000000-0000-0000-0000-000000000009', 'f5000000-0000-0000-0000-000000000002',
   'f4000000-0000-0000-0000-000000000003', 'text', 'cal alone', null, null);

-- ── A sent message's content is fixed ────────────────────────────────────────
select pg_temp.set_user('f4000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('#1 the words cannot be rewritten', pg_temp.allows($$
  update messages set body = 'have a nice day' where id = 'f6000000-0000-0000-0000-000000000001'$$), false);
select pg_temp.assert('#2 nor the kind', pg_temp.allows($$
  update messages set kind = 'track_share' where id = 'f6000000-0000-0000-0000-000000000001'$$), false);
select pg_temp.assert('#3 nor the attachment', pg_temp.allows($$
  update messages set metadata = '{"post_id": "y"}' where id = 'f6000000-0000-0000-0000-000000000002'$$), false);
select pg_temp.assert('#4 nor the quoted message re-pointed', pg_temp.allows($$
  update messages set reply_to_id = 'f6000000-0000-0000-0000-000000000001'
   where id = 'f6000000-0000-0000-0000-000000000004'$$), false);
select pg_temp.assert('#5 deleting your message still works (what every build sends)', pg_temp.allows($$
  update messages set deleted_at = now() where id = 'f6000000-0000-0000-0000-000000000002'$$), true);
reset role;
select pg_temp.assert('#1 it still says what it said',
  (select body = 'you are awful' and kind = 'text' from messages where id = 'f6000000-0000-0000-0000-000000000001'), true);
select pg_temp.assert('#5 and it is marked deleted',
  (select deleted_at is not null from messages where id = 'f6000000-0000-0000-0000-000000000002'), true);

-- Deleting a quoted message clears the quote (ON DELETE SET NULL is an UPDATE).
delete from messages where id = 'f6000000-0000-0000-0000-000000000001';
select pg_temp.assert('#6 deleting a quoted message still clears the quote',
  (select reply_to_id is null from messages where id = 'f6000000-0000-0000-0000-000000000003'), true);

-- ── Reactions ────────────────────────────────────────────────────────────────
select pg_temp.set_user('f4000000-0000-0000-0000-000000000002');
set local role authenticated;
-- What the app sends: an upsert on (message_id, user_id).
insert into message_reactions (message_id, user_id, emoji)
values ('f6000000-0000-0000-0000-000000000004', 'f4000000-0000-0000-0000-000000000002', '🔥')
on conflict (message_id, user_id) do update set emoji = excluded.emoji;
select pg_temp.assert('#7 a member can change their reaction to another emoji', pg_temp.allows($$
  insert into message_reactions (message_id, user_id, emoji)
  values ('f6000000-0000-0000-0000-000000000004', 'f4000000-0000-0000-0000-000000000002', '😂')
  on conflict (message_id, user_id) do update set emoji = excluded.emoji$$), true);
select pg_temp.assert('#8 but cannot move it into a chat they are not in', pg_temp.allows($$
  update message_reactions set message_id = 'f6000000-0000-0000-0000-000000000009'
   where message_id = 'f6000000-0000-0000-0000-000000000004' and user_id = 'f4000000-0000-0000-0000-000000000002'$$), false);
reset role;
select pg_temp.assert('#7 the reaction is now the new emoji',
  (select emoji = '😂' from message_reactions
    where message_id = 'f6000000-0000-0000-0000-000000000004' and user_id = 'f4000000-0000-0000-0000-000000000002'), true);

select pg_temp.set_user('f4000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert('#9 someone outside the chat cannot react', pg_temp.allows($$
  insert into message_reactions (message_id, user_id, emoji)
  values ('f6000000-0000-0000-0000-000000000004', 'f4000000-0000-0000-0000-000000000003', '👀')$$), false);
update message_reactions set emoji = '💩'
 where message_id = 'f6000000-0000-0000-0000-000000000004' and user_id = 'f4000000-0000-0000-0000-000000000002';
reset role;
select pg_temp.assert('#10 nor change someone else''s reaction',
  (select emoji = '😂' from message_reactions
    where message_id = 'f6000000-0000-0000-0000-000000000004' and user_id = 'f4000000-0000-0000-0000-000000000002'), true);

rollback;
