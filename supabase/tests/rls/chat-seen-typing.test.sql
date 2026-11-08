-- Chat seen time + typing (20261120000000_chat_seen_time_and_typing.sql).
--
--   * the seen time moves only when the reader reads something NEW from the other person;
--   * reopening a chat, a delivery stamp, or reading only your own messages never moves it;
--   * nobody can set it directly or preset it; a phone's fast clock cannot put it, or
--     last_read_at, in the future; moving last_read_at back and forward is not a new read;
--   * a chat from before the migration freezes its last read;
--   * groups never get one;
--   * a typing signal reaches only the other members, each on their own private topic;
--   * outsiders, non-friends and blocked people send nothing; a block is per recipient;
--   * at most one signal a second per person, and a quick stop is never swallowed;
--   * only you can read your own typing topic, and no client can send on it;
--   * anon cannot call send_typing.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/chat-seen-typing.test.sql

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

grant usage on schema auth to authenticated;
grant usage on schema realtime to authenticated;
grant select, insert on realtime.messages to authenticated;

-- realtime.send records instead of sending. Rolled back with the rest of the test.
create table public.typing_test_sent (payload jsonb, event text, topic text, private boolean);
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
  returns void language sql as $$
    insert into public.typing_test_sent values (payload, event, topic, private)
  $$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   RIYA (…01) and SAM (…02) are friends with a DM; CAL (…03) is in no DM; NED (…04) has a
--   DM with Riya but they are not friends. The group holds Riya, Sam and Cal.
insert into auth.users (id) values
  ('e1000000-0000-0000-0000-000000000001'), ('e1000000-0000-0000-0000-000000000002'),
  ('e1000000-0000-0000-0000-000000000003'), ('e1000000-0000-0000-0000-000000000004')
on conflict do nothing;
insert into profiles (id, username, username_set, display_name, avatar_url) values
  ('e1000000-0000-0000-0000-000000000001', 'st_riya', true, 'Riya', null),
  ('e1000000-0000-0000-0000-000000000002', 'st_sam', true, '', 'https://example.com/sam.jpg'),
  ('e1000000-0000-0000-0000-000000000003', 'st_cal', true, 'Cal', null),
  ('e1000000-0000-0000-0000-000000000004', 'st_ned', true, 'Ned', null)
on conflict do nothing;
insert into friendships (user_a_id, user_b_id, status, requested_by) values
  ('e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'accepted',
   'e1000000-0000-0000-0000-000000000001');
insert into conversations (id, kind) values
  ('e2000000-0000-0000-0000-000000000001', 'dm'),
  ('e2000000-0000-0000-0000-000000000002', 'group'),
  ('e2000000-0000-0000-0000-000000000003', 'dm');
insert into conversation_members (conversation_id, user_id, role) values
  ('e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'member'),
  ('e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'member'),
  ('e2000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'member'),
  ('e2000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'member'),
  ('e2000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000003', 'member'),
  ('e2000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'member'),
  ('e2000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000004', 'member');

-- Sam's own row in the DM, read and written as Sam would.
create or replace function pg_temp.sam_seen() returns timestamptz language sql as $$
  select read_receipt_at from conversation_members
   where conversation_id = 'e2000000-0000-0000-0000-000000000001'
     and user_id = 'e1000000-0000-0000-0000-000000000002'
$$;
-- now() is frozen inside a transaction, so a real stamp is told from a kept one by a marker:
-- every "still the old value" check first plants a recognisable time.
create or replace function pg_temp.plant_sam_seen(at timestamptz) returns void language plpgsql as $$
begin
  alter table conversation_members disable trigger trg_conversation_members_read_receipt;
  update conversation_members set read_receipt_at = at
   where conversation_id = 'e2000000-0000-0000-0000-000000000001'
     and user_id = 'e1000000-0000-0000-0000-000000000002';
  alter table conversation_members enable trigger trg_conversation_members_read_receipt;
end $$;
create or replace function pg_temp.sam_reads(at timestamptz) returns void language sql as $$
  update conversation_members set last_read_at = at
   where conversation_id = 'e2000000-0000-0000-0000-000000000001'
     and user_id = 'e1000000-0000-0000-0000-000000000002'
$$;

-- ── The seen time ───────────────────────────────────────────────────────────
select pg_temp.assert('#1 starts empty', pg_temp.sam_seen() is null, true);

insert into messages (conversation_id, sender_id, kind, body, created_at) values
  ('e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'text',
   'up for a jam?', now() - interval '5 days');

select pg_temp.set_user('e1000000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.sam_reads(now() - interval '5 days' + interval '1 minute');
reset role;
select pg_temp.assert('#2 reading a new message stamps the server''s time',
  pg_temp.sam_seen() = now(), true);

select pg_temp.plant_sam_seen('2026-01-01 00:00:00+00');
set local role authenticated;
select pg_temp.sam_reads(now() - interval '1 day');
reset role;
select pg_temp.assert('#3 reopening with nothing new keeps the time',
  pg_temp.sam_seen() = '2026-01-01 00:00:00+00', true);
select pg_temp.assert('#3b ...while last_read_at itself still moves (installed apps rely on it)',
  (select last_read_at = now() - interval '1 day' from conversation_members
    where conversation_id = 'e2000000-0000-0000-0000-000000000001'
      and user_id = 'e1000000-0000-0000-0000-000000000002'), true);

insert into messages (conversation_id, sender_id, kind, body, created_at) values
  ('e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'text',
   'sure', now() - interval '12 hours');
set local role authenticated;
select pg_temp.sam_reads(now() - interval '11 hours');
reset role;
select pg_temp.assert('#4 reading only your own new message keeps the time',
  pg_temp.sam_seen() = '2026-01-01 00:00:00+00', true);

insert into messages (conversation_id, sender_id, kind, body, created_at) values
  ('e2000000-0000-0000-0000-000000000001', null, 'system', 'Riya changed something',
   now() - interval '10 hours');
set local role authenticated;
select pg_temp.sam_reads(now() - interval '9 hours');
reset role;
select pg_temp.assert('#5 a system line is not a message to have seen',
  pg_temp.sam_seen() = '2026-01-01 00:00:00+00', true);

set local role authenticated;
select public.mark_conversation_delivered('e2000000-0000-0000-0000-000000000001', now());
reset role;
select pg_temp.assert('#6 a delivery stamp keeps the time',
  pg_temp.sam_seen() = '2026-01-01 00:00:00+00', true);

set local role authenticated;
update conversation_members set read_receipt_at = '2099-01-01 00:00:00+00'
 where conversation_id = 'e2000000-0000-0000-0000-000000000001'
   and user_id = 'e1000000-0000-0000-0000-000000000002';
reset role;
select pg_temp.assert('#7 a member cannot set it by hand',
  pg_temp.sam_seen() = '2026-01-01 00:00:00+00', true);

insert into messages (conversation_id, sender_id, kind, body, created_at) values
  ('e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'text',
   'tonight?', now() - interval '2 hours');
set local role authenticated;
select pg_temp.sam_reads(now() - interval '1 hour');
reset role;
select pg_temp.assert('#8 the next new message moves it again', pg_temp.sam_seen() = now(), true);

-- A chat from before this migration: a last read, no seen time.
select pg_temp.plant_sam_seen(null);
set local role authenticated;
select pg_temp.sam_reads(now());
reset role;
select pg_temp.assert('#9 an older chat freezes its last read as the seen time',
  pg_temp.sam_seen() = now() - interval '1 hour', true);

insert into conversation_members (conversation_id, user_id, role, read_receipt_at) values
  ('e2000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000003', 'member',
   '2099-01-01 00:00:00+00');
select pg_temp.assert('#10 nobody presets it on insert',
  (select read_receipt_at is null from conversation_members
    where conversation_id = 'e2000000-0000-0000-0000-000000000003'
      and user_id = 'e1000000-0000-0000-0000-000000000003'), true);
delete from conversation_members
 where conversation_id = 'e2000000-0000-0000-0000-000000000003'
   and user_id = 'e1000000-0000-0000-0000-000000000003';

insert into messages (conversation_id, sender_id, kind, body, created_at) values
  ('e2000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'text',
   'hello group', now() - interval '1 minute');
set local role authenticated;
update conversation_members set last_read_at = now()
 where conversation_id = 'e2000000-0000-0000-0000-000000000002'
   and user_id = 'e1000000-0000-0000-0000-000000000002';
reset role;
select pg_temp.assert('#11 a group never gets one',
  (select read_receipt_at is null from conversation_members
    where conversation_id = 'e2000000-0000-0000-0000-000000000002'
      and user_id = 'e1000000-0000-0000-0000-000000000002'), true);

select pg_temp.plant_sam_seen(now() - interval '1 minute');
set local role authenticated;
select pg_temp.sam_reads(now() - interval '6 days');
select pg_temp.sam_reads(now() - interval '2 minutes');
reset role;
select pg_temp.assert('#25 last_read_at going back and forward is not a new read',
  pg_temp.sam_seen() = now() - interval '1 minute', true);

set local role authenticated;
select pg_temp.sam_reads('2099-01-01 00:00:00+00');
reset role;
select pg_temp.assert('#26 a phone''s fast clock cannot put last_read_at in the future',
  (select last_read_at = now() from conversation_members
    where conversation_id = 'e2000000-0000-0000-0000-000000000001'
      and user_id = 'e1000000-0000-0000-0000-000000000002'), true);

-- Riya has read nothing yet in the Ned DM, and Ned has sent nothing.
select pg_temp.set_user('e1000000-0000-0000-0000-000000000001');
set local role authenticated;
update conversation_members set last_read_at = now()
 where conversation_id = 'e2000000-0000-0000-0000-000000000003'
   and user_id = 'e1000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.assert('#27 opening a chat for the first time with nothing new sets no time',
  (select read_receipt_at is null from conversation_members
    where conversation_id = 'e2000000-0000-0000-0000-000000000003'
      and user_id = 'e1000000-0000-0000-0000-000000000001'), true);
select pg_temp.set_user('e1000000-0000-0000-0000-000000000002');

-- ── Typing ──────────────────────────────────────────────────────────────────
set local role authenticated;
select public.send_typing('e2000000-0000-0000-0000-000000000001', true);
reset role;
select pg_temp.assert('#12 one signal, on the other person''s own topic',
  (select count(*) = 1 and bool_and(topic = 'typing:e1000000-0000-0000-0000-000000000001')
     from public.typing_test_sent), true);
select pg_temp.assert('#13 private, and says who is typing where (username when no display name)',
  (select private and event = 'typing'
      and payload->>'conversation_id' = 'e2000000-0000-0000-0000-000000000001'
      and payload->>'user_id' = 'e1000000-0000-0000-0000-000000000002'
      and (payload->>'typing')::boolean
      and payload->>'name' = 'st_sam'
      and payload->>'avatar_url' = 'https://example.com/sam.jpg'
     from public.typing_test_sent), true);

truncate public.typing_test_sent, public.typing_signal_limits;
set local role authenticated;
select public.send_typing('e2000000-0000-0000-0000-000000000001', false);
reset role;
select pg_temp.assert('#14 stopping is a signal too',
  (select count(*) = 1 and bool_and(not (payload->>'typing')::boolean)
     from public.typing_test_sent), true);

truncate public.typing_test_sent, public.typing_signal_limits;
select pg_temp.set_user('e1000000-0000-0000-0000-000000000003');
set local role authenticated;
select public.send_typing('e2000000-0000-0000-0000-000000000001', true);
reset role;
select pg_temp.assert('#15 someone outside the chat sends nothing',
  (select count(*) = 0 from public.typing_test_sent), true);

select pg_temp.set_user('e1000000-0000-0000-0000-000000000004');
set local role authenticated;
select public.send_typing('e2000000-0000-0000-0000-000000000003', true);
reset role;
select pg_temp.assert('#16 a DM with someone no longer a friend sends nothing',
  (select count(*) = 0 from public.typing_test_sent), true);

truncate public.typing_test_sent, public.typing_signal_limits;
select pg_temp.set_user('e1000000-0000-0000-0000-000000000002');
set local role authenticated;
select public.send_typing('e2000000-0000-0000-0000-000000000002', true);
reset role;
select pg_temp.assert('#17 a group reaches every other member, not the sender',
  (select count(*) = 2
      and bool_and(topic in ('typing:e1000000-0000-0000-0000-000000000001',
                             'typing:e1000000-0000-0000-0000-000000000003'))
     from public.typing_test_sent), true);

truncate public.typing_test_sent, public.typing_signal_limits;
insert into blocked_users (blocker_id, blocked_id) values
  ('e1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000002');
set local role authenticated;
select public.send_typing('e2000000-0000-0000-0000-000000000002', true);
reset role;
select pg_temp.assert('#18 in a group, a block silences that one recipient',
  (select count(*) = 1 and bool_and(topic = 'typing:e1000000-0000-0000-0000-000000000001')
     from public.typing_test_sent), true);

truncate public.typing_test_sent, public.typing_signal_limits;
delete from blocked_users where blocker_id = 'e1000000-0000-0000-0000-000000000003';
insert into blocked_users (blocker_id, blocked_id) values
  ('e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002');
set local role authenticated;
select public.send_typing('e2000000-0000-0000-0000-000000000001', true);
reset role;
select pg_temp.assert('#19 a blocked person''s DM sends nothing',
  (select count(*) = 0 from public.typing_test_sent), true);
delete from blocked_users where blocker_id = 'e1000000-0000-0000-0000-000000000001';

truncate public.typing_test_sent, public.typing_signal_limits;
set local role authenticated;
select public.send_typing('e2000000-0000-0000-0000-000000000001', true);
select public.send_typing('e2000000-0000-0000-0000-000000000001', true);
reset role;
select pg_temp.assert('#28 the same signal twice within a second sends once',
  (select count(*) = 1 from public.typing_test_sent), true);

set local role authenticated;
select public.send_typing('e2000000-0000-0000-0000-000000000001', false);
reset role;
select pg_temp.assert('#29 a quick stop is not swallowed',
  (select count(*) = 2 from public.typing_test_sent), true);

update public.typing_signal_limits set last_sent_at = now() - interval '2 seconds';
set local role authenticated;
select public.send_typing('e2000000-0000-0000-0000-000000000001', true);
reset role;
select pg_temp.assert('#30 after a second it sends again',
  (select count(*) = 3 from public.typing_test_sent), true);

-- Refused outright on production. CI's blanket grant lets the read through, and RLS with no
-- policies is what stops it there: either way, nothing comes back.
do $$
declare
  v_rows bigint;
begin
  set local role authenticated;
  begin
    select count(*) into v_rows from public.typing_signal_limits;
  exception when insufficient_privilege then
    v_rows := 0;
  end;
  reset role;
  if v_rows <> 0 then
    raise exception 'FAIL  #31 a member could read the rate limit';
  end if;
  raise notice 'ok    #31 the rate limit is server-only: a member reads nothing from it';
end $$;

truncate public.typing_test_sent, public.typing_signal_limits;
insert into auth.users (id)
  select ('e3000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 50) n;
insert into profiles (id, username, username_set)
  select ('e3000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'st_crowd' || n, true
    from generate_series(1, 50) n;
insert into conversation_members (conversation_id, user_id, role)
  select 'e2000000-0000-0000-0000-000000000002',
         ('e3000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'member'
    from generate_series(1, 50) n;
set local role authenticated;
select public.send_typing('e2000000-0000-0000-0000-000000000002', true);
reset role;
select pg_temp.assert('#20 a very large group gets no signal',
  (select count(*) = 0 from public.typing_test_sent), true);

-- ── Who can listen ──────────────────────────────────────────────────────────
-- What the realtime server checks when a private channel joins: this topic's setting, then a
-- read of realtime.messages as the joining user.
insert into realtime.messages (topic, extension, event, payload, private) values
  ('typing:e1000000-0000-0000-0000-000000000001', 'broadcast', 'typing', '{}', true),
  ('typing:e1000000-0000-0000-0000-000000000002', 'broadcast', 'typing', '{}', true);

select pg_temp.set_user('e1000000-0000-0000-0000-000000000001');
select set_config('realtime.topic', 'typing:e1000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select pg_temp.assert('#21 Riya can join her own topic, and sees only rows on it',
  (select count(*) = 1 and bool_and(topic = 'typing:e1000000-0000-0000-0000-000000000001')
     from realtime.messages), true);
reset role;

select set_config('realtime.topic', 'typing:e1000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select pg_temp.assert('#22 Riya cannot join Sam''s topic',
  (select count(*) = 0 from realtime.messages), true);
reset role;

do $$
begin
  perform set_config('realtime.topic', 'typing:e1000000-0000-0000-0000-000000000002', true);
  set local role authenticated;
  begin
    insert into realtime.messages (topic, extension, event, payload, private) values
      ('typing:e1000000-0000-0000-0000-000000000002', 'broadcast', 'typing', '{}', true);
    raise exception 'FAIL  #23 a client could send on a typing topic itself';
  exception when insufficient_privilege then
    raise notice 'ok    #23 a client cannot send on a typing topic itself';
  end;
  reset role;
end $$;

select pg_temp.assert('#24 anon cannot call send_typing',
  has_function_privilege('anon', 'public.send_typing(uuid, boolean)', 'execute'), false);

rollback;
