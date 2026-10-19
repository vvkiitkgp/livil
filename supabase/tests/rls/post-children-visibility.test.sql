-- Likes and comments follow the post's visibility (20261111000000, ADR-0028 follow-up).
--
-- THE DEFECT. posts_select_authenticated hides a friends-only repost from non-friends, but
-- post_comments / post_likes / post_comment_likes read `using (true)`, likes and comment
-- likes were insertable on any post id, and can_comment_on_post (DEFINER) never asked
-- whether the caller could see the post. Sharing a repost in chat hands its id to people
-- who are not the reposter's friends; with the id alone they could read the thread, list
-- the likers, like it and comment on it. Section 1 is that attack; it must be refused.
--
-- Pins: (1) a stranger holding a hidden repost's id reaches none of its children;
-- (2) a friend and the owner keep every honest path, including insert … returning (what
-- the app's comment insert does); (3) uploads are untouched for strangers; (4) the rule
-- is live — the owner's switch turns it on and off with no data change; (5) blocks hide
-- the children of every post, uploads included; (6) can_comment_on_post agrees with the
-- posts read policy for every viewer × post; (7) one policy per command, so nothing is
-- OR'd back in.
--
-- Runs as `authenticated` against the deployed policies. Every denial is paired with a
-- count of stored rows taken as the superuser.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/post-children-visibility.test.sql

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

-- Rows a statement touched, as the CURRENT role (a delete the policies refuse matches 0).
create or replace function pg_temp.rows_affected(stmt text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;

grant usage on schema auth to authenticated;

-- RIYA reposts, friends only. FRIEND is her accepted friend; SAM is a stranger who was
-- sent the repost in chat; BLOCKED is blocked by her; ARTIST uploaded the song.
insert into auth.users (id) values
  ('b6000000-0000-0000-0000-000000000001'),  -- RIYA (reposter)
  ('b6000000-0000-0000-0000-000000000002'),  -- FRIEND
  ('b6000000-0000-0000-0000-000000000003'),  -- SAM (stranger)
  ('b6000000-0000-0000-0000-000000000004'),  -- BLOCKED
  ('b6000000-0000-0000-0000-000000000005')   -- ARTIST (uploader)
on conflict do nothing;

insert into profiles (id, username, username_set) values
  ('b6000000-0000-0000-0000-000000000001', 'pc_riya',    true),
  ('b6000000-0000-0000-0000-000000000002', 'pc_friend',  true),
  ('b6000000-0000-0000-0000-000000000003', 'pc_sam',     true),
  ('b6000000-0000-0000-0000-000000000004', 'pc_blocked', true),
  ('b6000000-0000-0000-0000-000000000005', 'pc_artist',  true)
on conflict do nothing;

-- Friends only, and comments from EVERYONE: the case the old can_comment_on_post let
-- through (comments-friends-only was its only gate).
update profiles set reposts_public = false, comments_friends_only = false
 where id = 'b6000000-0000-0000-0000-000000000001';

insert into friendships (user_a_id, user_b_id, status, requested_by, accepted_at) values
  ('b6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002',
   'accepted', 'b6000000-0000-0000-0000-000000000001', now())
on conflict do nothing;

insert into blocked_users (blocker_id, blocked_id) values
  ('b6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000004')
on conflict do nothing;

insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('b7000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000005',
   'Monsoon Letters', 'audio', 'https://example.invalid/m.mp3')
on conflict do nothing;

insert into posts (id, author_id, kind, track_id, original_post_id) values
  -- ARTIST's upload (public).
  ('b8000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000005',
   'upload', 'b7000000-0000-0000-0000-000000000001', null),
  -- RIYA's repost of it (friends only).
  ('b8000000-0000-0000-0000-000000000002', 'b6000000-0000-0000-0000-000000000001',
   'repost', 'b7000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000001'),
  -- RIYA's own upload (public, but not to BLOCKED).
  ('b8000000-0000-0000-0000-000000000003', 'b6000000-0000-0000-0000-000000000001',
   'upload', 'b7000000-0000-0000-0000-000000000001', null)
on conflict do nothing;

-- Existing activity, written as the superuser: FRIEND liked and commented on the repost,
-- RIYA liked that comment; FRIEND commented on ARTIST's upload and RIYA's upload too.
insert into post_likes (post_id, user_id) values
  ('b8000000-0000-0000-0000-000000000002', 'b6000000-0000-0000-0000-000000000002'),
  ('b8000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002'),
  ('b8000000-0000-0000-0000-000000000003', 'b6000000-0000-0000-0000-000000000002');
insert into post_comments (id, post_id, author_id, body) values
  ('b9000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000002',
   'b6000000-0000-0000-0000-000000000002', 'that bridge at 2:10'),
  ('b9000000-0000-0000-0000-000000000002', 'b8000000-0000-0000-0000-000000000001',
   'b6000000-0000-0000-0000-000000000002', 'on repeat all week'),
  ('b9000000-0000-0000-0000-000000000003', 'b8000000-0000-0000-0000-000000000003',
   'b6000000-0000-0000-0000-000000000002', 'riya''s best one');
insert into post_comment_likes (comment_id, user_id) values
  ('b9000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001');

-- ── 1. SAM holds the friends-only repost's id ───────────────────────────────
select pg_temp.set_user('b6000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert_count('1a  SAM cannot see the repost itself (precondition)',
  (select count(*) from posts where id = 'b8000000-0000-0000-0000-000000000002'), 0);
select pg_temp.assert_count('1b  SAM cannot read its comments',
  (select count(*) from post_comments where post_id = 'b8000000-0000-0000-0000-000000000002'), 0);
select pg_temp.assert_count('1c  …nor fetch a comment by id',
  (select count(*) from post_comments where id = 'b9000000-0000-0000-0000-000000000001'), 0);
select pg_temp.assert_count('1d  SAM cannot list who liked it',
  (select count(*) from post_likes where post_id = 'b8000000-0000-0000-0000-000000000002'), 0);
select pg_temp.assert_count('1e  SAM cannot list who liked a comment on it',
  (select count(*) from post_comment_likes where comment_id = 'b9000000-0000-0000-0000-000000000001'), 0);
select pg_temp.assert('1f  SAM cannot like it',
  pg_temp.allows($q$insert into post_likes (post_id, user_id) values
    ('b8000000-0000-0000-0000-000000000002', 'b6000000-0000-0000-0000-000000000003')$q$), false);
select pg_temp.assert('1g  SAM cannot comment on it, though RIYA takes comments from everyone',
  pg_temp.allows($q$insert into post_comments (post_id, author_id, body) values
    ('b8000000-0000-0000-0000-000000000002', 'b6000000-0000-0000-0000-000000000003', 'nice')$q$), false);
select pg_temp.assert('1h  SAM cannot like a comment on it',
  pg_temp.allows($q$insert into post_comment_likes (comment_id, user_id) values
    ('b9000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000003')$q$), false);
select pg_temp.assert('1i  can_comment_on_post says no',
  public.can_comment_on_post('b8000000-0000-0000-0000-000000000002'), false);
reset role;
select pg_temp.assert_count('1j  …and nothing of SAM''s was stored',
  (select (select count(*) from post_likes where user_id = 'b6000000-0000-0000-0000-000000000003')
        + (select count(*) from post_comments where author_id = 'b6000000-0000-0000-0000-000000000003')
        + (select count(*) from post_comment_likes where user_id = 'b6000000-0000-0000-0000-000000000003')), 0);

-- ── 3. …while ARTIST's upload stays open to SAM ─────────────────────────────
select pg_temp.set_user('b6000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert_count('3a  SAM reads the upload''s comments',
  (select count(*) from post_comments where post_id = 'b8000000-0000-0000-0000-000000000001'), 1);
select pg_temp.assert_count('3b  …and its likers',
  (select count(*) from post_likes where post_id = 'b8000000-0000-0000-0000-000000000001'), 1);
select pg_temp.assert('3c  SAM likes the upload (insert … returning, as the app does)',
  pg_temp.allows($q$insert into post_likes (post_id, user_id) values
    ('b8000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000003') returning post_id$q$), true);
select pg_temp.assert('3d  SAM comments on the upload (insert … returning)',
  pg_temp.allows($q$insert into post_comments (post_id, author_id, body) values
    ('b8000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000003', 'found this via riya')
    returning id$q$), true);
select pg_temp.assert('3e  SAM likes a comment on the upload',
  pg_temp.allows($q$insert into post_comment_likes (comment_id, user_id) values
    ('b9000000-0000-0000-0000-000000000002', 'b6000000-0000-0000-0000-000000000003')$q$), true);
select pg_temp.assert_count('3f  SAM sees his own like (the "liked by me" lookup)',
  (select count(*) from post_likes
    where post_id = 'b8000000-0000-0000-0000-000000000001'
      and user_id = 'b6000000-0000-0000-0000-000000000003'), 1);
select pg_temp.assert_count('3g  SAM unlikes it',
  pg_temp.rows_affected($q$delete from post_likes
    where post_id = 'b8000000-0000-0000-0000-000000000001'
      and user_id = 'b6000000-0000-0000-0000-000000000003'$q$), 1);
reset role;

-- ── 2. FRIEND and RIYA keep every honest path on the repost ─────────────────
select pg_temp.set_user('b6000000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert_count('2a  FRIEND reads the repost''s comments',
  (select count(*) from post_comments where post_id = 'b8000000-0000-0000-0000-000000000002'), 1);
select pg_temp.assert_count('2b  …its likers',
  (select count(*) from post_likes where post_id = 'b8000000-0000-0000-0000-000000000002'), 1);
select pg_temp.assert_count('2c  …and the comment''s likers',
  (select count(*) from post_comment_likes where comment_id = 'b9000000-0000-0000-0000-000000000001'), 1);
select pg_temp.assert('2d  FRIEND comments again (insert … returning)',
  pg_temp.allows($q$insert into post_comments (post_id, author_id, body) values
    ('b8000000-0000-0000-0000-000000000002', 'b6000000-0000-0000-0000-000000000002', 'and the outro')
    returning id$q$), true);
select pg_temp.assert_count('2e  FRIEND unlikes it',
  pg_temp.rows_affected($q$delete from post_likes
    where post_id = 'b8000000-0000-0000-0000-000000000002'
      and user_id = 'b6000000-0000-0000-0000-000000000002'$q$), 1);
select pg_temp.assert('2f  …and likes it again',
  pg_temp.allows($q$insert into post_likes (post_id, user_id) values
    ('b8000000-0000-0000-0000-000000000002', 'b6000000-0000-0000-0000-000000000002')$q$), true);
select pg_temp.assert('2g  FRIEND likes a comment on it',
  pg_temp.allows($q$insert into post_comment_likes (comment_id, user_id) values
    ('b9000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002')$q$), true);
reset role;

select pg_temp.set_user('b6000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert_count('2h  RIYA reads every comment on her repost',
  (select count(*) from post_comments where post_id = 'b8000000-0000-0000-0000-000000000002'), 2);
select pg_temp.assert('2i  RIYA likes her own repost',
  pg_temp.allows($q$insert into post_likes (post_id, user_id) values
    ('b8000000-0000-0000-0000-000000000002', 'b6000000-0000-0000-0000-000000000001')$q$), true);
reset role;

-- ── 4. Live: the switch opens and closes it, no data rewritten ──────────────
update profiles set reposts_public = true where id = 'b6000000-0000-0000-0000-000000000001';
select pg_temp.set_user('b6000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert_count('4a  RIYA shows reposts to everyone: SAM reads the comments',
  (select count(*) from post_comments where post_id = 'b8000000-0000-0000-0000-000000000002'), 2);
select pg_temp.assert('4b  …and may like it',
  pg_temp.allows($q$insert into post_likes (post_id, user_id) values
    ('b8000000-0000-0000-0000-000000000002', 'b6000000-0000-0000-0000-000000000003')$q$), true);
reset role;

update profiles set reposts_public = false where id = 'b6000000-0000-0000-0000-000000000001';
select pg_temp.set_user('b6000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert_count('4c  back to friends only: the thread is hidden again',
  (select count(*) from post_comments where post_id = 'b8000000-0000-0000-0000-000000000002'), 0);
select pg_temp.assert_count('4d  …SAM''s own earlier like included',
  (select count(*) from post_likes where user_id = 'b6000000-0000-0000-0000-000000000003'), 0);
reset role;
select pg_temp.assert_count('4e  …which still exists and still counts (nothing was deleted)',
  (select count(*) from post_likes
    where post_id = 'b8000000-0000-0000-0000-000000000002'
      and user_id = 'b6000000-0000-0000-0000-000000000003'), 1);

-- ── 5. Blocks hide the children of every post, uploads too ──────────────────
select pg_temp.set_user('b6000000-0000-0000-0000-000000000004');
set local role authenticated;
select pg_temp.assert_count('5a  BLOCKED cannot read comments on RIYA''s UPLOAD',
  (select count(*) from post_comments where post_id = 'b8000000-0000-0000-0000-000000000003'), 0);
select pg_temp.assert_count('5b  …nor its likers',
  (select count(*) from post_likes where post_id = 'b8000000-0000-0000-0000-000000000003'), 0);
select pg_temp.assert('5c  …nor like it',
  pg_temp.allows($q$insert into post_likes (post_id, user_id) values
    ('b8000000-0000-0000-0000-000000000003', 'b6000000-0000-0000-0000-000000000004')$q$), false);
select pg_temp.assert_count('5d  …but still reads ARTIST''s upload thread',
  (select count(*) from post_comments where post_id = 'b8000000-0000-0000-0000-000000000001'), 2);
reset role;

-- ── 6. can_comment_on_post agrees with posts_select_authenticated ───────────
-- Every viewer × every post, with comments open to everyone, under both switch values:
-- may comment ⇔ may see. A drift between the hand-copied predicate and the policy fails
-- here, whichever side moved.
update profiles set comments_friends_only = false
 where id in ('b6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000005');
create temp table viewers (uid uuid);
insert into viewers values
  ('b6000000-0000-0000-0000-000000000001'), ('b6000000-0000-0000-0000-000000000002'),
  ('b6000000-0000-0000-0000-000000000003'), ('b6000000-0000-0000-0000-000000000004'),
  ('b6000000-0000-0000-0000-000000000005');
create temp table disagreements (uid uuid, post_id uuid, public boolean);

do $$
declare
  v record;
  p record;
  sw boolean;
  sees boolean;
  may boolean;
begin
  foreach sw in array array[false, true] loop
    update profiles set reposts_public = sw where id = 'b6000000-0000-0000-0000-000000000001';
    for v in select uid from viewers loop
      perform pg_temp.set_user(v.uid);
      for p in select id from posts where id::text like 'b8000000-%' loop
        set local role authenticated;
        sees := exists (select 1 from posts where id = p.id);
        may := public.can_comment_on_post(p.id);
        reset role;
        if sees is distinct from may then
          insert into disagreements values (v.uid, p.id, sw);
        end if;
      end loop;
    end loop;
  end loop;
end $$;
select pg_temp.assert_count('6a  may comment = may see, for 5 viewers × 3 posts × both switch values',
  (select count(*) from disagreements), 0);

-- ── 7. One policy per command ───────────────────────────────────────────────
select pg_temp.assert_count('7a  one SELECT policy each on post_likes, post_comments, post_comment_likes',
  (select count(*) from pg_policies
    where schemaname = 'public' and cmd in ('SELECT', 'ALL')
      and tablename in ('post_likes', 'post_comments', 'post_comment_likes')), 3);
select pg_temp.assert_count('7b  one INSERT policy each on post_likes, post_comments, post_comment_likes',
  (select count(*) from pg_policies
    where schemaname = 'public' and cmd in ('INSERT', 'ALL')
      and tablename in ('post_likes', 'post_comments', 'post_comment_likes')), 3);
select pg_temp.assert('7c  can_comment_on_post is not callable signed out',
  has_function_privilege('anon', 'public.can_comment_on_post(uuid)', 'execute'), false);

rollback;
