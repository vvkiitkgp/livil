-- Like notification tests (20260929010000_like_notifications_follow_real_likes.sql).
--
-- The owner's "X and N others liked your post" must match the post's real likes, and
-- the owner is pushed about each liker ONCE per post. What must hold:
--   * a like counts the likers right now — like → unlike → like by one person is 1, not 3;
--   * that repeat like returns recipient_should_push = false (no second push);
--   * a second, different liker DOES push and makes it 2;
--   * an unlike lowers the count, and the last unlike hides the row from activity_list;
--   * nobody but the liker can make a like notification (no post_likes row → nothing).
--
-- Runs as `authenticated` against the deployed functions. Switching user redefines the
-- auth.uid() stub, which needs the superuser, hence the reset/set role around each switch.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/like-notifications.test.sql

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

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   OWNER — posted the track
--   SAM   — likes, unlikes, likes again
--   RIYA  — a second, different liker
insert into auth.users (id) values
  ('f1111111-0000-0000-0000-000000000001'),
  ('f1111111-0000-0000-0000-000000000002'),
  ('f1111111-0000-0000-0000-000000000003')
on conflict do nothing;

insert into profiles (id, username, username_set) values
  ('f1111111-0000-0000-0000-000000000001', 'ln_like_owner', true),
  ('f1111111-0000-0000-0000-000000000002', 'ln_like_sam',   true),
  ('f1111111-0000-0000-0000-000000000003', 'ln_like_riya',  true)
on conflict do nothing;

insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('f2222222-0000-0000-0000-000000000001', 'f1111111-0000-0000-0000-000000000001',
   'Beat It', 'audio', 'https://example.invalid/b.mp3')
on conflict do nothing;

insert into posts (id, author_id, kind, track_id) values
  ('f3333333-0000-0000-0000-000000000001', 'f1111111-0000-0000-0000-000000000001',
   'upload', 'f2222222-0000-0000-0000-000000000001')
on conflict do nothing;

-- ── 1. No like row, no notification ─────────────────────────────────────────
reset role;
select pg_temp.set_user('f1111111-0000-0000-0000-000000000002');
set role authenticated;
select pg_temp.assert_int('#1 notify without having liked returns nothing',
  (select count(*) from activity_notify_post('f3333333-0000-0000-0000-000000000001', 'like')), 0);

-- ── 2. Sam likes → push, count 1 ────────────────────────────────────────────
insert into post_likes (post_id, user_id)
values ('f3333333-0000-0000-0000-000000000001', 'f1111111-0000-0000-0000-000000000002');
create temp table r2 as
  select * from activity_notify_post('f3333333-0000-0000-0000-000000000001', 'like');
select pg_temp.assert('#2 first like pushes', (select recipient_should_push from r2), true);
select pg_temp.assert_int('#2 first like counts 1', (select agg_count from r2), 1);

-- ── 3. Sam unlikes, likes again → no push, still 1 ──────────────────────────
delete from post_likes
 where post_id = 'f3333333-0000-0000-0000-000000000001'
   and user_id = 'f1111111-0000-0000-0000-000000000002';
insert into post_likes (post_id, user_id)
values ('f3333333-0000-0000-0000-000000000001', 'f1111111-0000-0000-0000-000000000002');
create temp table r3 as
  select * from activity_notify_post('f3333333-0000-0000-0000-000000000001', 'like');
select pg_temp.assert('#3 repeat like from the same person does not push',
  (select recipient_should_push from r3), false);
select pg_temp.assert_int('#3 repeat like still counts 1 (was 2 before the fix)',
  (select agg_count from r3), 1);

-- ── 4. Riya likes → push, count 2 ───────────────────────────────────────────
reset role;
select pg_temp.set_user('f1111111-0000-0000-0000-000000000003');
set role authenticated;
insert into post_likes (post_id, user_id)
values ('f3333333-0000-0000-0000-000000000001', 'f1111111-0000-0000-0000-000000000003');
create temp table r4 as
  select * from activity_notify_post('f3333333-0000-0000-0000-000000000001', 'like');
select pg_temp.assert('#4 a different liker pushes', (select recipient_should_push from r4), true);
select pg_temp.assert_int('#4 two likers count 2', (select agg_count from r4), 2);

-- ── 5. Both unlike → the owner's list no longer shows it ────────────────────
delete from post_likes
 where post_id = 'f3333333-0000-0000-0000-000000000001'
   and user_id = 'f1111111-0000-0000-0000-000000000003';
reset role;
select pg_temp.set_user('f1111111-0000-0000-0000-000000000002');
set role authenticated;
delete from post_likes
 where post_id = 'f3333333-0000-0000-0000-000000000001'
   and user_id = 'f1111111-0000-0000-0000-000000000002';

reset role;
select pg_temp.set_user('f1111111-0000-0000-0000-000000000001');
set role authenticated;
select pg_temp.assert_int('#5 a like notification with no likes left is hidden',
  (select count(*) from activity_list(50, null) where type = 'like'), 0);
select pg_temp.assert_int('#5 and does not count as unread',
  (select activity_unread_count()), 0);

reset role;
rollback;
