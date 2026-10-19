-- Mention tests (20261109000000_mentions.sql).
--
-- "Sam tagged you in a post" / "Sam mentioned you in a comment". What must hold:
--   * the tags are read from the STORED caption / comment, and only its author can announce
--     them;
--   * a tag is the app's rule: no email, no self, no unknown name, at most five;
--   * never across a block, never to someone who cannot see the post (a friends-only
--     repost does not reach a stranger), never twice;
--   * a comment does not re-tell the post's author or the replied-to comment's author;
--   * activity_list (shipped apps) never returns the type; activity_list_v2 does;
--   * a deleted comment takes its mentions with it.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/mentions.test.sql

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
returns void language plpgsql security definer as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
  execute 'discard plans';
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
--   SAM (…01) tags people. RIYA (…02) is Sam's friend. TOM (…03) is a stranger.
--   BLK (…04) has blocked Sam. OWN (…05) owns the post Sam comments on.
--   K6…K9 (…06–…09) fill the five-person limit.
insert into auth.users (id) values
  ('a7000000-0000-0000-0000-000000000001'), ('a7000000-0000-0000-0000-000000000002'),
  ('a7000000-0000-0000-0000-000000000003'), ('a7000000-0000-0000-0000-000000000004'),
  ('a7000000-0000-0000-0000-000000000005'), ('a7000000-0000-0000-0000-000000000006'),
  ('a7000000-0000-0000-0000-000000000007'), ('a7000000-0000-0000-0000-000000000008'),
  ('a7000000-0000-0000-0000-000000000009')
on conflict do nothing;

insert into profiles (id, username, username_set) values
  ('a7000000-0000-0000-0000-000000000001', 'mn_sam',  true),
  ('a7000000-0000-0000-0000-000000000002', 'mn_riya', true),
  ('a7000000-0000-0000-0000-000000000003', 'mn_tom',  true),
  ('a7000000-0000-0000-0000-000000000004', 'mn_blk',  true),
  ('a7000000-0000-0000-0000-000000000005', 'mn_own',  true),
  ('a7000000-0000-0000-0000-000000000006', 'mn_k6',   true),
  ('a7000000-0000-0000-0000-000000000007', 'mn_k7',   true),
  ('a7000000-0000-0000-0000-000000000008', 'mn_k8',   true),
  ('a7000000-0000-0000-0000-000000000009', 'mn_k9',   true)
on conflict do nothing;

insert into friendships (user_a_id, user_b_id, status, requested_by) values
  ('a7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000002', 'accepted',
   'a7000000-0000-0000-0000-000000000001');
insert into blocked_users (blocker_id, blocked_id) values
  ('a7000000-0000-0000-0000-000000000004', 'a7000000-0000-0000-0000-000000000001');
-- Sam shows reposts to friends only.
update profiles set reposts_public = false where id = 'a7000000-0000-0000-0000-000000000001';

insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('a7100000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000001', 'Sam song', 'audio', 'https://example.invalid/s.mp3'),
  ('a7100000-0000-0000-0000-000000000005', 'a7000000-0000-0000-0000-000000000005', 'Own song', 'audio', 'https://example.invalid/o.mp3');

insert into posts (id, author_id, kind, track_id, original_post_id, caption) values
  -- P1: Sam's upload. Riya, Tom (mixed case), an email, Sam himself, an unknown name, BLK.
  ('a7200000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000001', 'upload',
   'a7100000-0000-0000-0000-000000000001', null,
   'for @mn_riya and @MN_TOM, mail sam@mn_k6.com, me @mn_sam, @nobody_here, @mn_blk'),
  -- OWN's upload, which Sam reposts (P2) and comments on.
  ('a7200000-0000-0000-0000-000000000005', 'a7000000-0000-0000-0000-000000000005', 'upload',
   'a7100000-0000-0000-0000-000000000005', null, null),
  -- P2: Sam's repost (friends-only): Riya can see it, Tom cannot.
  ('a7200000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-000000000001', 'repost',
   'a7100000-0000-0000-0000-000000000005', 'a7200000-0000-0000-0000-000000000005',
   'listen @mn_riya @mn_tom'),
  -- P3: seven people tagged; only the first five are told.
  ('a7200000-0000-0000-0000-000000000003', 'a7000000-0000-0000-0000-000000000001', 'upload',
   'a7100000-0000-0000-0000-000000000001', null,
   '@mn_k9 @mn_k8 @mn_k7 @mn_k6 @mn_own @mn_riya @mn_tom');

insert into post_comments (id, post_id, author_id, body, parent_comment_id) values
  -- Riya's comment on OWN's post, which Sam then replies to (C2).
  ('a7300000-0000-0000-0000-000000000000', 'a7200000-0000-0000-0000-000000000005',
   'a7000000-0000-0000-0000-000000000002', 'great', null),
  -- C1: Sam tags OWN (the post's author) and Riya.
  ('a7300000-0000-0000-0000-000000000001', 'a7200000-0000-0000-0000-000000000005',
   'a7000000-0000-0000-0000-000000000001', '@mn_own @mn_riya hear this', null),
  -- C2: Sam replies to Riya, tagging Riya and Tom.
  ('a7300000-0000-0000-0000-000000000002', 'a7200000-0000-0000-0000-000000000005',
   'a7000000-0000-0000-0000-000000000001', '@mn_riya @mn_tom agreed',
   'a7300000-0000-0000-0000-000000000000');

-- ── The tag rule ────────────────────────────────────────────────────────────
select pg_temp.assert('#0 tags: distinct, lower-cased, in order; no email; ≤ 5',
  mentioned_usernames('@Riya hi @sam @riya mail a@b.com @a1 @b2 @c3 @d4') = array['riya','sam','a1','b2','c3'], true);
select pg_temp.assert('#0b a 1-letter or 31-letter name is not a tag',
  cardinality(mentioned_usernames('@a and @' || repeat('x', 31))) = 0, true);

-- ── A caption ───────────────────────────────────────────────────────────────
select pg_temp.set_user('a7000000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('#1 only the author can announce a caption''s tags',
  (select count(*) = 0 from activity_notify_mentions('a7200000-0000-0000-0000-000000000001', null)), true);
reset role;

select pg_temp.set_user('a7000000-0000-0000-0000-000000000001');
set local role authenticated;
create temp table r1 as select * from activity_notify_mentions('a7200000-0000-0000-0000-000000000001', null);
select pg_temp.assert('#2 Riya and Tom are told; not the email, Sam, an unknown name or a blocker',
  (select array_agg(recipient_id order by recipient_id) from r1)
    = array['a7000000-0000-0000-0000-000000000002','a7000000-0000-0000-0000-000000000003']::uuid[], true);
select pg_temp.assert('#2b the push names the actor',
  (select bool_and(actor_display_name = '@mn_sam') from r1), true);
select pg_temp.assert('#3 never twice',
  (select count(*) = 0 from activity_notify_mentions('a7200000-0000-0000-0000-000000000001', null)), true);
select pg_temp.assert('#4 a friends-only repost reaches the friend, not the stranger',
  (select array_agg(recipient_id) from activity_notify_mentions('a7200000-0000-0000-0000-000000000002', null))
    = array['a7000000-0000-0000-0000-000000000002']::uuid[], true);
select pg_temp.assert('#5 at most five people, the first five tagged',
  (select array_agg(recipient_id order by recipient_id) from activity_notify_mentions('a7200000-0000-0000-0000-000000000003', null))
    = array['a7000000-0000-0000-0000-000000000005','a7000000-0000-0000-0000-000000000006',
            'a7000000-0000-0000-0000-000000000007','a7000000-0000-0000-0000-000000000008',
            'a7000000-0000-0000-0000-000000000009']::uuid[], true);
select pg_temp.assert('#6 exactly one of post or comment',
  (select count(*) = 0 from activity_notify_mentions(null, null))
  and (select count(*) = 0 from activity_notify_mentions('a7200000-0000-0000-0000-000000000001',
                                                         'a7300000-0000-0000-0000-000000000001')), true);

-- ── Comments ────────────────────────────────────────────────────────────────
select pg_temp.assert('#7 a comment tells Riya, not the post''s author (told already)',
  (select array_agg(recipient_id) from activity_notify_mentions(null, 'a7300000-0000-0000-0000-000000000001'))
    = array['a7000000-0000-0000-0000-000000000002']::uuid[], true);
select pg_temp.assert('#8 a reply tells Tom, not Riya whose comment it answers (told already)',
  (select array_agg(recipient_id) from activity_notify_mentions(null, 'a7300000-0000-0000-0000-000000000002'))
    = array['a7000000-0000-0000-0000-000000000003']::uuid[], true);
reset role;

select pg_temp.set_user('a7000000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('#9 only the comment''s author can announce its tags',
  (select count(*) = 0 from activity_notify_mentions(null, 'a7300000-0000-0000-0000-000000000002')), true);

-- ── The lists ───────────────────────────────────────────────────────────────
select pg_temp.assert('#10 shipped apps (activity_list) never see a mention',
  not exists (select 1 from activity_list(100, null) where type = 'mention'), true);
select pg_temp.assert('#11 new apps (activity_list_v2) do — the caption one and the comment one',
  (select count(*) from activity_list_v2(100, null) where type = 'mention') = 3, true);
select pg_temp.assert('#11b the row says where, and quotes the stored text',
  exists (select 1 from activity_list_v2(100, null)
           where type = 'mention' and payload ->> 'where' = 'comment'
             and payload ->> 'comment_id' = 'a7300000-0000-0000-0000-000000000001'
             and payload ->> 'text' = '@mn_own @mn_riya hear this'), true);
reset role;

-- ── A deleted comment takes its mentions with it ────────────────────────────
delete from post_comments where id = 'a7300000-0000-0000-0000-000000000001';
select pg_temp.assert('#12 the comment''s mention row is gone',
  not exists (select 1 from activity_notifications
               where agg_key = 'mention:comment:a7300000-0000-0000-0000-000000000001'), true);

-- ── Signed out ──────────────────────────────────────────────────────────────
set local role anon;
select pg_temp.assert('#13 a signed-out caller cannot run it',
  pg_temp.allows('select activity_notify_mentions(''a7200000-0000-0000-0000-000000000001''::uuid, null)'), false);
reset role;

-- ── The switch ──────────────────────────────────────────────────────────────
select pg_temp.assert('#14 notification_preferences.mentions defaults on',
  (select column_default = 'true' and is_nullable = 'NO' from information_schema.columns
    where table_name = 'notification_preferences' and column_name = 'mentions'), true);

rollback;
