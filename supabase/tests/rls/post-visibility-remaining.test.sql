-- The last paths around a hidden post (20261113000000, ADR-0028 follow-up).
--
-- THE DEFECTS. A caller holding a friends-only repost's id (sharing a repost in chat hands
-- such ids to non-friends) could, by calling the API directly:
--   1. repost it — posts_insert_own checked only author_id — bumping its reposts_count and
--      unlocking a "reposted your post" push to its owner;
--   2. keep notifying its owner from a leftover like / comment / repost row and read its
--      live like count back (activity_notify_post / activity_notify_comment, DEFINER);
--   3. record plays on it and read back views_count (activity_record_play, DEFINER);
--   4. and every Realtime subscriber was sent (comment_id, user_id) for every comment
--      unlike, because post_comment_likes was published and RLS does not filter DELETEs.
-- Sections 1–4 are those attacks; each must be refused while the honest path beside it
-- still works. Section 5 checks that the three DEFINER functions agree with
-- posts_select_authenticated for every viewer × post × switch value, so a drift between a
-- hand-copied predicate and the policy fails here whichever side moved. Section 6 pins the
-- shape (one INSERT policy, grants, the publication).
--
-- Runs as `authenticated` against the deployed policies and functions. Every refusal is
-- paired with a count of stored rows taken as the superuser.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/post-visibility-remaining.test.sql

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

-- Whether the database allowed a write, as the CURRENT role. An RLS refusal is
-- insufficient_privilege (42501); anything else is a broken fixture and must surface.
create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when insufficient_privilege then return false;
end $$;

-- Rows a set-returning call produced, as the CURRENT role.
create or replace function pg_temp.rows_from(stmt text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from (%s) x', stmt) into n;
  return n;
end $$;

grant usage on schema auth to authenticated;

-- RIYA reposts, friends only. FRIEND is her accepted friend; SAM is a stranger who was sent
-- her repost in chat; BLOCKED is blocked by her; ARTIST uploaded the songs; CAM comments
-- everywhere (section 5's comment author — blocked with nobody, never a viewer).
insert into auth.users (id) values
  ('e1000000-0000-0000-0000-000000000001'),  -- RIYA (reposter)
  ('e1000000-0000-0000-0000-000000000002'),  -- FRIEND
  ('e1000000-0000-0000-0000-000000000003'),  -- SAM (stranger)
  ('e1000000-0000-0000-0000-000000000004'),  -- BLOCKED
  ('e1000000-0000-0000-0000-000000000005'),  -- ARTIST (uploader)
  ('e1000000-0000-0000-0000-000000000006')   -- CAM (commenter)
on conflict do nothing;

insert into profiles (id, username, username_set) values
  ('e1000000-0000-0000-0000-000000000001', 'pv_riya',    true),
  ('e1000000-0000-0000-0000-000000000002', 'pv_friend',  true),
  ('e1000000-0000-0000-0000-000000000003', 'pv_sam',     true),
  ('e1000000-0000-0000-0000-000000000004', 'pv_blocked', true),
  ('e1000000-0000-0000-0000-000000000005', 'pv_artist',  true),
  ('e1000000-0000-0000-0000-000000000006', 'pv_cam',     true)
on conflict do nothing;

-- RIYA: friends only, comments from EVERYONE (so can_comment_on_post's comment bar is not
-- what stops a reply in 3b). FRIEND shows reposts to everyone: section 5's public repost.
update profiles set reposts_public = false, comments_friends_only = false
 where id = 'e1000000-0000-0000-0000-000000000001';
update profiles set reposts_public = true
 where id = 'e1000000-0000-0000-0000-000000000002';

insert into friendships (user_a_id, user_b_id, status, requested_by, accepted_at) values
  ('e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002',
   'accepted', 'e1000000-0000-0000-0000-000000000001', now())
on conflict do nothing;

insert into blocked_users (blocker_id, blocked_id) values
  ('e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000004')
on conflict do nothing;

update app_switches set enabled = true where key = 'spotify_reposts';

insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000005',
   'Monsoon Letters', 'audio', 'https://example.invalid/m.mp3'),
  ('e2000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000005',
   'Night Bus', 'audio', 'https://example.invalid/n.mp3'),
  ('e2000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000003',
   'Sam''s Demo', 'audio', 'https://example.invalid/s.mp3')
on conflict do nothing;

insert into posts (id, author_id, kind, track_id, original_post_id) values
  -- UP: ARTIST's upload (public).
  ('e3000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000005',
   'upload', 'e2000000-0000-0000-0000-000000000001', null),
  -- RP: RIYA's repost of it (friends only).
  ('e3000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001',
   'repost', 'e2000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001'),
  -- RUP: an upload by RIYA (public, but not to BLOCKED).
  ('e3000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001',
   'upload', 'e2000000-0000-0000-0000-000000000002', null),
  -- FRP: FRIEND's repost of UP (FRIEND shows reposts to everyone).
  ('e3000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000002',
   'repost', 'e2000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001')
on conflict do nothing;

-- Leftovers, written as the superuser: what SAM could have made while RP was public (or
-- before these fixes) — a like, a comment and a repost OF THE REPOST — plus BLOCKED's like
-- on RIYA's upload from before the block. FRIEND has a comment on RP that SAM liked and
-- replied to.
insert into post_likes (post_id, user_id) values
  ('e3000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000003'),
  ('e3000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002'),
  ('e3000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000004');
insert into post_comments (id, post_id, author_id, body, parent_comment_id) values
  ('e4000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000002',
   'e1000000-0000-0000-0000-000000000002', 'that bridge at 2:10', null),
  ('e4000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000002',
   'e1000000-0000-0000-0000-000000000003', 'sam was here', null),
  ('e4000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-000000000002',
   'e1000000-0000-0000-0000-000000000003', 'agreed', 'e4000000-0000-0000-0000-000000000001');
insert into post_comment_likes (comment_id, user_id) values
  ('e4000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000003'),
  ('e4000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001');
insert into posts (id, author_id, kind, track_id, original_post_id) values
  ('e3000000-0000-0000-0000-000000000009', 'e1000000-0000-0000-0000-000000000003',
   'repost', 'e2000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000002');

create temp table baseline as
  select (select reposts_count from posts where id = 'e3000000-0000-0000-0000-000000000002') as rp_reposts,
         (select views_count   from posts where id = 'e3000000-0000-0000-0000-000000000002') as rp_views,
         (select count(*) from activity_notifications
           where recipient_id = 'e1000000-0000-0000-0000-000000000001') as riya_notifs,
         (select count(*) from activity_notifications
           where recipient_id = 'e1000000-0000-0000-0000-000000000002') as friend_notifs;
grant select on baseline to authenticated;

-- ── 1. posts_insert_own: an original must be an upload you can see ──────────
select pg_temp.set_user('e1000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert_count('1a  SAM cannot see RIYA''s repost (precondition)',
  (select count(*) from posts where id = 'e3000000-0000-0000-0000-000000000002'), 0);
select pg_temp.assert('1b  SAM cannot repost it',
  pg_temp.allows($q$insert into posts (author_id, kind, track_id, original_post_id) values
    ('e1000000-0000-0000-0000-000000000003', 'repost', 'e2000000-0000-0000-0000-000000000001',
     'e3000000-0000-0000-0000-000000000002')$q$), false);
select pg_temp.assert('1c  …nor a PUBLIC repost (FRIEND''s, which he can see): uploads only',
  pg_temp.allows($q$insert into posts (author_id, kind, track_id, original_post_id) values
    ('e1000000-0000-0000-0000-000000000003', 'repost', 'e2000000-0000-0000-0000-000000000001',
     'e3000000-0000-0000-0000-000000000004')$q$), false);
-- The honest repost, exactly as createRepost sends it (insert … returning). This is what
-- an UNQUALIFIED original_post_id in the policy would break: it would bind to the inner
-- row and refuse every repost.
select pg_temp.assert('1d  SAM reposts ARTIST''s upload (insert … returning, as the app does)',
  pg_temp.allows($q$insert into posts (author_id, kind, track_id, original_post_id, clip_start_sec, clip_end_sec)
    values ('e1000000-0000-0000-0000-000000000003', 'repost', 'e2000000-0000-0000-0000-000000000001',
            'e3000000-0000-0000-0000-000000000001', 0, 30) returning id$q$), true);
select pg_temp.assert('1e  …but not naming the upload while serving another song',
  pg_temp.allows($q$insert into posts (author_id, kind, track_id, original_post_id) values
    ('e1000000-0000-0000-0000-000000000003', 'repost', 'e2000000-0000-0000-0000-000000000002',
     'e3000000-0000-0000-0000-000000000001')$q$), false);
select pg_temp.assert('1f  SAM still uploads his own song (no original)',
  pg_temp.allows($q$insert into posts (author_id, kind, track_id) values
    ('e1000000-0000-0000-0000-000000000003', 'upload', 'e2000000-0000-0000-0000-000000000003')
    returning id$q$), true);
select pg_temp.assert('1g  SAM still reposts from Spotify (no original)',
  pg_temp.allows($q$insert into posts (author_id, kind, track_id, spotify_track_id) values
    ('e1000000-0000-0000-0000-000000000003', 'repost', null, '4uLU6hMCjMI75M1A2tKUQC')
    returning id$q$), true);
select pg_temp.assert('1h  SAM still cannot post as someone else',
  pg_temp.allows($q$insert into posts (author_id, kind, track_id) values
    ('e1000000-0000-0000-0000-000000000005', 'upload', 'e2000000-0000-0000-0000-000000000002')$q$), false);
reset role;

select pg_temp.set_user('e1000000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('1i  FRIEND, who CAN see RIYA''s repost, cannot repost it either',
  pg_temp.allows($q$insert into posts (author_id, kind, track_id, original_post_id) values
    ('e1000000-0000-0000-0000-000000000002', 'repost', 'e2000000-0000-0000-0000-000000000001',
     'e3000000-0000-0000-0000-000000000002')$q$), false);
reset role;

select pg_temp.set_user('e1000000-0000-0000-0000-000000000004');
set local role authenticated;
select pg_temp.assert('1j  BLOCKED cannot repost RIYA''s upload (the block hides it)',
  pg_temp.allows($q$insert into posts (author_id, kind, track_id, original_post_id) values
    ('e1000000-0000-0000-0000-000000000004', 'repost', 'e2000000-0000-0000-0000-000000000002',
     'e3000000-0000-0000-0000-000000000003')$q$), false);
reset role;

select pg_temp.assert_count('1k  RIYA''s repost count did not move',
  (select reposts_count from posts where id = 'e3000000-0000-0000-0000-000000000002'),
  (select rp_reposts from baseline));
select pg_temp.assert_count('1l  …and no refused row was stored (SAM: the leftover + 1d/1f/1g)',
  (select count(*) from posts where author_id = 'e1000000-0000-0000-0000-000000000003'), 4);

-- ── 2. activity_notify_post: hidden is the same as absent ───────────────────
select pg_temp.set_user('e1000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert_count('2a  SAM''s leftover like on the hidden repost notifies nobody, returns nothing',
  pg_temp.rows_from($q$select * from activity_notify_post('e3000000-0000-0000-0000-000000000002', 'like')$q$), 0);
select pg_temp.assert_count('2b  …nor his leftover comment',
  pg_temp.rows_from($q$select * from activity_notify_post('e3000000-0000-0000-0000-000000000002', 'comment',
    null, 'e4000000-0000-0000-0000-000000000002')$q$), 0);
select pg_temp.assert_count('2c  …nor his leftover repost of it',
  pg_temp.rows_from($q$select * from activity_notify_post('e3000000-0000-0000-0000-000000000002', 'repost')$q$), 0);
reset role;
select pg_temp.assert_count('2d  RIYA was told nothing',
  (select count(*) from activity_notifications
    where recipient_id = 'e1000000-0000-0000-0000-000000000001'),
  (select riya_notifs from baseline));

select pg_temp.set_user('e1000000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert_count('2e  FRIEND''s like on it still notifies RIYA',
  pg_temp.rows_from($q$select * from activity_notify_post('e3000000-0000-0000-0000-000000000002', 'like')$q$), 1);
reset role;

select pg_temp.set_user('e1000000-0000-0000-0000-000000000004');
set local role authenticated;
select pg_temp.assert_count('2f  BLOCKED''s like from before the block notifies nobody',
  pg_temp.rows_from($q$select * from activity_notify_post('e3000000-0000-0000-0000-000000000003', 'like')$q$), 0);
reset role;

select pg_temp.set_user('e1000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert_count('2g  SAM''s honest repost of ARTIST''s upload (1d) notifies ARTIST',
  pg_temp.rows_from($q$select * from activity_notify_post('e3000000-0000-0000-0000-000000000001', 'repost')$q$), 1);
reset role;

-- Live: the switch, not the data, decides.
update profiles set reposts_public = true where id = 'e1000000-0000-0000-0000-000000000001';
select pg_temp.set_user('e1000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert_count('2h  RIYA shows reposts to everyone: SAM''s like notifies',
  pg_temp.rows_from($q$select * from activity_notify_post('e3000000-0000-0000-0000-000000000002', 'like')$q$), 1);
reset role;
update profiles set reposts_public = false where id = 'e1000000-0000-0000-0000-000000000001';

-- ── 3. activity_notify_comment: same, one hop further ───────────────────────
select pg_temp.set_user('e1000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert_count('3a  SAM''s leftover like on FRIEND''s comment notifies nobody',
  pg_temp.rows_from($q$select * from activity_notify_comment('e4000000-0000-0000-0000-000000000001', 'comment_like')$q$), 0);
select pg_temp.assert_count('3b  …nor his leftover reply to it',
  pg_temp.rows_from($q$select * from activity_notify_comment('e4000000-0000-0000-0000-000000000003', 'comment_reply')$q$), 0);
reset role;
select pg_temp.assert_count('3c  FRIEND was told nothing',
  (select count(*) from activity_notifications
    where recipient_id = 'e1000000-0000-0000-0000-000000000002'),
  (select friend_notifs from baseline));

select pg_temp.set_user('e1000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert_count('3d  RIYA''s like on FRIEND''s comment still notifies FRIEND',
  pg_temp.rows_from($q$select * from activity_notify_comment('e4000000-0000-0000-0000-000000000001', 'comment_like')$q$), 1);
reset role;

update profiles set reposts_public = true where id = 'e1000000-0000-0000-0000-000000000001';
select pg_temp.set_user('e1000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert_count('3e  switch on: SAM''s comment like notifies',
  pg_temp.rows_from($q$select * from activity_notify_comment('e4000000-0000-0000-0000-000000000001', 'comment_like')$q$), 1);
reset role;
update profiles set reposts_public = false where id = 'e1000000-0000-0000-0000-000000000001';

-- ── 4. activity_record_play ─────────────────────────────────────────────────
select pg_temp.set_user('e1000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert_count('4a  SAM cannot record a play on the hidden repost, and gets no count back',
  pg_temp.rows_from($q$select * from activity_record_play('e3000000-0000-0000-0000-000000000002')$q$), 0);
select pg_temp.assert_count('4b  …nor read one back (post_views_select_own)',
  (select count(*) from post_views where post_id = 'e3000000-0000-0000-0000-000000000002'), 0);
-- Was a foreign-key error, which told "hidden" apart from "does not exist".
select pg_temp.assert_count('4c  an id that names no post: also nothing, and no error',
  pg_temp.rows_from($q$select * from activity_record_play('e3000000-0000-0000-0000-0000000000ff')$q$), 0);
select pg_temp.assert_count('4d  SAM plays ARTIST''s upload: recorded and counted',
  pg_temp.rows_from($q$select * from activity_record_play('e3000000-0000-0000-0000-000000000001')$q$), 1);
select pg_temp.assert_count('4e  …and reads his own play back',
  (select count(*) from post_views where post_id = 'e3000000-0000-0000-0000-000000000001'), 1);
reset role;
select pg_temp.assert_count('4f  the hidden repost''s play count did not move',
  (select views_count from posts where id = 'e3000000-0000-0000-0000-000000000002'),
  (select rp_views from baseline));

select pg_temp.set_user('e1000000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('4g  FRIEND''s play on it is recorded',
  (select views_count from activity_record_play('e3000000-0000-0000-0000-000000000002'))
    = (select rp_views from baseline) + 1, true);
reset role;

select pg_temp.set_user('e1000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert_count('4h  …and RIYA''s own',
  pg_temp.rows_from($q$select * from activity_record_play('e3000000-0000-0000-0000-000000000002')$q$), 1);
reset role;

select pg_temp.set_user('e1000000-0000-0000-0000-000000000004');
set local role authenticated;
select pg_temp.assert_count('4i  BLOCKED cannot record a play on RIYA''s upload',
  pg_temp.rows_from($q$select * from activity_record_play('e3000000-0000-0000-0000-000000000003')$q$), 0);
reset role;

-- ── 5. The three DEFINER functions agree with posts_select_authenticated ─────
-- Every viewer × post × switch value. Each viewer holds a like on every post and on CAM's
-- comment on every post (written as the superuser, so the visibility of the write is not
-- what is tested), so the only thing left to decide each call is visibility:
--   record_play returns a row             ⇔ the viewer can see the post
--   notify_post('like') returns a row     ⇔ the viewer can see it and is not its author
--   notify_comment('comment_like') a row  ⇔ the viewer can see the comment's post
insert into post_likes (post_id, user_id)
  select p.id, v.id from posts p, profiles v
   where p.id::text like 'e3000000-%' and v.id::text like 'e1000000-%'
     and v.id <> 'e1000000-0000-0000-0000-000000000006'
on conflict do nothing;
insert into post_comments (id, post_id, author_id, body)
  select ('e5000000-0000-0000-0000-0000000000' || right(p.id::text, 2))::uuid, p.id,
         'e1000000-0000-0000-0000-000000000006', 'cam was here'
    from posts p where p.id::text like 'e3000000-%';
insert into post_comment_likes (comment_id, user_id)
  select c.id, v.id from post_comments c, profiles v
   where c.id::text like 'e5000000-%' and v.id::text like 'e1000000-%'
     and v.id <> 'e1000000-0000-0000-0000-000000000006'
on conflict do nothing;

create temp table disagreements (fn text, viewer uuid, post_id uuid, public boolean, sees boolean, got boolean);
create temp table checked (n int);
insert into checked values (0);

do $$
declare
  v record;
  p record;
  sw boolean;
  sees boolean;
  played boolean;
  notified boolean;
  c_notified boolean;
begin
  foreach sw in array array[false, true] loop
    update profiles set reposts_public = sw where id = 'e1000000-0000-0000-0000-000000000001';
    for v in select id from profiles where id::text like 'e1000000-%'
               and id <> 'e1000000-0000-0000-0000-000000000006' loop
      perform pg_temp.set_user(v.id);
      for p in select id, author_id from posts where id::text like 'e3000000-%' loop
        set local role authenticated;
        sees       := exists (select 1 from posts where id = p.id);
        played     := exists (select 1 from activity_record_play(p.id));
        notified   := exists (select 1 from activity_notify_post(p.id, 'like'));
        c_notified := exists (select 1 from activity_notify_comment(
                        ('e5000000-0000-0000-0000-0000000000' || right(p.id::text, 2))::uuid, 'comment_like'));
        reset role;
        update checked set n = n + 1;
        if played is distinct from sees then
          insert into disagreements values ('activity_record_play', v.id, p.id, sw, sees, played);
        end if;
        if notified is distinct from (sees and v.id <> p.author_id) then
          insert into disagreements values ('activity_notify_post', v.id, p.id, sw, sees, notified);
        end if;
        if c_notified is distinct from sees then
          insert into disagreements values ('activity_notify_comment', v.id, p.id, sw, sees, c_notified);
        end if;
      end loop;
    end loop;
  end loop;
  update profiles set reposts_public = false where id = 'e1000000-0000-0000-0000-000000000001';
end $$;

-- 5 viewers × 5 posts (the four fixtures and SAM's leftover repost of the repost) × 2.
select pg_temp.assert_count('5a  every viewer × post × switch value was checked',
  (select n from checked), 50);
do $$
declare r record;
begin
  for r in select * from disagreements limit 5 loop
    raise notice 'disagreement: % viewer=% post=% public=% sees=% got=%',
      r.fn, r.viewer, r.post_id, r.public, r.sees, r.got;
  end loop;
end $$;
select pg_temp.assert_count('5b  the three functions agree with posts_select_authenticated everywhere',
  (select count(*) from disagreements), 0);

-- ── 6. Shape ────────────────────────────────────────────────────────────────
select pg_temp.assert_count('6a  one INSERT policy on posts (a second would be OR''d in)',
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'posts' and cmd in ('INSERT', 'ALL')), 1);
select pg_temp.assert('6b  anon cannot call activity_notify_post',
  has_function_privilege('anon', 'public.activity_notify_post(uuid, text, text, uuid)', 'execute'), false);
select pg_temp.assert('6c  anon cannot call activity_notify_comment',
  has_function_privilege('anon', 'public.activity_notify_comment(uuid, text)', 'execute'), false);
select pg_temp.assert('6d  anon cannot call activity_record_play',
  has_function_privilege('anon', 'public.activity_record_play(uuid)', 'execute'), false);
select pg_temp.assert('6e  post_comment_likes is not published to Realtime',
  exists (select 1 from pg_publication_tables
           where pubname = 'supabase_realtime' and schemaname = 'public'
             and tablename = 'post_comment_likes'), false);
select pg_temp.assert('6f  …and keeps the default replica identity',
  (select relreplident from pg_class where oid = 'public.post_comment_likes'::regclass) = 'd', true);
select pg_temp.assert('6g  post_comments IS still published (the comment sheet listens to it)',
  exists (select 1 from pg_publication_tables
           where pubname = 'supabase_realtime' and schemaname = 'public'
             and tablename = 'post_comments'), true);

rollback;
