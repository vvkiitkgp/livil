-- Scheduled pushes (20261025000000): mood nudges + repost digests.
--
-- Pins what the migration exists for:
--
--   1. WHO CAN TOUCH IT — messages and slots are ops-only (read, write, switch); sends,
--      deliveries and config are deny-all; a tap is recorded only by its own recipient;
--      the ops readers and the test send answer nobody else.
--   2. WHAT A DIGEST SAYS — exactly the reposts the recipient may see (the posts policy's
--      predicate: public reposters, friends' friends-only reposts, never a block, never
--      their own) and has not already seen in the feed, named friends first, then people
--      they star, then everyone else; and only reposts since the previous digest.
--   3. WHO GETS ONE — a phone, the right switch on, something to say; mood nudges skip
--      anyone who posted today; a slot that is off sends nothing.
--   4. THE LOOP — rotation, the hand-off to send-push, retry, expiry, and came_back.
--
-- The CI harness records net.http_post calls in net.stub_requests instead of sending them.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/scheduled-pushes.test.sql

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

create or replace function pg_temp.assert_eq(label text, actual text, expected text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL  %  (expected %, got %)', label, expected, actual;
  end if;
  raise notice 'ok    %', label;
end $$;

create or replace function pg_temp.assert_count(label text, actual bigint, expected bigint)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL  %  (expected % row(s), got %)', label, expected, actual;
  end if;
  raise notice 'ok    %', label;
end $$;

-- auth.uid() reads a setting, the way Supabase's reads the request's JWT claims, rather
-- than being redefined per user: is_ops() is evaluated inside cached plpgsql expressions in
-- the ops functions, and a constant inlined there would keep answering for whoever called
-- first in this transaction.
create or replace function auth.uid() returns uuid language sql stable as $f$
  select nullif(current_setting('test.auth_uid', true), '')::uuid
$f$;
create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('test.auth_uid', uid::text, true);
end $$;

create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when others then return false;
end $$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- OP is an operator. ANA is the viewer we look through. BEA is Ana's friend and shows her
-- reposts to friends only. CYD shows reposts to everyone. DEX is public too, but Ana has
-- blocked him. ELI is public and Ana stars him. FAY has no phone.
--   c7..01 OP   c7..02 ANA   c7..03 BEA   c7..04 CYD   c7..05 DEX   c7..06 ELI   c7..07 FAY
insert into auth.users (id) values
  ('c7000000-0000-0000-0000-000000000001'), ('c7000000-0000-0000-0000-000000000002'),
  ('c7000000-0000-0000-0000-000000000003'), ('c7000000-0000-0000-0000-000000000004'),
  ('c7000000-0000-0000-0000-000000000005'), ('c7000000-0000-0000-0000-000000000006'),
  ('c7000000-0000-0000-0000-000000000007')
on conflict do nothing;

insert into profiles (id, username, username_set, display_name) values
  ('c7000000-0000-0000-0000-000000000001', 'sp_op',  true, 'Op'),
  ('c7000000-0000-0000-0000-000000000002', 'sp_ana', true, 'Ana'),
  ('c7000000-0000-0000-0000-000000000003', 'sp_bea', true, 'Bea'),
  ('c7000000-0000-0000-0000-000000000004', 'sp_cyd', true, 'Cyd'),
  ('c7000000-0000-0000-0000-000000000005', 'sp_dex', true, 'Dex'),
  ('c7000000-0000-0000-0000-000000000006', 'sp_eli', true, null),
  ('c7000000-0000-0000-0000-000000000007', 'sp_fay', true, 'Fay')
on conflict do nothing;

update profiles set reposts_public = (id <> 'c7000000-0000-0000-0000-000000000003')
 where id::text like 'c7000000-%';

insert into ops_users (user_id) values ('c7000000-0000-0000-0000-000000000001') on conflict do nothing;

insert into device_tokens (user_id, token, device_id, platform) values
  ('c7000000-0000-0000-0000-000000000001', 'tok-op',  'dev-op',  'ios'),
  ('c7000000-0000-0000-0000-000000000002', 'tok-ana', 'dev-ana', 'android'),
  ('c7000000-0000-0000-0000-000000000003', 'tok-bea', 'dev-bea', 'android'),
  ('c7000000-0000-0000-0000-000000000004', 'tok-cyd', 'dev-cyd', 'android')
on conflict do nothing;

insert into friendships (user_a_id, user_b_id, status, requested_by, accepted_at) values
  ('c7000000-0000-0000-0000-000000000002', 'c7000000-0000-0000-0000-000000000003',
   'accepted', 'c7000000-0000-0000-0000-000000000002', now())
on conflict do nothing;
insert into follows (follower_id, following_id) values
  ('c7000000-0000-0000-0000-000000000002', 'c7000000-0000-0000-0000-000000000006')
on conflict do nothing;
insert into blocked_users (blocker_id, blocked_id) values
  ('c7000000-0000-0000-0000-000000000002', 'c7000000-0000-0000-0000-000000000005')
on conflict do nothing;

-- Reposts, all a second ago (inside "today" and inside the first digest's window).
-- Bea 2 (friends only), Cyd 1, Dex 1 (blocked by Ana), Eli 1 (starred by Ana), Ana 1 (own).
update app_switches set enabled = true where key = 'spotify_reposts';
insert into posts (author_id, kind, spotify_track_id, created_at) values
  ('c7000000-0000-0000-0000-000000000003', 'repost', '0VjIjW4GlUZAMYd2vXMi3b', now() - interval '1 second'),
  ('c7000000-0000-0000-0000-000000000003', 'repost', '1VjIjW4GlUZAMYd2vXMi3b', now() - interval '1 second'),
  ('c7000000-0000-0000-0000-000000000004', 'repost', '2VjIjW4GlUZAMYd2vXMi3b', now() - interval '1 second'),
  ('c7000000-0000-0000-0000-000000000005', 'repost', '3VjIjW4GlUZAMYd2vXMi3b', now() - interval '1 second'),
  ('c7000000-0000-0000-0000-000000000006', 'repost', '4VjIjW4GlUZAMYd2vXMi3b', now() - interval '1 second'),
  ('c7000000-0000-0000-0000-000000000002', 'repost', '5VjIjW4GlUZAMYd2vXMi3b', now() - interval '1 second');

-- ── 2. What a digest says ───────────────────────────────────────────────────
select pg_temp.assert_eq('2a  Ana counts Bea (friend, 2), Eli (starred), Cyd — never Dex (blocked) or herself',
  (select songs || ' songs / ' || people || ' people'
     from push_digest_for('c7000000-0000-0000-0000-000000000002', now() - interval '1 hour', now())),
  '4 songs / 3 people');
select pg_temp.assert_eq('2b  named friends first, then starred, then everyone; @username without a display name',
  (select names from push_digest_for('c7000000-0000-0000-0000-000000000002', now() - interval '1 hour', now())),
  'Bea, @sp_eli and 1 other');
select pg_temp.assert_eq('2c  a stranger (Cyd) sees Ana, Dex and Eli''s public reposts, never Bea''s friends-only ones',
  (select songs || '/' || people from push_digest_for('c7000000-0000-0000-0000-000000000004',
     now() - interval '1 hour', now())),
  '3/3');
select pg_temp.assert('2d  … and Bea is never named to him',
  (select names not like '%Bea%' and names like '%, % and 1 other'
     from push_digest_for('c7000000-0000-0000-0000-000000000004', now() - interval '1 hour', now())),
  true);
select pg_temp.assert_eq('2e  a block works both ways (Dex never sees Ana); two people read "X and Y"',
  (select names from push_digest_for('c7000000-0000-0000-0000-000000000005',
     now() - interval '1 hour', now())),
  'Cyd and @sp_eli');
select pg_temp.assert_eq('2f  outside the window there is nothing',
  (select songs::text from push_digest_for('c7000000-0000-0000-0000-000000000002',
     now() - interval '2 hours', now() - interval '1 hour')),
  '0');
select pg_temp.assert_eq('2g  fill-ins: names, songs (plural), since',
  push_render('{names}|reposted {songs} {since}', 'Bea and Cyd', 4, 'today'),
  'Bea and Cyd|reposted 4 songs today');
select pg_temp.assert_eq('2h  one song is singular',
  push_render('reposted {songs}', 'Bea', 1, ''), 'reposted 1 song');

-- A repost Ana already scrolled past in her feed is not news: Cyd's drops out.
insert into post_impressions (user_id, post_id)
select 'c7000000-0000-0000-0000-000000000002', id from posts
 where author_id = 'c7000000-0000-0000-0000-000000000004';
select pg_temp.assert_eq('2i  reposts already seen in the feed are not counted or named',
  (select songs || ' / ' || names from push_digest_for('c7000000-0000-0000-0000-000000000002',
     now() - interval '1 hour', now())),
  '3 / Bea and @sp_eli');
select pg_temp.assert_count('2j  … and only for the person who saw them (Op still counts Cyd)',
  (select songs from push_digest_for('c7000000-0000-0000-0000-000000000001',
     now() - interval '1 hour', now())), 4);
delete from post_impressions where user_id = 'c7000000-0000-0000-0000-000000000002';

-- ── 3. Who gets one ─────────────────────────────────────────────────────────
select pg_temp.assert('3a  a slot that is off sends nothing',
  push_run_slot('digest_morning') is null, true);
select pg_temp.assert_count('3b  … and queues nothing', (select count(*) from push_deliveries), 0);

update push_slots set enabled = true;
select push_run_slot('digest_morning') as digest1 \gset

select pg_temp.assert_eq('3c  Ana''s digest, filled in',
  (select title || ' / ' || body from push_deliveries
    where send_id = :'digest1' and recipient_id = 'c7000000-0000-0000-0000-000000000002'),
  'Bea, @sp_eli and 1 other / reposted 4 songs since last night · check them out');
select pg_temp.assert_count('3d  everyone with a phone and something to see gets one; Fay (no phone) does not',
  (select count(*) from push_deliveries where send_id = :'digest1'), 4);
select pg_temp.assert('3e  the first named person''s photo rides along (Bea has none here)',
  (select avatar_url is null from push_deliveries
    where send_id = :'digest1' and recipient_id = 'c7000000-0000-0000-0000-000000000002'), true);
select pg_temp.assert_count('3f  the send was handed to send-push, once, naming it',
  (select count(*) from net.stub_requests where body ->> 'scheduledSendId' = :'digest1'), 1);
select pg_temp.assert('3g  … through the anon key, past the gateway',
  (select headers ->> 'Authorization' like 'Bearer eyJ%' from net.stub_requests
    where body ->> 'scheduledSendId' = :'digest1'), true);
select pg_temp.assert_count('3h  the send records its recipient count',
  (select recipients from push_sends where id = :'digest1'), 4);

-- The next digest counts only reposts since this one (same transaction → same now(), so
-- nothing is new): nobody gets one, and nothing is handed off.
select push_run_slot('digest_evening') as digest2 \gset
select pg_temp.assert_count('3i  nothing new since the last digest → nobody gets one',
  (select count(*) from push_deliveries where send_id = :'digest2'), 0);
select pg_temp.assert_count('3j  … and send-push is not called',
  (select count(*) from net.stub_requests where body ->> 'scheduledSendId' = :'digest2'), 0);

-- The activity switch silences digests.
insert into notification_preferences (user_id, activity) values
  ('c7000000-0000-0000-0000-000000000004', false)
on conflict (user_id) do update set activity = false;
-- Move the earlier digests back so this one has a window again.
update push_sends set created_at = now() - interval '13 hours'
 where id in (:'digest1', :'digest2');
select push_run_slot('digest_morning') as digest3 \gset
select pg_temp.assert_count('3k  Cyd switched Activity off → no digest for Cyd',
  (select count(*) from push_deliveries where send_id = :'digest3'
     and recipient_id = 'c7000000-0000-0000-0000-000000000004'), 0);

-- Mood: everyone who reposted today is skipped, which leaves only Op (no posts, a phone).
select push_run_slot('mood_morning') as mood1 \gset
select pg_temp.assert_count('3l  mood nudge skips everyone who posted today',
  (select count(*) from push_deliveries where send_id = :'mood1'), 1);
select pg_temp.assert_eq('3m  … and is the first morning line for Op',
  (select title from push_deliveries where send_id = :'mood1'
     and recipient_id = 'c7000000-0000-0000-0000-000000000001'),
  'Ssup, music buddy? 👀');

-- ── 4. The loop ─────────────────────────────────────────────────────────────
select push_run_slot('mood_morning') as mood2 \gset
select pg_temp.assert_eq('4a  the next run rotates to the next line',
  (select title from push_deliveries where send_id = :'mood2'), 'Hey, suggest me a song? 🥹');
update push_messages set active = false where pool = 'mood_morning' and position = 3;
select push_run_slot('mood_morning') as mood3 \gset
select pg_temp.assert_eq('4b  a line switched off is skipped',
  (select title from push_deliveries where send_id = :'mood3'), 'A little birdie asked… 🐦');
select push_run_slot('mood_morning') as mood4 \gset
select push_run_slot('mood_morning') as mood5 \gset
select pg_temp.assert_eq('4c  after the last line it wraps to the first',
  (select title from push_deliveries where send_id = :'mood5'), 'Ssup, music buddy? 👀');

insert into notification_preferences (user_id, reminders) values
  ('c7000000-0000-0000-0000-000000000001', false)
on conflict (user_id) do update set reminders = false;
select push_run_slot('mood_evening') as mood6 \gset
select pg_temp.assert_count('4d  the reminders switch silences mood nudges',
  (select count(*) from push_deliveries where send_id = :'mood6'), 0);

-- Retry, expiry and came_back. Backdate rows as send-push and time would have left them.
delete from net.stub_requests;
update push_deliveries set created_at = now() - interval '5 minutes'
 where send_id = :'mood1';
update push_deliveries set status = 'queued', created_at = now() - interval '2 hours'
 where send_id = :'mood2';
update push_deliveries set status = 'sent', sent_at = now() - interval '2 hours'
 where send_id in (:'digest1');
insert into user_last_seen (user_id, last_seen_at) values
  ('c7000000-0000-0000-0000-000000000002', now() - interval '90 minutes')
on conflict (user_id) do update set last_seen_at = excluded.last_seen_at;

select push_maintain();
select pg_temp.assert_count('4e  a send still queued after 2 minutes is handed off again',
  (select count(*) from net.stub_requests where body ->> 'scheduledSendId' = :'mood1'), 1);
select pg_temp.assert_eq('4f  one still queued after an hour expires instead of buzzing late',
  (select status from push_deliveries where send_id = :'mood2'), 'expired');
select pg_temp.assert('4g  Ana had Livil open after the send → came back',
  (select came_back from push_deliveries where send_id = :'digest1'
     and recipient_id = 'c7000000-0000-0000-0000-000000000002'), true);
select pg_temp.assert('4h  Bea did not → not came back',
  (select came_back from push_deliveries where send_id = :'digest1'
     and recipient_id = 'c7000000-0000-0000-0000-000000000003'), false);

-- ── 1. Who can touch it ─────────────────────────────────────────────────────
-- Ana: not an operator. Delivery ids are looked up now, as the owner: Ana herself can
-- read no delivery, which is the point of 1d.
select id as ana_delivery from push_deliveries where send_id = :'digest1'
   and recipient_id = 'c7000000-0000-0000-0000-000000000002' \gset
select id as bea_delivery from push_deliveries where send_id = :'digest1'
   and recipient_id = 'c7000000-0000-0000-0000-000000000003' \gset
select id as any_message from push_messages limit 1 \gset
select pg_temp.set_user('c7000000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert_count('1a  a user reads no messages',  (select count(*) from push_messages), 0);
select pg_temp.assert_count('1b  … no slots',                (select count(*) from push_slots), 0);
select pg_temp.assert_count('1c  … no sends',                (select count(*) from push_sends), 0);
select pg_temp.assert_count('1d  … no deliveries, not even her own', (select count(*) from push_deliveries), 0);
select pg_temp.assert_count('1e  … no config (the anon key is public, but still)', (select count(*) from push_config), 0);
select pg_temp.assert('1f  … cannot add a message',
  pg_temp.allows($q$insert into push_messages (pool, position, title, body)
                    values ('mood_morning', 50, 'hi', 'there')$q$), false);
update push_slots set enabled = false;
update push_messages set title = 'hacked';
select pg_temp.assert_count('1g  … ops readers answer her nothing',
  (select count(*) from ops_push_message_stats(14)) + (select count(*) from ops_push_recent_sends(20)), 0);
select pg_temp.assert('1h  … and the test send refuses her',
  ops_push_test(:'any_message') is null, true);
-- Her tap on her own delivery is recorded; on Bea's it is not.
select push_record_open(:'ana_delivery');
select push_record_open(:'bea_delivery');
reset role;
select pg_temp.assert_count('1i  slots and messages are untouched by her updates',
  (select count(*) from push_slots where enabled) + (select count(*) from push_messages where title = 'hacked'), 4);
select pg_temp.assert('1j  her own tap is recorded',
  (select opened_at is not null from push_deliveries where send_id = :'digest1'
     and recipient_id = 'c7000000-0000-0000-0000-000000000002'), true);
select pg_temp.assert('1k  her call on Bea''s delivery is not',
  (select opened_at is null from push_deliveries where send_id = :'digest1'
     and recipient_id = 'c7000000-0000-0000-0000-000000000003'), true);

set local role anon;
select pg_temp.assert('1l  anon cannot even call the readers',
  pg_temp.allows($q$select * from ops_push_message_stats(14)$q$), false);
reset role;

-- Op: an operator.
select pg_temp.set_user('c7000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert_count('1m  an operator reads every message', (select count(*) from push_messages), 11);
select pg_temp.assert('1n  … adds one',
  pg_temp.allows($q$insert into push_messages (pool, position, title, body)
                    values ('digest', 2, '{names}', 'reposted {songs} {since} 🎶')$q$), true);
select pg_temp.assert('1o  … a digest fill-in that does not exist is refused',
  pg_temp.allows($q$insert into push_messages (pool, position, title, body)
                    values ('digest', 3, '{name}', 'x')$q$), false);
select pg_temp.assert('1p  … braces in a mood line are refused',
  pg_temp.allows($q$insert into push_messages (pool, position, title, body)
                    values ('mood_evening', 9, 'hey {names}', 'x')$q$), false);
update push_messages set pool = 'digest', title = 'Ssup? 👀'
 where pool = 'mood_morning' and position = 1;
select pg_temp.assert_eq('1q  … edits a line, but cannot move it to another pool',
  (select pool || ' / ' || title from push_messages where title = 'Ssup? 👀'), 'mood_morning / Ssup? 👀');
delete from push_messages where pool = 'mood_morning';
select pg_temp.assert_count('1r  … and never deletes one (switch it off instead)',
  (select count(*) from push_messages where pool = 'mood_morning'), 5);
update push_slots set enabled = false where slot = 'mood_evening';
select pg_temp.assert_count('1s  … switches a slot off',
  (select count(*) from push_slots where not enabled), 1);
select pg_temp.assert('1t  … sees the numbers',
  (select count(*) from ops_push_message_stats(14)) = 12
    and (select count(*) from ops_push_recent_sends(20)) > 0, true);
select pg_temp.assert('1u  … and the stats count the delivered digest',
  (select delivered from ops_push_message_stats(14) where pool = 'digest' and position = 1) = 4, true);
reset role;

-- The test send: to the operator's own phone, filled in, handed off.
select pg_temp.set_user('c7000000-0000-0000-0000-000000000001');
set local role authenticated;
select ops_push_test((select id from public.push_messages where pool = 'digest' and position = 1)) as t1 \gset
reset role;
select pg_temp.assert('1v  the test send goes to the operator only, filled in',
  (select count(*) = 1 and bool_and(recipient_id = 'c7000000-0000-0000-0000-000000000001')
          and bool_and(title !~ '[{}]' and body !~ '[{}]')
     from push_deliveries where send_id = :'t1'), true);
select pg_temp.assert_count('1w  … and is handed off',
  (select count(*) from net.stub_requests where body ->> 'scheduledSendId' = :'t1'), 1);

rollback;
