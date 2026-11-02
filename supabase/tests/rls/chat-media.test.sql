-- Disappearing photos and videos in chat (20261118000000_chat_media.sql, PROP-0011), with the
-- 20-minute lifetime of 20261118000002.
--
--   * only a member who may write in the chat can upload into its folder, and only a
--     well-formed `<conversation_id>/<uuid>.<ext>` path;
--   * clients get no read, update or delete on the private bucket;
--   * "Saved to phone": a member other than the sender records their own save, only while
--     the file exists (20 min + 1 min grace); nobody records a save for someone else;
--     everyone in the chat sees saves, nobody outside does;
--   * the sweep lists only objects older than 20 minutes, and only the service role may ask;
--   * the inbox shows "📷 Sent a photo" / "🎬 Sent a video" for the upgrade lines.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/chat-media.test.sql

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
--   ANU (…01) sends; BEN (…02) is in the group with her; CAL (…03) is outside it.
--   DEV (…04) and ANU share a DM, but DEV has blocked ANU.
insert into auth.users (id) values
  ('c1000000-0000-0000-0000-000000000001'), ('c1000000-0000-0000-0000-000000000002'),
  ('c1000000-0000-0000-0000-000000000003'), ('c1000000-0000-0000-0000-000000000004')
on conflict do nothing;
insert into profiles (id, username, username_set) values
  ('c1000000-0000-0000-0000-000000000001', 'cm_anu', true),
  ('c1000000-0000-0000-0000-000000000002', 'cm_ben', true),
  ('c1000000-0000-0000-0000-000000000003', 'cm_cal', true),
  ('c1000000-0000-0000-0000-000000000004', 'cm_dev', true)
on conflict do nothing;
insert into conversations (id, kind) values
  ('c2000000-0000-0000-0000-000000000001', 'group'),
  ('c2000000-0000-0000-0000-000000000002', 'dm');
insert into conversation_members (conversation_id, user_id, role) values
  ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'member'),
  ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'member'),
  ('c2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'member'),
  ('c2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000004', 'member');
insert into blocked_users (blocker_id, blocked_id) values
  ('c1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000001');

-- A photo sent just now, and one sent 22 minutes ago. created_at is stamped by the server
-- (trg_messages_stamp_created_at), so the old one is written with that trigger off.
insert into messages (id, conversation_id, sender_id, kind, body, metadata) values
  ('c3000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000001', 'text', '📷 Photo · Update Livil to view',
   '{"media": {"v": 1, "type": "photo", "object": "c2000000-0000-0000-0000-000000000001/a0000000-0000-0000-0000-000000000001.jpg"}}'),
  ('c3000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000001', 'text', 'just words', null);
alter table messages disable trigger trg_messages_stamp_created_at;
insert into messages (id, conversation_id, sender_id, kind, body, metadata, created_at) values
  ('c3000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000001', 'text', '🎬 Video · Update Livil to view',
   '{"media": {"v": 1, "type": "video", "object": "c2000000-0000-0000-0000-000000000001/a0000000-0000-0000-0000-000000000002.mp4"}}',
   now() - interval '22 minutes');
alter table messages enable trigger trg_messages_stamp_created_at;

-- ── Uploads ─────────────────────────────────────────────────────────────────
select pg_temp.set_user('c1000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('#1 a member can upload into the chat''s folder',
  public.chat_media_can_upload('c2000000-0000-0000-0000-000000000001/a0000000-0000-0000-0000-00000000000a.jpg'), true);
select pg_temp.assert('#2 a video too',
  public.chat_media_can_upload('c2000000-0000-0000-0000-000000000001/a0000000-0000-0000-0000-00000000000b.mp4'), true);
select pg_temp.assert('#3 not a path outside the <conversation>/<uuid>.<ext> shape',
  public.chat_media_can_upload('c2000000-0000-0000-0000-000000000001/../x.jpg'), false);
select pg_temp.assert('#4 not another file type',
  public.chat_media_can_upload('c2000000-0000-0000-0000-000000000001/a0000000-0000-0000-0000-00000000000c.png'), false);
select pg_temp.assert('#5 not into a DM where the other person blocked you',
  public.chat_media_can_upload('c2000000-0000-0000-0000-000000000002/a0000000-0000-0000-0000-00000000000d.jpg'), false);
reset role;

select pg_temp.set_user('c1000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert('#6 someone outside the chat cannot upload into it',
  public.chat_media_can_upload('c2000000-0000-0000-0000-000000000001/a0000000-0000-0000-0000-00000000000e.jpg'), false);
reset role;

select pg_temp.assert('#7 the bucket is private',
  (select not public from storage.buckets where id = 'chat-media'), true);
select pg_temp.assert('#8 clients get no read, update or delete policy on it',
  not exists (select 1 from pg_policies
               where schemaname = 'storage' and tablename = 'objects'
                 and policyname like 'chat\_media\_%' and cmd <> 'INSERT'), true);

-- ── Saves ───────────────────────────────────────────────────────────────────
select pg_temp.set_user('c1000000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('#9 a member saves a photo while it exists', pg_temp.allows($$
  insert into chat_media_saves (message_id, user_id)
  values ('c3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002')$$), true);
select pg_temp.assert('#10 but not after the 20 minutes (+1 grace)', pg_temp.allows($$
  insert into chat_media_saves (message_id, user_id)
  values ('c3000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002')$$), false);
select pg_temp.assert('#11 nor a message that carries no media', pg_temp.allows($$
  insert into chat_media_saves (message_id, user_id)
  values ('c3000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000002')$$), false);
select pg_temp.assert('#12 nor a save in someone else''s name', pg_temp.allows($$
  insert into chat_media_saves (message_id, user_id)
  values ('c3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001')$$), false);
reset role;

select pg_temp.set_user('c1000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('#13 the sender does not "save" their own photo', pg_temp.allows($$
  insert into chat_media_saves (message_id, user_id)
  values ('c3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001')$$), false);
select pg_temp.assert('#14 the sender sees who saved it',
  (select count(*) = 1 from chat_media_saves where message_id = 'c3000000-0000-0000-0000-000000000001'), true);
-- Refused (no grant) or filtered (no policy) — either way the row must survive.
select pg_temp.allows($$delete from chat_media_saves where message_id = 'c3000000-0000-0000-0000-000000000001'$$);
select pg_temp.assert('#15 a save cannot be taken back',
  (select count(*) = 1 from chat_media_saves where message_id = 'c3000000-0000-0000-0000-000000000001'), true);
reset role;

select pg_temp.set_user('c1000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert('#16 someone outside the chat cannot see saves',
  (select count(*) = 0 from chat_media_saves), true);
select pg_temp.assert('#17 nor save', pg_temp.allows($$
  insert into chat_media_saves (message_id, user_id)
  values ('c3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000003')$$), false);
reset role;

-- ── The sweep ───────────────────────────────────────────────────────────────
insert into storage.objects (bucket_id, name, created_at) values
  ('chat-media', 'c2000000-0000-0000-0000-000000000001/a0000000-0000-0000-0000-000000000001.jpg', now() - interval '1 minute'),
  ('chat-media', 'c2000000-0000-0000-0000-000000000001/a0000000-0000-0000-0000-000000000003.jpg', now() - interval '7 minutes'),
  ('chat-media', 'c2000000-0000-0000-0000-000000000001/a0000000-0000-0000-0000-000000000002.mp4', now() - interval '22 minutes'),
  ('avatars',    'c1000000-0000-0000-0000-000000000001/old.jpg', now() - interval '7 days');
-- The 7-minute-old file stays: under the 20-minute lifetime (it would have gone at 5).
select pg_temp.assert('#18 the sweep lists only chat-media objects older than 20 minutes',
  (select array_agg(n) = array['c2000000-0000-0000-0000-000000000001/a0000000-0000-0000-0000-000000000002.mp4']
     from public.chat_media_expired_objects(100) n), true);

-- Asked of `anon`: the CI harness blanket-grants EXECUTE to `authenticated` after the
-- replay (ci.yml), which would undo the migration's revoke for that role here only.
select pg_temp.assert('#19 clients cannot list what the sweep sees',
  has_function_privilege('anon', 'public.chat_media_expired_objects(integer)', 'execute'), false);
select pg_temp.assert('#20 nor start the sweep',
  has_function_privilege('anon', 'public.chat_media_sweep_dispatch()', 'execute'), false);

delete from net.stub_requests;
select public.chat_media_sweep_dispatch();
select pg_temp.assert('#21 with something expired, the sweep calls the function once',
  (select count(*) = 1 and bool_and(body->>'action' = 'sweep' and url like '%/functions/v1/chat-media')
     from net.stub_requests), true);
delete from storage.objects where bucket_id = 'chat-media' and created_at < now() - interval '20 minutes';
delete from net.stub_requests;
select public.chat_media_sweep_dispatch();
select pg_temp.assert('#22 with nothing expired, it calls nothing',
  (select count(*) = 0 from net.stub_requests), true);

-- ── Inbox preview ───────────────────────────────────────────────────────────
select pg_temp.assert('#23 the photo line reads "📷 Sent a photo" in the inbox',
  public.message_preview('text', '📷 Photo · Update Livil to view') = '📷 Sent a photo', true);
select pg_temp.assert('#24 the video line reads "🎬 Sent a video"',
  public.message_preview('text', '🎬 Video · Update Livil to view') = '🎬 Sent a video', true);
select pg_temp.assert('#25 the same words inside a sentence stay as typed',
  public.message_preview('text', 'my 📷 Photo · Update Livil to view lol') = 'my 📷 Photo · Update Livil to view lol', true);

rollback;
