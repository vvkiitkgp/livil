-- Chat vibe (20261106000000_chat_vibes.sql).
--
-- Asha and Ben chat, share songs, react, Jam and like each other's posts; their vibe adds
-- it all up, the same for both of them, and never reads what either of them played. Nobody else sees it, a group has none, and a block
-- hides it.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/chat-vibes.test.sql

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

create or replace function pg_temp.assert_eq(label text, actual bigint, expected bigint)
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
update app_switches set enabled = true where key = 'spotify_reposts';

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   ASHA (…01) and BEN (…02) are friends; CARA (…03) chats with Asha; DEV (…04) is outside
insert into auth.users (id) values
  ('e9000000-0000-0000-0000-000000000001'), ('e9000000-0000-0000-0000-000000000002'),
  ('e9000000-0000-0000-0000-000000000003'), ('e9000000-0000-0000-0000-000000000004')
on conflict do nothing;
insert into profiles (id, username, username_set) values
  ('e9000000-0000-0000-0000-000000000001', 'cv_asha', true),
  ('e9000000-0000-0000-0000-000000000002', 'cv_ben', true),
  ('e9000000-0000-0000-0000-000000000003', 'cv_cara', true),
  ('e9000000-0000-0000-0000-000000000004', 'cv_dev', true)
on conflict do nothing;

insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('ea000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001', 'Asha song', 'audio', 'https://example.invalid/a.mp3'),
  ('ea000000-0000-0000-0000-000000000002', 'e9000000-0000-0000-0000-000000000002', 'Ben song', 'audio', 'https://example.invalid/b.mp3'),
  ('ea000000-0000-0000-0000-000000000003', 'e9000000-0000-0000-0000-000000000003', 'Cara song', 'audio', 'https://example.invalid/c.mp3');
insert into posts (id, author_id, kind, track_id) values
  ('eb000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001', 'upload', 'ea000000-0000-0000-0000-000000000001'),
  ('eb000000-0000-0000-0000-000000000002', 'e9000000-0000-0000-0000-000000000002', 'upload', 'ea000000-0000-0000-0000-000000000002'),
  ('eb000000-0000-0000-0000-000000000003', 'e9000000-0000-0000-0000-000000000003', 'upload', 'ea000000-0000-0000-0000-000000000003');

insert into conversations (id, kind) values
  ('ec000000-0000-0000-0000-000000000001', 'dm'),     -- Asha + Ben
  ('ec000000-0000-0000-0000-000000000002', 'dm'),     -- Asha + Cara
  ('ec000000-0000-0000-0000-000000000003', 'group');  -- Asha + Ben, a group
insert into conversation_members (conversation_id, user_id, role) values
  ('ec000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001', 'member'),
  ('ec000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000002', 'member'),
  ('ec000000-0000-0000-0000-000000000002', 'e9000000-0000-0000-0000-000000000001', 'member'),
  ('ec000000-0000-0000-0000-000000000002', 'e9000000-0000-0000-0000-000000000003', 'member'),
  ('ec000000-0000-0000-0000-000000000003', 'e9000000-0000-0000-0000-000000000001', 'member'),
  ('ec000000-0000-0000-0000-000000000003', 'e9000000-0000-0000-0000-000000000002', 'member');

-- Asha + Ben's chat
insert into messages (id, conversation_id, sender_id, kind, body, metadata, created_at, deleted_at) values
  -- two messages: 1 + 1
  ('ed000000-0000-0000-0000-000000000001', 'ec000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001',
   'text', 'hi', null, '2026-10-10 06:00+00', null),
  ('ed000000-0000-0000-0000-000000000002', 'ec000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000002',
   'text', 'hey', null, '2026-10-10 06:01+00', null),
  -- Asha shares Cara's song (3); Ben plays it afterwards — which adds NOTHING (the vibe
  -- never reads anyone's listening)
  ('ed000000-0000-0000-0000-000000000003', 'ec000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001',
   'track_share', '', '{"post_id": "eb000000-0000-0000-0000-000000000003"}', '2026-10-10 06:02+00', null),
  -- Asha shares a Spotify song (3); Ben opens it afterwards — nothing either
  ('ed000000-0000-0000-0000-000000000004', 'ec000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001',
   'text', 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', null, '2026-10-10 06:03+00', null),
  -- a system line and a deleted message count nothing
  ('ed000000-0000-0000-0000-000000000005', 'ec000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001',
   'system', 'The Jam Room has ended.', null, '2026-10-10 06:04+00', null),
  ('ed000000-0000-0000-0000-000000000006', 'ec000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000002',
   'text', 'oops', null, '2026-10-10 06:05+00', '2026-10-10 06:06+00');
insert into post_views (post_id, user_id) values
  ('eb000000-0000-0000-0000-000000000003', 'e9000000-0000-0000-0000-000000000002');
-- Asha shares her own song (3); Ben's earlier play of it adds nothing.
insert into messages (conversation_id, sender_id, kind, body, metadata, created_at) values
  ('ec000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001',
   'track_share', '', '{"post_id": "eb000000-0000-0000-0000-000000000001"}', '2026-10-10 06:07+00');
insert into post_views (post_id, user_id, played_at) values
  ('eb000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000002', '2026-10-01 06:00+00');
insert into spotify_opens (spotify_track_id, source, user_id) values
  ('4uLU6hMCjMI75M1A2tKUQC', 'chat', 'e9000000-0000-0000-0000-000000000002');
-- Ben reacts to Asha's "hi" (1); Asha reacting to her own message, and Dev (not in the
-- chat) reacting to it, count nothing
insert into message_reactions (message_id, user_id, emoji) values
  ('ed000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000002', '🔥'),
  ('ed000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001', '😂'),
  ('ed000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000004', '👀');
-- A Jam in their chat that played 10 minutes (10); one that played 2 counts nothing.
-- The heartbeat columns are server-written only; the guard is set aside for the fixture.
set local session_replication_role = replica;
insert into jam_rooms (conversation_id, host_id, status, started_at, last_played_at) values
  ('ec000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001', 'ended',
   '2026-10-10 07:00+00', '2026-10-10 07:10+00'),
  ('ec000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001', 'ended',
   '2026-10-10 08:00+00', '2026-10-10 08:02+00');
set local session_replication_role = origin;
-- Likes and comments on each other's posts (1 each); on your own or a third person's, nothing
insert into post_likes (post_id, user_id) values
  ('eb000000-0000-0000-0000-000000000002', 'e9000000-0000-0000-0000-000000000001'),
  ('eb000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000002'),
  ('eb000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001'),
  ('eb000000-0000-0000-0000-000000000003', 'e9000000-0000-0000-0000-000000000001');
insert into post_comments (post_id, author_id, body) values
  ('eb000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000002', 'great one'),
  ('eb000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001', 'thanks all');
-- The group chat: nothing in it is a vibe
insert into messages (conversation_id, sender_id, kind, body) values
  ('ec000000-0000-0000-0000-000000000003', 'e9000000-0000-0000-0000-000000000001', 'text', 'group hi');
-- Asha + Cara: one message
insert into messages (conversation_id, sender_id, kind, body) values
  ('ec000000-0000-0000-0000-000000000002', 'e9000000-0000-0000-0000-000000000001', 'text', 'yo');

-- ── The vibe ────────────────────────────────────────────────────────────────
select pg_temp.set_user('e9000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert_eq('#1 messages, shared songs, a reaction, a Jam, likes and a comment add up — and the friend''s plays add nothing',
  (select vibe from my_chat_vibes() where conversation_id = 'ec000000-0000-0000-0000-000000000001'),
  1 + 1 + 3 + 3 + 3 + 1 + 10 + 1 + 1 + 1);
select pg_temp.assert_eq('#2 another one-to-one chat has its own vibe (a message + Asha''s like on Cara''s post)',
  (select vibe from my_chat_vibes() where conversation_id = 'ec000000-0000-0000-0000-000000000002'), 1 + 1);
select pg_temp.assert('#3 a group chat has none',
  exists (select 1 from my_chat_vibes() where conversation_id = 'ec000000-0000-0000-0000-000000000003'), false);
reset role;

select pg_temp.set_user('e9000000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert_eq('#4 Ben sees the same vibe as Asha',
  (select vibe from my_chat_vibes() where conversation_id = 'ec000000-0000-0000-0000-000000000001'), 25);
select pg_temp.assert('#5 and nothing of Asha''s other chats',
  exists (select 1 from my_chat_vibes() where conversation_id = 'ec000000-0000-0000-0000-000000000002'), false);
reset role;

select pg_temp.set_user('e9000000-0000-0000-0000-000000000004');
set local role authenticated;
select pg_temp.assert('#6 someone outside the chat sees nothing',
  exists (select 1 from my_chat_vibes()), false);
reset role;

-- Cara blocks Asha: their chat's vibe disappears for both.
insert into blocked_users (blocker_id, blocked_id) values
  ('e9000000-0000-0000-0000-000000000003', 'e9000000-0000-0000-0000-000000000001');
select pg_temp.set_user('e9000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('#7 across a block there is no vibe',
  exists (select 1 from my_chat_vibes() where conversation_id = 'ec000000-0000-0000-0000-000000000002'), false);
reset role;

rollback;
