-- Chat "Delivered" receipts (20261119000000_chat_delivered_receipts.sql).
--
--   * a member stamps their own last_delivered_at — through either function, or the
--     direct update members_update already allows;
--   * it only moves forward and never past the server's clock;
--   * nobody can stamp someone else's, or a chat they are not in;
--   * markAsRead (what every installed app sends) is untouched;
--   * nobody presets it: an insert (a group admin adding someone) starts it null;
--   * groups are never stamped (receipts are one-to-one only);
--   * anon cannot call the functions.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/chat-delivered-receipts.test.sql

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
--   RIYA (…01) and SAM (…02) share a DM; CAL (…03) is in neither.
insert into auth.users (id) values
  ('d1000000-0000-0000-0000-000000000001'), ('d1000000-0000-0000-0000-000000000002'),
  ('d1000000-0000-0000-0000-000000000003')
on conflict do nothing;
insert into profiles (id, username, username_set) values
  ('d1000000-0000-0000-0000-000000000001', 'dr_riya', true),
  ('d1000000-0000-0000-0000-000000000002', 'dr_sam', true),
  ('d1000000-0000-0000-0000-000000000003', 'dr_cal', true)
on conflict do nothing;
insert into conversations (id, kind) values ('d2000000-0000-0000-0000-000000000001', 'dm');
insert into conversation_members (conversation_id, user_id, role) values
  ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'member'),
  ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 'member');
insert into messages (conversation_id, sender_id, kind, body) values
  ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'text', 'up for a jam?');

-- ── Sam's app receives Riya's message ────────────────────────────────────────
select pg_temp.set_user('d1000000-0000-0000-0000-000000000002');
set local role authenticated;
select public.mark_conversation_delivered('d2000000-0000-0000-0000-000000000001', now() - interval '1 minute');
reset role;
select pg_temp.assert('#1 a member stamps their own delivery',
  (select last_delivered_at is not null from conversation_members
    where conversation_id = 'd2000000-0000-0000-0000-000000000001'
      and user_id = 'd1000000-0000-0000-0000-000000000002'), true);

create temp table t_before as
  select last_delivered_at as at from conversation_members
   where conversation_id = 'd2000000-0000-0000-0000-000000000001'
     and user_id = 'd1000000-0000-0000-0000-000000000002';
grant select on t_before to authenticated;

set local role authenticated;
select public.mark_conversation_delivered('d2000000-0000-0000-0000-000000000001', now() - interval '1 hour');
update conversation_members set last_delivered_at = '2000-01-01'
 where conversation_id = 'd2000000-0000-0000-0000-000000000001'
   and user_id = 'd1000000-0000-0000-0000-000000000002';
update conversation_members set last_delivered_at = null
 where conversation_id = 'd2000000-0000-0000-0000-000000000001'
   and user_id = 'd1000000-0000-0000-0000-000000000002';
reset role;
select pg_temp.assert('#2 it never moves back — not by the function, a direct update, or a null',
  (select cm.last_delivered_at = b.at from conversation_members cm, t_before b
    where cm.conversation_id = 'd2000000-0000-0000-0000-000000000001'
      and cm.user_id = 'd1000000-0000-0000-0000-000000000002'), true);

set local role authenticated;
update conversation_members set last_delivered_at = now() + interval '1 day'
 where conversation_id = 'd2000000-0000-0000-0000-000000000001'
   and user_id = 'd1000000-0000-0000-0000-000000000002';
reset role;
select pg_temp.assert('#3 and never past the server''s clock',
  (select last_delivered_at <= now() from conversation_members
    where conversation_id = 'd2000000-0000-0000-0000-000000000001'
      and user_id = 'd1000000-0000-0000-0000-000000000002'), true);

-- ── Only your own row ───────────────────────────────────────────────────────
select pg_temp.set_user('d1000000-0000-0000-0000-000000000003');
set local role authenticated;
select public.mark_conversation_delivered('d2000000-0000-0000-0000-000000000001', now());
select public.mark_conversations_delivered();
update conversation_members set last_delivered_at = now()
 where conversation_id = 'd2000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.assert('#4 an outsider stamps nothing in a chat they are not in',
  (select last_delivered_at is null from conversation_members
    where conversation_id = 'd2000000-0000-0000-0000-000000000001'
      and user_id = 'd1000000-0000-0000-0000-000000000001'), true);

select pg_temp.set_user('d1000000-0000-0000-0000-000000000002');
set local role authenticated;
update conversation_members set last_delivered_at = now()
 where conversation_id = 'd2000000-0000-0000-0000-000000000001'
   and user_id = 'd1000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.assert('#5 a member cannot stamp the OTHER member''s delivery',
  (select last_delivered_at is null from conversation_members
    where conversation_id = 'd2000000-0000-0000-0000-000000000001'
      and user_id = 'd1000000-0000-0000-0000-000000000001'), true);

-- ── The chat list stamps every chat ─────────────────────────────────────────
select pg_temp.set_user('d1000000-0000-0000-0000-000000000001');
set local role authenticated;
select public.mark_conversations_delivered();
reset role;
select pg_temp.assert('#6 mark_conversations_delivered stamps the caller up to each chat''s newest message',
  (select cm.last_delivered_at = c.last_message_at
     from conversation_members cm join conversations c on c.id = cm.conversation_id
    where cm.conversation_id = 'd2000000-0000-0000-0000-000000000001'
      and cm.user_id = 'd1000000-0000-0000-0000-000000000001'), true);

-- ── What installed apps send still works ────────────────────────────────────
set local role authenticated;
select pg_temp.assert('#7 markAsRead (last_read_at) is untouched', pg_temp.allows($$
  update conversation_members set last_read_at = now()
   where conversation_id = 'd2000000-0000-0000-0000-000000000001'
     and user_id = 'd1000000-0000-0000-0000-000000000001'$$), true);
reset role;

select pg_temp.assert('#8 anon cannot call either function',
  not has_function_privilege('anon', 'public.mark_conversation_delivered(uuid, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.mark_conversations_delivered()', 'execute'), true);

-- ── Nobody presets it, and groups are not stamped ──────────────────────────
-- Riya (admin of a group) and Cal are friends, so members_insert lets her add him.
insert into friendships (user_a_id, user_b_id, status, requested_by)
values ('d1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000003',
        'accepted', 'd1000000-0000-0000-0000-000000000001');
insert into conversations (id, kind, name) values ('d2000000-0000-0000-0000-000000000002', 'group', 'jam crew');
insert into conversation_members (conversation_id, user_id, role) values
  ('d2000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001', 'admin');
insert into messages (conversation_id, sender_id, kind, body) values
  ('d2000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001', 'text', 'welcome');

select pg_temp.set_user('d1000000-0000-0000-0000-000000000001');
set local role authenticated;
insert into conversation_members (conversation_id, user_id, role, last_delivered_at)
values ('d2000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000003', 'member', '2099-01-01');
reset role;
select pg_temp.assert('#9 an admin adding a member cannot preset their delivery stamp',
  (select last_delivered_at is null from conversation_members
    where conversation_id = 'd2000000-0000-0000-0000-000000000002'
      and user_id = 'd1000000-0000-0000-0000-000000000003'), true);

select pg_temp.set_user('d1000000-0000-0000-0000-000000000003');
set local role authenticated;
select public.mark_conversation_delivered('d2000000-0000-0000-0000-000000000002', now());
select public.mark_conversations_delivered();
reset role;
select pg_temp.assert('#10 a group is never stamped',
  (select last_delivered_at is null from conversation_members
    where conversation_id = 'd2000000-0000-0000-0000-000000000002'
      and user_id = 'd1000000-0000-0000-0000-000000000003'), true);

rollback;
