-- Comment notification tests (20261031000000_comment_notifications.sql).
--
-- "Sam liked your comment" and "Riya replied to your comment". What must hold:
--   * nobody can make one without doing the thing: a like row, their own reply;
--   * a comment's likes count like a post's — recomputed, each liker pushed once, an
--     unlike lowers it, the last unlike hides it, deleting the comment removes it;
--   * a reply reaches the PARENT comment's author, and says when they also own the post;
--   * never to yourself, never between blocked people, never across posts;
--   * activity_list (shipped apps) never returns the new types; activity_list_v2 does.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/comment-notifications.test.sql

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

create or replace function pg_temp.assert_int(label text, actual bigint, expected bigint)
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

-- Whether the database allowed a statement (a 42501 refusal is "no").
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
--   OWNER (…01) — posted the track; wrote comment C1 on it
--   SAM   (…02) — wrote comment C2
--   RIYA  (…03) — likes and replies
--   BLOCK (…04) — wrote comment C3, and has blocked SAM
insert into auth.users (id) values
  ('e1111111-0000-0000-0000-000000000001'),
  ('e1111111-0000-0000-0000-000000000002'),
  ('e1111111-0000-0000-0000-000000000003'),
  ('e1111111-0000-0000-0000-000000000004')
on conflict do nothing;

insert into profiles (id, username, username_set) values
  ('e1111111-0000-0000-0000-000000000001', 'cn_owner', true),
  ('e1111111-0000-0000-0000-000000000002', 'cn_sam',   true),
  ('e1111111-0000-0000-0000-000000000003', 'cn_riya',  true),
  ('e1111111-0000-0000-0000-000000000004', 'cn_block', true)
on conflict do nothing;

insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('e2222222-0000-0000-0000-000000000001', 'e1111111-0000-0000-0000-000000000001',
   'Kesariya', 'audio', 'https://example.invalid/k.mp3'),
  ('e2222222-0000-0000-0000-000000000002', 'e1111111-0000-0000-0000-000000000001',
   'Other', 'audio', 'https://example.invalid/o.mp3')
on conflict do nothing;

insert into posts (id, author_id, kind, track_id) values
  ('e3333333-0000-0000-0000-000000000001', 'e1111111-0000-0000-0000-000000000001',
   'upload', 'e2222222-0000-0000-0000-000000000001'),
  ('e3333333-0000-0000-0000-000000000002', 'e1111111-0000-0000-0000-000000000001',
   'upload', 'e2222222-0000-0000-0000-000000000002')
on conflict do nothing;

insert into post_comments (id, post_id, author_id, body) values
  ('e4444444-0000-0000-0000-000000000001', 'e3333333-0000-0000-0000-000000000001',
   'e1111111-0000-0000-0000-000000000001', 'thanks for listening'),
  ('e4444444-0000-0000-0000-000000000002', 'e3333333-0000-0000-0000-000000000001',
   'e1111111-0000-0000-0000-000000000002', 'this slaps'),
  ('e4444444-0000-0000-0000-000000000003', 'e3333333-0000-0000-0000-000000000001',
   'e1111111-0000-0000-0000-000000000004', 'meh')
on conflict do nothing;

insert into blocked_users (blocker_id, blocked_id) values
  ('e1111111-0000-0000-0000-000000000004', 'e1111111-0000-0000-0000-000000000002')
on conflict do nothing;

-- ── Likes ───────────────────────────────────────────────────────────────────
reset role;
select pg_temp.set_user('e1111111-0000-0000-0000-000000000003');
set role authenticated;

select pg_temp.assert_int('#1 a like notification without a like row is nothing',
  (select count(*) from activity_notify_comment('e4444444-0000-0000-0000-000000000002', 'comment_like')), 0);

insert into post_comment_likes (comment_id, user_id)
values ('e4444444-0000-0000-0000-000000000002', 'e1111111-0000-0000-0000-000000000003');
create temp table l2 as
  select * from activity_notify_comment('e4444444-0000-0000-0000-000000000002', 'comment_like');
select pg_temp.assert('#2 Riya liking Sam''s comment notifies Sam',
  (select recipient_id = 'e1111111-0000-0000-0000-000000000002' from l2), true);
select pg_temp.assert('#2 and pushes', (select recipient_should_push from l2), true);
select pg_temp.assert_int('#2 counting 1', (select agg_count from l2), 1);
select pg_temp.assert('#2 Sam does not own the post', (select recipient_is_post_author from l2), false);

delete from post_comment_likes
 where comment_id = 'e4444444-0000-0000-0000-000000000002' and user_id = 'e1111111-0000-0000-0000-000000000003';
insert into post_comment_likes (comment_id, user_id)
values ('e4444444-0000-0000-0000-000000000002', 'e1111111-0000-0000-0000-000000000003');
create temp table l3 as
  select * from activity_notify_comment('e4444444-0000-0000-0000-000000000002', 'comment_like');
select pg_temp.assert('#3 like → unlike → like does not push again', (select recipient_should_push from l3), false);
select pg_temp.assert_int('#3 and still counts 1', (select agg_count from l3), 1);

-- The owner likes Sam's comment too.
reset role;
select pg_temp.set_user('e1111111-0000-0000-0000-000000000001');
set role authenticated;
insert into post_comment_likes (comment_id, user_id)
values ('e4444444-0000-0000-0000-000000000002', 'e1111111-0000-0000-0000-000000000001');
create temp table l4 as
  select * from activity_notify_comment('e4444444-0000-0000-0000-000000000002', 'comment_like');
select pg_temp.assert('#4 a second liker pushes', (select recipient_should_push from l4), true);
select pg_temp.assert_int('#4 two likers count 2', (select agg_count from l4), 2);

-- Liking your own comment.
insert into post_comment_likes (comment_id, user_id)
values ('e4444444-0000-0000-0000-000000000001', 'e1111111-0000-0000-0000-000000000001');
select pg_temp.assert_int('#5 liking your own comment notifies nobody',
  (select count(*) from activity_notify_comment('e4444444-0000-0000-0000-000000000001', 'comment_like')), 0);

-- Sam (blocked by BLOCK) likes BLOCK's comment.
reset role;
select pg_temp.set_user('e1111111-0000-0000-0000-000000000002');
set role authenticated;
insert into post_comment_likes (comment_id, user_id)
values ('e4444444-0000-0000-0000-000000000003', 'e1111111-0000-0000-0000-000000000002');
select pg_temp.assert_int('#6 nothing between blocked people',
  (select count(*) from activity_notify_comment('e4444444-0000-0000-0000-000000000003', 'comment_like')), 0);

-- ── What each list shows ────────────────────────────────────────────────────
select pg_temp.assert_int('#7 shipped apps never see a comment_like',
  (select count(*) from activity_list(50, null) where type like 'comment_%'), 0);
select pg_temp.assert_int('#7 new apps do',
  (select count(*) from activity_list_v2(50, null) where type = 'comment_like'), 1);
select pg_temp.assert('#7 with the liked comment''s text and id',
  (select payload ->> 'comment_text' = 'this slaps'
      and payload ->> 'comment_id' = 'e4444444-0000-0000-0000-000000000002'
     from activity_list_v2(50, null) where type = 'comment_like'), true);

-- ── Unlikes ─────────────────────────────────────────────────────────────────
reset role;
select pg_temp.set_user('e1111111-0000-0000-0000-000000000003');
set role authenticated;
delete from post_comment_likes
 where comment_id = 'e4444444-0000-0000-0000-000000000002' and user_id = 'e1111111-0000-0000-0000-000000000003';
reset role;
select pg_temp.assert_int('#8 an unlike lowers the count',
  (select agg_count from activity_notifications
    where agg_key = 'comment_like:e4444444-0000-0000-0000-000000000002'), 1);
select pg_temp.assert('#8 and names the remaining liker',
  (select actor_id = 'e1111111-0000-0000-0000-000000000001' from activity_notifications
    where agg_key = 'comment_like:e4444444-0000-0000-0000-000000000002'), true);

select pg_temp.set_user('e1111111-0000-0000-0000-000000000001');
set role authenticated;
delete from post_comment_likes
 where comment_id = 'e4444444-0000-0000-0000-000000000002' and user_id = 'e1111111-0000-0000-0000-000000000001';
reset role;
select pg_temp.set_user('e1111111-0000-0000-0000-000000000002');
set role authenticated;
select pg_temp.assert_int('#9 the last unlike hides it',
  (select count(*) from activity_list_v2(50, null) where type = 'comment_like'), 0);
select pg_temp.assert_int('#9 and it is not unread', (select activity_unread_count()), 0);

-- ── Replies ─────────────────────────────────────────────────────────────────
reset role;
insert into post_comments (id, post_id, author_id, body, parent_comment_id) values
  -- Riya replies to Sam
  ('e5555555-0000-0000-0000-000000000001', 'e3333333-0000-0000-0000-000000000001',
   'e1111111-0000-0000-0000-000000000003', 'haha true', 'e4444444-0000-0000-0000-000000000002'),
  -- Riya replies to the OWNER's own comment on the owner's post
  ('e5555555-0000-0000-0000-000000000002', 'e3333333-0000-0000-0000-000000000001',
   'e1111111-0000-0000-0000-000000000003', 'anytime', 'e4444444-0000-0000-0000-000000000001'),
  -- Sam replies to his own comment
  ('e5555555-0000-0000-0000-000000000003', 'e3333333-0000-0000-0000-000000000001',
   'e1111111-0000-0000-0000-000000000002', 'also this', 'e4444444-0000-0000-0000-000000000002'),
  -- Riya's "reply" on ANOTHER post, pointing at Sam's comment
  ('e5555555-0000-0000-0000-000000000004', 'e3333333-0000-0000-0000-000000000002',
   'e1111111-0000-0000-0000-000000000003', 'sneaky', 'e4444444-0000-0000-0000-000000000002'),
  -- Sam replies to BLOCK's comment
  ('e5555555-0000-0000-0000-000000000005', 'e3333333-0000-0000-0000-000000000001',
   'e1111111-0000-0000-0000-000000000002', 'whatever', 'e4444444-0000-0000-0000-000000000003');

select pg_temp.set_user('e1111111-0000-0000-0000-000000000003');
set role authenticated;
create temp table r10 as
  select * from activity_notify_comment('e5555555-0000-0000-0000-000000000001', 'comment_reply');
select pg_temp.assert('#10 Riya''s reply notifies Sam, the parent''s author',
  (select recipient_id = 'e1111111-0000-0000-0000-000000000002' from r10), true);
select pg_temp.assert('#10 and pushes', (select recipient_should_push from r10), true);
select pg_temp.assert('#10 Sam does not own the post', (select recipient_is_post_author from r10), false);

create temp table r11 as
  select * from activity_notify_comment('e5555555-0000-0000-0000-000000000002', 'comment_reply');
select pg_temp.assert('#11 a reply to the post author''s own comment says so',
  (select recipient_is_post_author from r11), true);

select pg_temp.assert_int('#12 a reply that names another post''s comment as parent is nothing',
  (select count(*) from activity_notify_comment('e5555555-0000-0000-0000-000000000004', 'comment_reply')), 0);

-- Someone else's reply, claimed by Riya.
select pg_temp.assert_int('#13 notifying about someone else''s reply is nothing',
  (select count(*) from activity_notify_comment('e5555555-0000-0000-0000-000000000003', 'comment_reply')), 0);

-- A top-level comment is not a reply.
reset role;
select pg_temp.set_user('e1111111-0000-0000-0000-000000000002');
set role authenticated;
select pg_temp.assert_int('#14 a comment that is not a reply is nothing',
  (select count(*) from activity_notify_comment('e4444444-0000-0000-0000-000000000002', 'comment_reply')), 0);
select pg_temp.assert_int('#15 replying to yourself notifies nobody',
  (select count(*) from activity_notify_comment('e5555555-0000-0000-0000-000000000003', 'comment_reply')), 0);
select pg_temp.assert_int('#16 no reply notification between blocked people',
  (select count(*) from activity_notify_comment('e5555555-0000-0000-0000-000000000005', 'comment_reply')), 0);
select pg_temp.assert_int('#17 an unknown type is nothing',
  (select count(*) from activity_notify_comment('e4444444-0000-0000-0000-000000000002', 'comment')), 0);

-- The post's OWNER, on a shipped app, keeps the "commented on your post" the new app
-- replaced with a reply notification (#11's reply to the owner's own comment).
reset role;
select pg_temp.set_user('e1111111-0000-0000-0000-000000000001');
set role authenticated;
select pg_temp.assert('#17b the owner''s shipped app lists that reply as the comment it replaces',
  (select type = 'comment' and payload ->> 'comment_text' = 'anytime'
      and payload ->> 'comment_id' = 'e5555555-0000-0000-0000-000000000002'
     from activity_list(50, null) where id = (select notification_id from r11)), true);
select pg_temp.assert('#17b while the new app lists it as a reply',
  (select type = 'comment_reply' from activity_list_v2(50, null)
    where id = (select notification_id from r11)), true);

reset role;
select pg_temp.set_user('e1111111-0000-0000-0000-000000000002');
set role authenticated;
select pg_temp.assert('#18 Sam sees the reply, with its text, in the new list',
  (select payload ->> 'comment_text' = 'haha true'
      and payload ->> 'comment_id' = 'e5555555-0000-0000-0000-000000000001'
     from activity_list_v2(50, null) where type = 'comment_reply'), true);
select pg_temp.assert_int('#18 and not in the shipped one (Sam does not own the post)',
  (select count(*) from activity_list(50, null) where type in ('comment', 'comment_reply')), 0);

-- ── Abuse (security review, 2026-10-17) ──────────────────────────────────────
-- One reply, announced again: nothing new.
reset role;
select pg_temp.set_user('e1111111-0000-0000-0000-000000000003');
set role authenticated;
select pg_temp.assert_int('#20 a reply notifies once — calling again writes nothing',
  (select count(*) from activity_notify_comment('e5555555-0000-0000-0000-000000000001', 'comment_reply')), 0);
reset role;
select pg_temp.assert_int('#20 still one row for that reply',
  (select count(*) from activity_notifications
    where agg_key = 'comment_reply:e5555555-0000-0000-0000-000000000001'), 1);

-- Moving a comment under someone else's, to announce it to them.
select pg_temp.set_user('e1111111-0000-0000-0000-000000000003');
set role authenticated;
select pg_temp.assert('#21 a comment cannot be moved to another thread',
  pg_temp.allows($$
    update post_comments set parent_comment_id = 'e4444444-0000-0000-0000-000000000003'
     where id = 'e5555555-0000-0000-0000-000000000001'$$), false);
select pg_temp.assert('#21 nor out of one',
  pg_temp.allows($$
    update post_comments set parent_comment_id = null
     where id = 'e5555555-0000-0000-0000-000000000001'$$), false);
reset role;
select pg_temp.assert('#21 it stayed where it was posted',
  (select parent_comment_id = 'e4444444-0000-0000-0000-000000000002'
     from post_comments where id = 'e5555555-0000-0000-0000-000000000001'), true);

-- A blocked person liking a comment is never counted or named. BLOCK (…04) has blocked SAM.
select pg_temp.set_user('e1111111-0000-0000-0000-000000000003');
set role authenticated;
insert into post_comment_likes (comment_id, user_id)
values ('e4444444-0000-0000-0000-000000000003', 'e1111111-0000-0000-0000-000000000003');
create temp table b22 as
  select * from activity_notify_comment('e4444444-0000-0000-0000-000000000003', 'comment_like');
select pg_temp.assert_int('#22 Riya''s like on BLOCK''s comment counts 1, not Sam''s too',
  (select agg_count from b22), 1);
-- Riya unlikes: the like that is left is Sam's, whom BLOCK blocked.
delete from post_comment_likes
 where comment_id = 'e4444444-0000-0000-0000-000000000003' and user_id = 'e1111111-0000-0000-0000-000000000003';
reset role;
select pg_temp.assert('#22 an unlike never re-names the row after a blocked liker',
  (select actor_id is distinct from 'e1111111-0000-0000-0000-000000000002' and agg_count = 0
     from activity_notifications
    where agg_key = 'comment_like:e4444444-0000-0000-0000-000000000003'), true);

-- Anything from someone BLOCK is blocked with stays out of BLOCK's new list.
insert into activity_notifications (recipient_id, type, actor_id)
values ('e1111111-0000-0000-0000-000000000004', 'new_fan', 'e1111111-0000-0000-0000-000000000002');
select pg_temp.set_user('e1111111-0000-0000-0000-000000000004');
set role authenticated;
select pg_temp.assert_int('#23 activity_list_v2 leaves out a blocked actor''s row',
  (select count(*) from activity_list_v2(50, null) where actor_id = 'e1111111-0000-0000-0000-000000000002'), 0);
-- …except a credit: it is the only place to decline it, and it names BLOCK on Sam's track.
reset role;
insert into activity_notifications (recipient_id, type, actor_id, post_id, payload)
values ('e1111111-0000-0000-0000-000000000004', 'credited', 'e1111111-0000-0000-0000-000000000002',
        'e3333333-0000-0000-0000-000000000001', '{"role":"Mixing"}');
select pg_temp.set_user('e1111111-0000-0000-0000-000000000004');
set role authenticated;
select pg_temp.assert_int('#23 a credit from someone you blocked is still there to decline',
  (select count(*) from activity_list_v2(50, null) where type = 'credited'), 1);

-- The post author's bar holds for a reply written before it. OWNER turns on
-- "comments from friends only"; Sam is not a friend, and his reply is from before.
reset role;
update profiles set comments_friends_only = true where id = 'e1111111-0000-0000-0000-000000000001';
insert into post_comments (id, post_id, author_id, body, parent_comment_id) values
  ('e5555555-0000-0000-0000-000000000006', 'e3333333-0000-0000-0000-000000000001',
   'e1111111-0000-0000-0000-000000000002', 'still here', 'e4444444-0000-0000-0000-000000000001');
select pg_temp.set_user('e1111111-0000-0000-0000-000000000002');
set role authenticated;
select pg_temp.assert_int('#24 no reply notification from someone the post author has barred',
  (select count(*) from activity_notify_comment('e5555555-0000-0000-0000-000000000006', 'comment_reply')), 0);
reset role;
update profiles set comments_friends_only = false where id = 'e1111111-0000-0000-0000-000000000001';

-- ── A deleted comment takes its likes notification with it ──────────────────
reset role;
select pg_temp.set_user('e1111111-0000-0000-0000-000000000003');
set role authenticated;
insert into post_comment_likes (comment_id, user_id)
values ('e4444444-0000-0000-0000-000000000002', 'e1111111-0000-0000-0000-000000000003');
select count(*) from activity_notify_comment('e4444444-0000-0000-0000-000000000002', 'comment_like');
reset role;
select pg_temp.assert_int('#19 (setup) the like notification exists',
  (select count(*) from activity_notifications
    where agg_key = 'comment_like:e4444444-0000-0000-0000-000000000002'), 1);
delete from post_comments where id = 'e4444444-0000-0000-0000-000000000002';
select pg_temp.assert_int('#19 deleting the comment deletes it',
  (select count(*) from activity_notifications
    where agg_key = 'comment_like:e4444444-0000-0000-0000-000000000002'), 0);

reset role;
rollback;
