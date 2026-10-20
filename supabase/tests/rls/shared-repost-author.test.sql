-- shared_repost_author (20261112000000): whose repost a chat message points at, for a
-- reader who may not see the repost itself.
--
-- RIYA keeps her reposts to friends. MEERA (her friend) sends one to SAM (Meera's friend,
-- not Riya's). Sam's card may say "Riya's repost" — and nothing else about the post.
--
-- Pins: (1) the recipient and the sender get the reposter's id, and the repost itself stays
-- unreadable to the recipient; (2) a non-member gets nothing (7: any member, now or later,
-- gets it — the sender chose that chat); (3) a sender who cannot see
-- the repost cannot use a crafted message to learn who made it; (4) a block between the
-- reader and the reposter returns nothing; (5) deleted messages, uploads and malformed ids
-- return nothing, without an error; (6) not callable signed out.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/shared-repost-author.test.sql

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

create or replace function pg_temp.assert_count(label text, actual bigint, expected bigint)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL  %  (expected %, got %)', label, expected, actual;
  end if;
  raise notice 'ok    %', label;
end $$;

-- SECURITY DEFINER + DISCARD PLANS: auth.uid() is inlined into cached plans, so without
-- the discard later calls still see the FIRST user (search-analytics.test.sql).
create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql security definer as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
  execute 'discard plans';
end $$;

-- The answer for one message, as the given user and the `authenticated` role.
create or replace function pg_temp.author_for(uid uuid, msg uuid)
returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp.set_user(uid);
  set local role authenticated;
  v := public.shared_repost_author(msg);
  reset role;
  return v;
end $$;

grant usage on schema auth to authenticated;

insert into auth.users (id) values
  ('c6000000-0000-0000-0000-000000000001'),  -- RIYA (reposter, friends only)
  ('c6000000-0000-0000-0000-000000000002'),  -- MEERA (Riya's friend; sends it)
  ('c6000000-0000-0000-0000-000000000003'),  -- SAM (Meera's friend, not Riya's)
  ('c6000000-0000-0000-0000-000000000004'),  -- EVE (not in the chat)
  ('c6000000-0000-0000-0000-000000000005'),  -- MALLORY (Sam's friend; cannot see the repost)
  ('c6000000-0000-0000-0000-000000000006'),  -- BLOCKED (Meera's friend; Riya blocked them)
  ('c6000000-0000-0000-0000-000000000007'),  -- ARTIST (uploader)
  ('c6000000-0000-0000-0000-000000000008')   -- TOM (Meera's friend; joins a group later)
on conflict do nothing;

insert into profiles (id, username, username_set) values
  ('c6000000-0000-0000-0000-000000000001', 'sr_riya',    true),
  ('c6000000-0000-0000-0000-000000000002', 'sr_meera',   true),
  ('c6000000-0000-0000-0000-000000000003', 'sr_sam',     true),
  ('c6000000-0000-0000-0000-000000000004', 'sr_eve',     true),
  ('c6000000-0000-0000-0000-000000000005', 'sr_mallory', true),
  ('c6000000-0000-0000-0000-000000000006', 'sr_blocked', true),
  ('c6000000-0000-0000-0000-000000000007', 'sr_artist',  true),
  ('c6000000-0000-0000-0000-000000000008', 'sr_tom',     true)
on conflict do nothing;

update profiles set reposts_public = false where id = 'c6000000-0000-0000-0000-000000000001';

-- Riya–Meera, and each chat's pair (a DM needs a friendship).
insert into friendships (user_a_id, user_b_id, status, requested_by, accepted_at) values
  ('c6000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000002',
   'accepted', 'c6000000-0000-0000-0000-000000000001', now()),
  ('c6000000-0000-0000-0000-000000000002', 'c6000000-0000-0000-0000-000000000003',
   'accepted', 'c6000000-0000-0000-0000-000000000002', now()),
  ('c6000000-0000-0000-0000-000000000003', 'c6000000-0000-0000-0000-000000000005',
   'accepted', 'c6000000-0000-0000-0000-000000000003', now()),
  ('c6000000-0000-0000-0000-000000000002', 'c6000000-0000-0000-0000-000000000006',
   'accepted', 'c6000000-0000-0000-0000-000000000002', now())
on conflict do nothing;

insert into blocked_users (blocker_id, blocked_id) values
  ('c6000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000006')
on conflict do nothing;

insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('c7000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000007',
   'Monsoon Letters', 'audio', 'https://example.invalid/m.mp3')
on conflict do nothing;

insert into posts (id, author_id, kind, track_id, original_post_id, caption) values
  ('c8000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000007',
   'upload', 'c7000000-0000-0000-0000-000000000001', null, null),
  ('c8000000-0000-0000-0000-000000000002', 'c6000000-0000-0000-0000-000000000001',
   'repost', 'c7000000-0000-0000-0000-000000000001', 'c8000000-0000-0000-0000-000000000001',
   'for the rainy drive home')
on conflict do nothing;

-- Chats: Meera+Sam, Mallory+Sam, Meera+Blocked.
insert into conversations (id, kind) values
  ('c9000000-0000-0000-0000-000000000001', 'dm'),
  ('c9000000-0000-0000-0000-000000000002', 'dm'),
  ('c9000000-0000-0000-0000-000000000003', 'dm');
insert into conversation_members (conversation_id, user_id, role) values
  ('c9000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000002', 'member'),
  ('c9000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000003', 'member'),
  ('c9000000-0000-0000-0000-000000000002', 'c6000000-0000-0000-0000-000000000005', 'member'),
  ('c9000000-0000-0000-0000-000000000002', 'c6000000-0000-0000-0000-000000000003', 'member'),
  ('c9000000-0000-0000-0000-000000000003', 'c6000000-0000-0000-0000-000000000002', 'member'),
  ('c9000000-0000-0000-0000-000000000003', 'c6000000-0000-0000-0000-000000000006', 'member');

-- The message shapes repostSharePayload writes.
insert into messages (id, conversation_id, sender_id, kind, body, metadata) values
  -- Meera → Sam: Riya's repost.
  ('ca000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001',
   'c6000000-0000-0000-0000-000000000002', 'track_share', '',
   '{"track_id": "c7000000-0000-0000-0000-000000000001", "post_id": "c8000000-0000-0000-0000-000000000001",
     "title": "Monsoon Letters", "artist_name": "sr_artist", "cover_art_url": null,
     "repost_post_id": "c8000000-0000-0000-0000-000000000002"}'),
  -- Mallory → Sam: the same id, crafted by someone who cannot see it.
  ('ca000000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000002',
   'c6000000-0000-0000-0000-000000000005', 'track_share', '',
   '{"post_id": "c8000000-0000-0000-0000-000000000001",
     "repost_post_id": "c8000000-0000-0000-0000-000000000002"}'),
  -- Meera → Blocked: Riya's repost.
  ('ca000000-0000-0000-0000-000000000003', 'c9000000-0000-0000-0000-000000000003',
   'c6000000-0000-0000-0000-000000000002', 'track_share', '',
   '{"post_id": "c8000000-0000-0000-0000-000000000001",
     "repost_post_id": "c8000000-0000-0000-0000-000000000002"}'),
  -- Meera → Sam: an UPLOAD's id where a repost's belongs.
  ('ca000000-0000-0000-0000-000000000004', 'c9000000-0000-0000-0000-000000000001',
   'c6000000-0000-0000-0000-000000000002', 'track_share', '',
   '{"post_id": "c8000000-0000-0000-0000-000000000001",
     "repost_post_id": "c8000000-0000-0000-0000-000000000001"}'),
  -- Meera → Sam: not an id at all.
  ('ca000000-0000-0000-0000-000000000005', 'c9000000-0000-0000-0000-000000000001',
   'c6000000-0000-0000-0000-000000000002', 'text', 'https://open.spotify.com/track/x',
   '{"repost_post_id": "riya''s repost; drop table posts"}');

-- ── 1. The recipient learns whose it is — and only that ─────────────────────
select pg_temp.assert('1a  SAM gets RIYA for the repost Meera sent him',
  pg_temp.author_for('c6000000-0000-0000-0000-000000000003', 'ca000000-0000-0000-0000-000000000001')
    = 'c6000000-0000-0000-0000-000000000001', true);
select pg_temp.assert('1b  …and so does MEERA, who sent it',
  pg_temp.author_for('c6000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000001')
    = 'c6000000-0000-0000-0000-000000000001', true);
select pg_temp.set_user('c6000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert_count('1c  the repost itself (caption and all) stays hidden from SAM',
  (select count(*) from posts where id = 'c8000000-0000-0000-0000-000000000002'), 0);
reset role;

-- ── 2. Only members of the chat ─────────────────────────────────────────────
select pg_temp.assert('2a  EVE, not in the chat, gets nothing',
  pg_temp.author_for('c6000000-0000-0000-0000-000000000004', 'ca000000-0000-0000-0000-000000000001')
    is null, true);

-- ── 3. No author oracle through a crafted message ───────────────────────────
select pg_temp.assert('3a  MALLORY cannot see the repost, so her message names nobody to SAM',
  pg_temp.author_for('c6000000-0000-0000-0000-000000000003', 'ca000000-0000-0000-0000-000000000002')
    is null, true);
select pg_temp.assert('3b  …nor to MALLORY herself',
  pg_temp.author_for('c6000000-0000-0000-0000-000000000005', 'ca000000-0000-0000-0000-000000000002')
    is null, true);

-- ── 4. Blocks ───────────────────────────────────────────────────────────────
select pg_temp.assert('4a  BLOCKED learns nothing, though Meera may see the repost',
  pg_temp.author_for('c6000000-0000-0000-0000-000000000006', 'ca000000-0000-0000-0000-000000000003')
    is null, true);

-- ── 5. Shapes that name no repost ───────────────────────────────────────────
select pg_temp.assert('5a  an upload''s id is not a repost',
  pg_temp.author_for('c6000000-0000-0000-0000-000000000003', 'ca000000-0000-0000-0000-000000000004')
    is null, true);
select pg_temp.assert('5b  a malformed id answers nothing, without an error',
  pg_temp.author_for('c6000000-0000-0000-0000-000000000003', 'ca000000-0000-0000-0000-000000000005')
    is null, true);
update messages set deleted_at = now() where id = 'ca000000-0000-0000-0000-000000000001';
select pg_temp.assert('5c  a deleted message answers nothing',
  pg_temp.author_for('c6000000-0000-0000-0000-000000000003', 'ca000000-0000-0000-0000-000000000001')
    is null, true);
update messages set deleted_at = null where id = 'ca000000-0000-0000-0000-000000000001';

-- ── 3c. Live: once Meera cannot see it either, nobody learns it through her ──
delete from friendships
 where user_a_id = 'c6000000-0000-0000-0000-000000000001'
   and user_b_id = 'c6000000-0000-0000-0000-000000000002';
select pg_temp.assert('3c  Riya unfriends Meera: Meera''s old message names nobody to SAM',
  pg_temp.author_for('c6000000-0000-0000-0000-000000000003', 'ca000000-0000-0000-0000-000000000001')
    is null, true);

-- ── 7. Audience = whoever can read the message, now or later ───────────────
-- Riya and Meera are friends again; Meera shares into a GROUP with Sam, then adds Tom.
insert into friendships (user_a_id, user_b_id, status, requested_by, accepted_at) values
  ('c6000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000002',
   'accepted', 'c6000000-0000-0000-0000-000000000001', now());
insert into conversations (id, kind) values ('c9000000-0000-0000-0000-000000000004', 'group');
insert into conversation_members (conversation_id, user_id, role) values
  ('c9000000-0000-0000-0000-000000000004', 'c6000000-0000-0000-0000-000000000002', 'admin'),
  ('c9000000-0000-0000-0000-000000000004', 'c6000000-0000-0000-0000-000000000003', 'member');
insert into messages (id, conversation_id, sender_id, kind, body, metadata) values
  ('ca000000-0000-0000-0000-000000000006', 'c9000000-0000-0000-0000-000000000004',
   'c6000000-0000-0000-0000-000000000002', 'track_share', '',
   '{"post_id": "c8000000-0000-0000-0000-000000000001",
     "repost_post_id": "c8000000-0000-0000-0000-000000000002"}');
insert into conversation_members (conversation_id, user_id, role) values
  ('c9000000-0000-0000-0000-000000000004', 'c6000000-0000-0000-0000-000000000008', 'member');
select pg_temp.assert('7a  TOM, added to the group after the share, gets RIYA too',
  pg_temp.author_for('c6000000-0000-0000-0000-000000000008', 'ca000000-0000-0000-0000-000000000006')
    = 'c6000000-0000-0000-0000-000000000001', true);
delete from conversation_members
 where conversation_id = 'c9000000-0000-0000-0000-000000000004'
   and user_id = 'c6000000-0000-0000-0000-000000000002';
select pg_temp.assert('7b  …and it survives MEERA leaving the group',
  pg_temp.author_for('c6000000-0000-0000-0000-000000000003', 'ca000000-0000-0000-0000-000000000006')
    = 'c6000000-0000-0000-0000-000000000001', true);

-- ── 6. Signed out ───────────────────────────────────────────────────────────
select pg_temp.assert('6a  not callable signed out',
  has_function_privilege('anon', 'public.shared_repost_author(uuid)', 'execute'), false);

rollback;
