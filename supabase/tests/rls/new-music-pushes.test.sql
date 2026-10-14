-- New music pushes (20261027000000): a friend's new song, and the weekly Fresh on Livil
-- roundup, on the scheduled-push machinery of 20261025000000.
--
-- Pins: (1) a new drop reaches the uploader's friends and starrers only — never a stranger,
-- a blocked person, someone with New music off, someone without a phone, or the uploader —
-- at most once a day each, once per upload, only for uploads posted since the switch went
-- on, after a two-minute grace; (2) its text names the uploader and the song, cleaned of
-- control characters; (3) the roundup counts only what the viewer has not seen, never their
-- own, and a stranger's upload only once its copyright scan is clean (never a stranger's
-- video); it names friends and starred artists and counts everyone else; (4) both slots do
-- nothing while off; (5) the fill-ins are checked per pool; (6) no client can run them;
-- (7) "Preview on my phone" fills both in.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/new-music-pushes.test.sql

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

create or replace function pg_temp.assert_eq(label text, actual text, expected text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL  %  (expected %, got %)', label, expected, actual;
  end if;
  raise notice 'ok    %', label;
end $$;

-- auth.uid() reads a setting, as in scheduled-pushes.test.sql (is_ops() is evaluated inside
-- cached plpgsql expressions).
create or replace function auth.uid() returns uuid language sql stable as $f$
  select nullif(current_setting('test.auth_uid', true), '')::uuid
$f$;
create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('test.auth_uid', coalesce(uid::text, ''), true);
end $$;

create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception when others then
  return false;
end $$;

grant usage on schema auth to authenticated;

-- ARTIST uploads. FRIEND and FAN (stars ARTIST) should hear about it; everyone else must not.
insert into auth.users (id) values
  ('d1000000-0000-0000-0000-000000000001'),  -- ARTIST
  ('d1000000-0000-0000-0000-000000000002'),  -- FRIEND
  ('d1000000-0000-0000-0000-000000000003'),  -- FAN (stars ARTIST)
  ('d1000000-0000-0000-0000-000000000004'),  -- STRANGER
  ('d1000000-0000-0000-0000-000000000005'),  -- BLOCKED (friend, but blocked ARTIST)
  ('d1000000-0000-0000-0000-000000000006'),  -- OFF (friend, New music off)
  ('d1000000-0000-0000-0000-000000000007'),  -- NOPHONE (friend, no device)
  ('d1000000-0000-0000-0000-000000000008'),  -- CAPPED (friend, had a new drop an hour ago)
  ('d1000000-0000-0000-0000-000000000009'),  -- DEV (a stranger to everyone, uploads)
  ('d1000000-0000-0000-0000-000000000010')   -- OPS
on conflict do nothing;

insert into profiles (id, username, display_name, avatar_url, username_set) values
  ('d1000000-0000-0000-0000-000000000001', 'nm_artist', 'Arjun' || chr(8238) || ' Mehta',
   'https://fqzrmqnlgjeuxzinbqvs.supabase.co/storage/v1/object/public/avatars/arjun.jpg', true),
  ('d1000000-0000-0000-0000-000000000002', 'nm_friend',   'Riya',  null, true),
  ('d1000000-0000-0000-0000-000000000003', 'nm_fan',      'Kavya', null, true),
  ('d1000000-0000-0000-0000-000000000004', 'nm_stranger', 'Sam',   null, true),
  ('d1000000-0000-0000-0000-000000000005', 'nm_blocked',  'Bo',    null, true),
  ('d1000000-0000-0000-0000-000000000006', 'nm_off',      'Oz',    null, true),
  ('d1000000-0000-0000-0000-000000000007', 'nm_nophone',  'Ned',   null, true),
  ('d1000000-0000-0000-0000-000000000008', 'nm_capped',   'Cy',    null, true),
  ('d1000000-0000-0000-0000-000000000009', 'nm_dev',      'Dev',   null, true),
  ('d1000000-0000-0000-0000-000000000010', 'nm_ops',      'Ops',   null, true)
on conflict do nothing;

insert into ops_users (user_id) values ('d1000000-0000-0000-0000-000000000010') on conflict do nothing;

insert into friendships (user_a_id, user_b_id, status, requested_by, accepted_at)
select least('d1000000-0000-0000-0000-000000000001'::uuid, f), greatest('d1000000-0000-0000-0000-000000000001'::uuid, f),
       'accepted', 'd1000000-0000-0000-0000-000000000001', now()
  from unnest(array['d1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000005',
                    'd1000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-000000000007',
                    'd1000000-0000-0000-0000-000000000008']::uuid[]) f
on conflict do nothing;
insert into follows (follower_id, following_id, kind) values
  ('d1000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000001', 'star')
on conflict do nothing;
insert into blocked_users (blocker_id, blocked_id) values
  ('d1000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-000000000001')
on conflict do nothing;
insert into notification_preferences (user_id, new_music) values
  ('d1000000-0000-0000-0000-000000000006', false)
on conflict (user_id) do update set new_music = false;

insert into device_tokens (user_id, token, device_id, platform)
select u, 'tok-' || u::text, 'dev-' || u::text, 'android'
  from unnest(array['d1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002',
                    'd1000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000004',
                    'd1000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-000000000006',
                    'd1000000-0000-0000-0000-000000000008', 'd1000000-0000-0000-0000-000000000009',
                    'd1000000-0000-0000-0000-000000000010']::uuid[]) u;

-- CAPPED already had a new drop an hour ago.
insert into push_sends (id, slot, kind) values ('d4000000-0000-0000-0000-000000000001', 'new_drop', 'new_drop');
insert into push_deliveries (send_id, recipient_id, title, body, created_at) values
  ('d4000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000008', 'x', 'y', now() - interval '1 hour');

insert into tracks (id, uploader_id, title, media_kind, audio_url, video_url) values
  ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'Midnight' || chr(10) || 'Chai', 'audio', 'https://example.invalid/1.mp3', null),
  ('d2000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001', 'Old One',       'audio', 'https://example.invalid/2.mp3', null),
  ('d2000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000001', 'Too Fresh',     'audio', 'https://example.invalid/3.mp3', null),
  ('d2000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000009', 'Clean Song',    'audio', 'https://example.invalid/4.mp3', null),
  ('d2000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-000000000009', 'Unscanned',     'audio', 'https://example.invalid/5.mp3', null),
  ('d2000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-000000000009', 'Video Thing',   'video', null, 'https://example.invalid/6.mp4'),
  ('d2000000-0000-0000-0000-000000000007', 'd1000000-0000-0000-0000-000000000009', 'Matched',       'audio', 'https://example.invalid/7.mp3', null)
on conflict do nothing;

insert into track_copyright_scans (track_id, provider, scanned_media_url, status, match_found, completed_at) values
  ('d2000000-0000-0000-0000-000000000004', 'audd', 'https://example.invalid/4.mp3', 'complete', false, now()),
  ('d2000000-0000-0000-0000-000000000007', 'audd', 'https://example.invalid/7.mp3', 'complete', true,  now());

insert into posts (id, author_id, kind, track_id, created_at) values
  -- 10 minutes old: the one to announce.
  ('d3000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'upload', 'd2000000-0000-0000-0000-000000000001', now() - interval '10 minutes'),
  -- Before the switch went on (40 minutes ago): never announced.
  ('d3000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001', 'upload', 'd2000000-0000-0000-0000-000000000002', now() - interval '50 minutes'),
  -- Under the two-minute grace: not yet.
  ('d3000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000001', 'upload', 'd2000000-0000-0000-0000-000000000003', now() - interval '30 seconds'),
  -- DEV's week: clean, unscanned, a video, and a matched one.
  ('d3000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000009', 'upload', 'd2000000-0000-0000-0000-000000000004', now() - interval '2 days'),
  ('d3000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-000000000009', 'upload', 'd2000000-0000-0000-0000-000000000005', now() - interval '2 days'),
  ('d3000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-000000000009', 'upload', 'd2000000-0000-0000-0000-000000000006', now() - interval '2 days'),
  ('d3000000-0000-0000-0000-000000000007', 'd1000000-0000-0000-0000-000000000009', 'upload', 'd2000000-0000-0000-0000-000000000007', now() - interval '2 days')
on conflict do nothing;

delete from net.stub_requests;

-- ── 4. Off means off ────────────────────────────────────────────────────────
select pg_temp.assert('4a  a new drop does nothing while its slot is off',
  push_run_new_drops() = 0 and push_run_originals() is null, true);

-- Switch on 40 minutes ago (the stamp trigger sets updated_at; move it back afterwards).
update push_slots set enabled = true where slot in ('new_drop', 'originals_weekly');
update push_slots set updated_at = now() - interval '40 minutes' where slot = 'new_drop';

-- ── 1/2. New drop ───────────────────────────────────────────────────────────
select pg_temp.assert('1a  one upload is announced (old and too-fresh ones are not)',
  push_run_new_drops() = 1, true);
select id as drop1 from push_sends where slot = 'new_drop' and post_id = 'd3000000-0000-0000-0000-000000000001' \gset

select pg_temp.assert_eq('1b  it reaches the friend and the fan, nobody else',
  (select string_agg(p.username, ',' order by p.username)
     from push_deliveries d join profiles p on p.id = d.recipient_id
    where d.send_id = :'drop1'),
  'nm_fan,nm_friend');
select pg_temp.assert('1c  …and is handed to send-push',
  (select count(*) from net.stub_requests where body ->> 'scheduledSendId' = :'drop1') = 1, true);
select pg_temp.assert_eq('2a  the bold line names the uploader, direction overrides removed',
  (select title from push_deliveries where send_id = :'drop1' limit 1), 'Arjun Mehta dropped a new song 🎧');
select pg_temp.assert_eq('2b  the text names the song, control characters removed',
  (select body from push_deliveries where send_id = :'drop1' limit 1), '“Midnight Chai” · be one of the first to listen');
select pg_temp.assert('2c  the photo is the uploader''s',
  (select bool_and(avatar_url like '%arjun.jpg') from push_deliveries where send_id = :'drop1'), true);

select pg_temp.assert('1d  running again announces nothing new',
  push_run_new_drops() = 0, true);
select pg_temp.assert('1e  …and the upload has exactly one send',
  (select count(*) from push_sends where post_id = 'd3000000-0000-0000-0000-000000000001') = 1, true);
select pg_temp.assert('1f  the post_id is unique for new drops',
  pg_temp.allows($q$insert into push_sends (slot, kind, post_id)
                    values ('new_drop', 'new_drop', 'd3000000-0000-0000-0000-000000000001')$q$), false);

-- The too-fresh upload, once past the grace, goes to the fan and the friend — no: both just
-- had a new drop, so the day's cap holds it back from both.
update posts set created_at = now() - interval '5 minutes' where id = 'd3000000-0000-0000-0000-000000000003';
select pg_temp.assert('1g  a second upload the same day is announced…',
  push_run_new_drops() = 1, true);
select pg_temp.assert('1h  …to nobody who already had a new drop today',
  (select recipients from push_sends where post_id = 'd3000000-0000-0000-0000-000000000003') = 0, true);

-- ── 3. The roundup ──────────────────────────────────────────────────────────
-- STRANGER knows nobody: DEV's clean audio counts; unscanned, video and matched do not;
-- ARTIST's three are not copyright-scanned at all, so they do not count either.
select pg_temp.assert_eq('3a  a stranger''s upload counts only when its scan is clean',
  (select songs || ' / ' || names from push_originals_for('d1000000-0000-0000-0000-000000000004', now() - interval '7 days', now())),
  '1 / 1 Livil artist');
-- FRIEND knows ARTIST: all three of ARTIST's count without a scan, plus DEV's clean one.
select pg_temp.assert_eq('3b  a friend''s uploads count without a scan, and the friend is named',
  (select songs || ' / ' || names from push_originals_for('d1000000-0000-0000-0000-000000000002', now() - interval '7 days', now())),
  '4 / Arjun Mehta and 1 other');
insert into post_impressions (user_id, post_id, seen_count, last_seen_at) values
  ('d1000000-0000-0000-0000-000000000004', 'd3000000-0000-0000-0000-000000000004', 1, now());
select pg_temp.assert('3c  what the viewer already saw in the feed is not news',
  (select songs from push_originals_for('d1000000-0000-0000-0000-000000000004', now() - interval '7 days', now())) = 0, true);
select pg_temp.assert('3d  the uploader is never told about their own songs',
  (select songs from push_originals_for('d1000000-0000-0000-0000-000000000009', now() - interval '7 days', now())) = 0, true);

select push_run_originals() as weekly \gset
select pg_temp.assert('3e  the roundup reaches only people with something new and the switch on',
  (select bool_and(recipient_id not in ('d1000000-0000-0000-0000-000000000006',   -- OFF
                                        'd1000000-0000-0000-0000-000000000009',   -- DEV, own songs
                                        'd1000000-0000-0000-0000-000000000004'))  -- saw it already
     from push_deliveries where send_id = :'weekly'), true);
select pg_temp.assert_eq('3f  …filled in',
  (select body from push_deliveries where send_id = :'weekly'
     and recipient_id = 'd1000000-0000-0000-0000-000000000002'),
  '4 songs from Arjun Mehta and 1 other · have a listen');

-- ── 5. Fill-ins per pool ────────────────────────────────────────────────────
select pg_temp.assert('5a  a new-drop line may use {name} and {song}',
  pg_temp.allows($q$insert into push_messages (pool, position, title, body)
                    values ('new_drop', 2, '{name} has a new one', '{song}')$q$), true);
select pg_temp.assert('5b  …but not the digest''s {names}',
  pg_temp.allows($q$insert into push_messages (pool, position, title, body)
                    values ('new_drop', 3, '{names}', 'x')$q$), false);
select pg_temp.assert('5c  a roundup line may not use {name}',
  pg_temp.allows($q$insert into push_messages (pool, position, title, body)
                    values ('originals', 3, '{name}', 'x')$q$), false);
select pg_temp.assert('5d  mood lines still refuse braces',
  pg_temp.allows($q$insert into push_messages (pool, position, title, body)
                    values ('mood_evening', 9, 'hey {name}', 'x')$q$), false);

-- ── 6. Scheduler-only ───────────────────────────────────────────────────────
select pg_temp.assert('6a  no client can run a new-drop pass',
  has_function_privilege('authenticated', 'public.push_run_new_drops()', 'execute')
  or has_function_privilege('anon', 'public.push_run_new_drops()', 'execute'), false);
select pg_temp.assert('6b  …or the roundup',
  has_function_privilege('authenticated', 'public.push_run_originals()', 'execute'), false);
select pg_temp.assert('6c  …or read anyone''s roundup',
  has_function_privilege('authenticated', 'public.push_originals_for(uuid, timestamptz, timestamptz)', 'execute'), false);

-- ── 7. Preview on my phone ──────────────────────────────────────────────────
select pg_temp.set_user('d1000000-0000-0000-0000-000000000010');
set local role authenticated;
select ops_push_test((select id from public.push_messages where pool = 'new_drop' and position = 1)) as t_drop \gset
select ops_push_test((select id from public.push_messages where pool = 'originals' and position = 1)) as t_week \gset
reset role;
select pg_temp.assert('7a  a new-drop preview is filled in (an example, ops has no upload)',
  (select title = 'Arjun dropped a new song 🎧' and body !~ '[{}]' from push_deliveries where send_id = :'t_drop'), true);
select pg_temp.assert('7b  a roundup preview is filled in',
  (select title !~ '[{}]' and body !~ '[{}]' from push_deliveries where send_id = :'t_week'), true);
select pg_temp.assert('7c  …and both are recorded with their own kind',
  (select string_agg(kind, ',' order by kind) from push_sends where id in (:'t_drop', :'t_week'))
    = 'new_drop,originals_weekly', true);

rollback;
