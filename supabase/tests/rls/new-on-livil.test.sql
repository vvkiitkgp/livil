-- New on Livil (20261026000000): Home's second tab is the For you ranker with one filter —
-- uploads only.
--
-- Pins: (1) the tab returns uploads and nothing else — no reposts of any kind; (2) it is
-- still the posts read policy deciding every row (a blocked uploader stays invisible, own
-- uploads are included, signed out gets nothing); (3) For you still returns reposts and is
-- exactly the shared ranker with the filter off; (4) a flood of newer reposts cannot push an
-- upload out of the tab's candidate pool (the filter sits inside the LIMITed branches);
-- (5) only signed-in callers may run the feeds; (6) the new_music switch defaults on and
-- only its owner can change it.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/new-on-livil.test.sql

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

create or replace function pg_temp.rows_affected(stmt text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
exception
  when others then return -1;
end $$;

grant usage on schema auth to authenticated;

-- VIEWER looks at Home. ARJUN is her friend; DEV is a stranger; BLOCKED blocked her;
-- RIYA reposts a lot.
insert into auth.users (id) values
  ('b1000000-0000-0000-0000-000000000001'),  -- VIEWER
  ('b1000000-0000-0000-0000-000000000002'),  -- ARJUN (friend, uploads)
  ('b1000000-0000-0000-0000-000000000003'),  -- DEV (stranger, uploads)
  ('b1000000-0000-0000-0000-000000000004'),  -- BLOCKED (uploads, blocked the viewer)
  ('b1000000-0000-0000-0000-000000000005')   -- RIYA (reposts)
on conflict do nothing;

insert into profiles (id, username, username_set) values
  ('b1000000-0000-0000-0000-000000000001', 'nol_viewer',  true),
  ('b1000000-0000-0000-0000-000000000002', 'nol_arjun',   true),
  ('b1000000-0000-0000-0000-000000000003', 'nol_dev',     true),
  ('b1000000-0000-0000-0000-000000000004', 'nol_blocked', true),
  ('b1000000-0000-0000-0000-000000000005', 'nol_riya',    true)
on conflict do nothing;

insert into friendships (user_a_id, user_b_id, status, requested_by, accepted_at) values
  ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002',
   'accepted', 'b1000000-0000-0000-0000-000000000001', now())
on conflict do nothing;

insert into blocked_users (blocker_id, blocked_id) values
  ('b1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000001')
on conflict do nothing;

insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', 'Midnight Chai',   'audio', 'https://example.invalid/1.mp3'),
  ('b2000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000003', 'Late Train Home', 'audio', 'https://example.invalid/2.mp3'),
  ('b2000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000004', 'Hidden',          'audio', 'https://example.invalid/3.mp3'),
  ('b2000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000001', 'My Own Song',     'audio', 'https://example.invalid/4.mp3')
on conflict do nothing;

-- DEV's upload is the OLDEST post and nobody the viewer knows: it is only reachable through
-- the "newest 100" branch — which 110 newer reposts below would fill on their own.
insert into posts (id, author_id, kind, track_id, original_post_id, created_at) values
  ('b3000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000003', 'upload',
   'b2000000-0000-0000-0000-000000000002', null, now() - interval '3 hours'),
  ('b3000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', 'upload',
   'b2000000-0000-0000-0000-000000000001', null, now() - interval '2 hours'),
  ('b3000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000004', 'upload',
   'b2000000-0000-0000-0000-000000000003', null, now() - interval '2 hours'),
  ('b3000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000001', 'upload',
   'b2000000-0000-0000-0000-000000000004', null, now() - interval '2 hours')
on conflict do nothing;

-- 110 reposts by RIYA (a stranger to the viewer, reposts public by default), all newer than
-- DEV's upload.
insert into posts (author_id, kind, track_id, original_post_id, created_at)
select 'b1000000-0000-0000-0000-000000000005', 'repost',
       'b2000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001',
       now() - interval '1 hour' + make_interval(secs => g)
from generate_series(1, 110) g;

-- ── 1/2/4. The tab, as VIEWER ───────────────────────────────────────────────
select pg_temp.set_user('b1000000-0000-0000-0000-000000000001');
set local role authenticated;

create temp table nol on commit drop as
  select * from public.fetch_new_on_livil(p_limit => 50, p_seed => 7, p_session_started_at => now());

select pg_temp.assert_count('1a  New on Livil returns no reposts at all',
  (select count(*) from nol where post->>'kind' <> 'upload'), 0);
select pg_temp.assert_count('1b  …and returns the friend''s upload',
  (select count(*) from nol where post_id = 'b3000000-0000-0000-0000-000000000001'), 1);
select pg_temp.assert_count('2a  a blocked uploader stays invisible (the read policy still decides)',
  (select count(*) from nol where post_id = 'b3000000-0000-0000-0000-000000000003'), 0);
select pg_temp.assert_count('2b  the viewer''s own upload is in the tab, like in For you',
  (select count(*) from nol where post_id = 'b3000000-0000-0000-0000-000000000004'), 1);
select pg_temp.assert_count('4a  110 newer reposts do not push a stranger''s upload out of the pool',
  (select count(*) from nol where post_id = 'b3000000-0000-0000-0000-000000000002'), 1);
select pg_temp.assert('1c  rows carry the same post shape For you does',
  (select bool_and(post ? 'track' and post ? 'author' and post ? 'viewer_has_liked') from nol), true);

-- ── 3. For you, as VIEWER ───────────────────────────────────────────────────
create temp table fy on commit drop as
  select * from public.fetch_home_feed(p_limit => 50, p_seed => 7, p_session_started_at => now());

select pg_temp.assert('3a  For you still has reposts in it',
  (select count(*) > 0 from fy where post->>'kind' = 'repost'), true);
-- (By construction — fetch_home_feed's body IS this call. That For you is unchanged from
-- 20261009000000 is shown by the feed-* suites, which run against the wrapper, and by the
-- seeded before/after replay recorded in ADR-0030.)
select pg_temp.assert_count('3b  For you is the shared ranker with the filter off',
  (select count(*) from (
     (select feed_bucket, sort_key, post_id from fy
      except
      select feed_bucket, sort_key, post_id from public.home_feed_ranked(
        false, p_limit => 50, p_seed => 7, p_session_started_at => now()))
     union all
     (select feed_bucket, sort_key, post_id from public.home_feed_ranked(
        false, p_limit => 50, p_seed => 7, p_session_started_at => now())
      except
      select feed_bucket, sort_key, post_id from fy)
   ) d), 0);

-- Pagination: a second page continues after the first and repeats nothing.
create temp table nol_p1 on commit drop as
  select * from public.fetch_new_on_livil(p_limit => 1, p_seed => 7, p_session_started_at => now());
create temp table nol_p2 on commit drop as
  select * from public.fetch_new_on_livil(
    p_limit => 50,
    p_cursor_bucket => (select feed_bucket from nol_p1),
    p_cursor_sort_key => (select sort_key from nol_p1),
    p_cursor_id => (select post_id from nol_p1),
    p_seed => 7, p_session_started_at => now());
select pg_temp.assert_count('3c  the tab''s cursor pages without repeating a post',
  (select count(*) from nol_p2 where post_id = (select post_id from nol_p1)), 0);
select pg_temp.assert_count('3d  …and page 1 + page 2 is the whole tab',
  (select count(*) from nol_p2) + 1, (select count(*) from nol));
reset role;

-- ── 2c / 5. Signed out ──────────────────────────────────────────────────────
-- At runtime, not only by grant: CI's Postgres lacks Supabase's default EXECUTE-to-anon on
-- new functions, so the has_function_privilege checks below would pass even without the
-- migration's explicit anon revokes. A request with no user gets nothing either way.
select pg_temp.set_user(null);
set local role authenticated;
select pg_temp.assert_count('2c  a request with no signed-in user gets no rows from the tab',
  (select count(*) from public.fetch_new_on_livil(p_limit => 50)), 0);
select pg_temp.assert_count('2d  …nor from the shared ranker, either way round',
  (select count(*) from public.home_feed_ranked(true, p_limit => 50))
  + (select count(*) from public.home_feed_ranked(false, p_limit => 50)), 0);
reset role;

select pg_temp.assert('5a  signed out cannot run New on Livil',
  has_function_privilege('anon', 'public.fetch_new_on_livil(integer, integer, double precision, uuid, bigint, timestamptz)', 'execute'), false);
select pg_temp.assert('5b  …nor the shared ranker',
  has_function_privilege('anon', 'public.home_feed_ranked(boolean, integer, integer, double precision, uuid, bigint, timestamptz)', 'execute'), false);
select pg_temp.assert('5c  …and For you is still signed-in only',
  has_function_privilege('anon', 'public.fetch_home_feed(integer, integer, double precision, uuid, bigint, timestamptz)', 'execute'), false);
select pg_temp.assert('5d  signed in may run the tab',
  has_function_privilege('authenticated', 'public.fetch_new_on_livil(integer, integer, double precision, uuid, bigint, timestamptz)', 'execute'), true);

-- ── 6. The New music switch ─────────────────────────────────────────────────
insert into notification_preferences (user_id) values ('b1000000-0000-0000-0000-000000000001')
on conflict do nothing;
select pg_temp.assert('6a  new_music defaults on for a row an old app creates',
  (select new_music from notification_preferences where user_id = 'b1000000-0000-0000-0000-000000000001'), true);

select pg_temp.set_user('b1000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert('6b  someone else cannot switch it off',
  pg_temp.rows_affected($q$update notification_preferences set new_music = false
    where user_id = 'b1000000-0000-0000-0000-000000000001'$q$) <= 0, true);
reset role;

select pg_temp.set_user('b1000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('6c  the owner can switch it off',
  pg_temp.rows_affected($q$update notification_preferences set new_music = false
    where user_id = 'b1000000-0000-0000-0000-000000000001'$q$) = 1, true);
reset role;

rollback;
