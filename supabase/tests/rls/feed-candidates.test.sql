-- Retrieve-then-rank: what makes it into the pool at all.
--
-- PROP-0010 phase 4. Once the ranker stops scoring every row in `posts`, "is this post
-- in the feed" becomes a second question with its own answer, and a post can now go
-- missing for reasons the ranking tests cannot see. These assert the pool:
--
--   · a brand-new post is reachable BEFORE any rollup has scored it, so a stalled
--     refresh job costs reach and not correctness;
--   · the viewer's own upload is in their own feed — nobody is their own friend, so it
--     needs its own branch, and its absence would read as the upload having failed;
--   · a post old enough to be outside every other branch is still reachable while it is
--     suppressed, which is what keeps "demoted, not dropped" true;
--   · …and one that is outside every branch is genuinely gone, so the pool is proven to
--     BE a pool rather than a full scan wearing a hat;
--   · the rollup scores recent posts and zeroes aged-out ones;
--   · an ordinary caller cannot trigger the rollup, because it is an unbounded write.
--
-- THE TIMEZONE CASE IS THE IMPORTANT ONE. `timezone('utc', now())` returns timestamp
-- WITHOUT time zone, so comparing it to a timestamptz column re-interprets it in the
-- session's zone. On a UTC session — CI, and Supabase's own — it agrees with now() and
-- nothing shows. Anywhere else the candidate window silently drops posts created
-- seconds ago. This file sets an extreme zone deliberately so the defect cannot hide
-- behind a UTC runner.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/feed-candidates.test.sql

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
  when insufficient_privilege then return false;
end $$;

-- Pages the whole feed the way the client does. Needed because membership is the
-- question here and a suppressed post sorts behind every ranked one — a single
-- 50-row call would miss it and the test would read as a candidate-pool failure.
create or replace function pg_temp.in_feed(p uuid)
returns boolean language plpgsql stable as $$
declare
  v_bucket int := null; v_key double precision := null; v_id uuid := null;
  v_rows int; r record;
begin
  loop
    v_rows := 0;
    for r in select * from public.fetch_home_feed(50, v_bucket, v_key, v_id, 0, null) loop
      if r.post_id = p then return true; end if;
      v_bucket := r.feed_bucket; v_key := r.sort_key; v_id := r.post_id;
      v_rows := v_rows + 1;
    end loop;
    exit when v_rows < 50;
  end loop;
  return false;
end $$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id) values
  ('c1000000-0000-0000-0000-000000000001'),  -- VIEWER
  ('c1000000-0000-0000-0000-000000000002')   -- FILLER  (crowds the newest-N branch)
on conflict do nothing;

insert into profiles (id, username, username_set) values
  ('c1000000-0000-0000-0000-000000000001', 'fc_viewer', true),
  ('c1000000-0000-0000-0000-000000000002', 'fc_filler', true)
on conflict do nothing;

insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('c2000000-0000-0000-0000-0000000000aa', 'c1000000-0000-0000-0000-000000000002',
   'filler track', 'audio', 'https://example.invalid/fc.mp3'),
  ('c2000000-0000-0000-0000-0000000000bb', 'c1000000-0000-0000-0000-000000000001',
   'own track', 'audio', 'https://example.invalid/own.mp3')
on conflict do nothing;

-- 120 posts, all newer than the two old posts below, so the newest-100 branch is
-- actually BINDING. Without this the fixture is smaller than the limit, every branch
-- returns everything, and the exclusion case below would pass for the wrong reason.
insert into posts (id, author_id, kind, track_id, created_at)
select
  ('c3000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  'c1000000-0000-0000-0000-000000000002', 'upload',
  'c2000000-0000-0000-0000-0000000000aa',
  now() - make_interval(hours => n)
from generate_series(1, 120) n
on conflict do nothing;

insert into posts (id, author_id, kind, track_id, created_at) values
  -- Brand new, and no rollup has run since. hot_score is 0.
  ('c3000000-0000-0000-0000-0000000000f1', 'c1000000-0000-0000-0000-000000000002',
   'upload', 'c2000000-0000-0000-0000-0000000000aa', now()),
  -- The viewer's own upload, TEN DAYS old: inside the 30-day window its own branch
  -- uses, but behind all 120 filler posts so the newest-N branch cannot reach it. At
  -- one hour old this case passed with the own-posts branch deleted.
  ('c3000000-0000-0000-0000-0000000000f2', 'c1000000-0000-0000-0000-000000000001',
   'upload', 'c2000000-0000-0000-0000-0000000000bb', now() - interval '10 days'),
  -- Two months old. Outside the 30-day graph window, zeroed out of the hot-score
  -- index, and behind 120 newer posts. The ONLY way either of these reaches the feed
  -- is the impression branch — which the first one has and the second does not.
  ('c3000000-0000-0000-0000-0000000000f3', 'c1000000-0000-0000-0000-000000000002',
   'upload', 'c2000000-0000-0000-0000-0000000000aa', now() - interval '60 days'),
  ('c3000000-0000-0000-0000-0000000000f4', 'c1000000-0000-0000-0000-000000000002',
   'upload', 'c2000000-0000-0000-0000-0000000000aa', now() - interval '60 days')
on conflict do nothing;

insert into post_impressions (user_id, post_id, seen_count, last_seen_at) values
  ('c1000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-0000000000f3',
   3, now())
on conflict (user_id, post_id) do update set seen_count = excluded.seen_count;

-- ── 1. The rollup ───────────────────────────────────────────────────────────
-- A stale positive score on a post that has since aged out. The zeroing pass only
-- visits rows that HAVE a score — a post that was never scored needs no clearing —
-- so this is the state that pass exists for.
update posts set hot_score = 5.0 where id = 'c3000000-0000-0000-0000-0000000000f3';
update posts set likes_count = 50 where id = 'c3000000-0000-0000-0000-0000000000f1';

select public.refresh_post_hot_scores();

select pg_temp.assert(
  'a recent post with real engagement gets a positive score',
  (select hot_score > 0 from posts where id = 'c3000000-0000-0000-0000-0000000000f1'),
  true);

select pg_temp.assert(
  'a recent post nobody has touched scores zero, and is marked as scored',
  (select hot_score = 0 and hot_score_updated_at is not null
     from posts where id = 'c3000000-0000-0000-0000-000000000001'),
  true);

select pg_temp.assert(
  'a stale score on a post that has aged out of the window is cleared',
  (select hot_score = 0 from posts where id = 'c3000000-0000-0000-0000-0000000000f3'),
  true);

-- ── 2. Candidate membership ─────────────────────────────────────────────────
set local role authenticated;
select pg_temp.set_user('c1000000-0000-0000-0000-000000000001');

select pg_temp.assert(
  'the viewer''s own upload is in their own feed',
  pg_temp.in_feed('c3000000-0000-0000-0000-0000000000f2'),
  true);

select pg_temp.assert(
  'a two-month-old post is reachable while it is suppressed',
  pg_temp.in_feed('c3000000-0000-0000-0000-0000000000f3'),
  true);

select pg_temp.assert(
  'and an identical one with no impression is genuinely out of the pool',
  pg_temp.in_feed('c3000000-0000-0000-0000-0000000000f4'),
  false);

-- ── 3. A new post does not wait for the rollup ──────────────────────────────
-- Scored to zero, behind nothing, reachable purely because it is new. This is what
-- makes a stalled refresh job a reach problem rather than an outage.
-- Only hot_score is cleared, not likes_count: the counter-freeze trigger
-- (20260722160000) refuses direct counter writes once auth.uid() is non-null, which it
-- is by now. Zeroing the rollup is the whole point anyway — it takes the post out of
-- the hot-score branch, leaving only "it is new" to carry it.
reset role;
update posts set hot_score = 0 where id = 'c3000000-0000-0000-0000-0000000000f1';
set local role authenticated;
select pg_temp.set_user('c1000000-0000-0000-0000-000000000001');

select pg_temp.assert(
  'a brand-new post with no rollup score is still in the feed',
  pg_temp.in_feed('c3000000-0000-0000-0000-0000000000f1'),
  true);

-- ── 3b. A blocked author cannot ride a candidate branch into the feed ───────
-- Candidate generation added three new ways for a post id to reach the ranker. RLS
-- still drops it at the `JOIN public.posts` in `base` — verified here rather than
-- assumed, because it is load-bearing and undefended: if the candidate CTE is ever
-- moved into a DEFINER helper for speed, this becomes a live leak, and the impressions
-- branch in particular carries ids for posts the viewer cannot see.
--
-- The post below is made maximally attractive to branches 2, 3 AND 4 at once.
reset role;
insert into auth.users (id) values ('c1000000-0000-0000-0000-000000000003')
on conflict do nothing;
insert into profiles (id, username, username_set) values
  ('c1000000-0000-0000-0000-000000000003', 'fc_blocked', true)
on conflict do nothing;
insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('c2000000-0000-0000-0000-0000000000cc', 'c1000000-0000-0000-0000-000000000003',
   'blocked track', 'audio', 'https://example.invalid/blk.mp3')
on conflict do nothing;
insert into posts (id, author_id, kind, track_id, created_at) values
  ('c3000000-0000-0000-0000-0000000000f5', 'c1000000-0000-0000-0000-000000000003',
   'upload', 'c2000000-0000-0000-0000-0000000000cc', now())
on conflict do nothing;
update posts set hot_score = 999999 where id = 'c3000000-0000-0000-0000-0000000000f5';
insert into post_impressions (user_id, post_id, seen_count, last_seen_at) values
  ('c1000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-0000000000f5', 1, now())
on conflict (user_id, post_id) do update set seen_count = excluded.seen_count;
-- A second post by the same blocked author, with NO impression row, reserved for the
-- existence-oracle case further down.
insert into posts (id, author_id, kind, track_id, created_at) values
  ('c3000000-0000-0000-0000-0000000000f6', 'c1000000-0000-0000-0000-000000000003',
   'upload', 'c2000000-0000-0000-0000-0000000000cc', now())
on conflict do nothing;

insert into blocked_users (blocker_id, blocked_id) values
  ('c1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001')
on conflict do nothing;

set local role authenticated;
select pg_temp.set_user('c1000000-0000-0000-0000-000000000001');

select pg_temp.assert(
  'a blocked author''s post stays out despite topping every candidate branch',
  pg_temp.in_feed('c3000000-0000-0000-0000-0000000000f5'),
  false);

-- ── 4. The candidate window is timezone-correct ─────────────────────────────
-- +14 is the largest offset there is, so a naive UTC wall-clock value used as a
-- timestamptz bound lands fourteen hours in the past and the `created_at <= origin`
-- filter drops everything recent. On a UTC runner that mistake is invisible; here it
-- is a failure. This is how the defect was actually found.
set local timezone = 'Pacific/Kiritimati';
select pg_temp.set_user('c1000000-0000-0000-0000-000000000001');

select pg_temp.assert(
  'a post created moments ago survives the candidate window at UTC+14',
  pg_temp.in_feed('c3000000-0000-0000-0000-0000000000f1'),
  true);

set local timezone = 'Pacific/Midway';   -- UTC-11, the other direction
select pg_temp.set_user('c1000000-0000-0000-0000-000000000001');

select pg_temp.assert(
  'and at UTC-11',
  pg_temp.in_feed('c3000000-0000-0000-0000-0000000000f1'),
  true);

set local timezone = 'UTC';

-- ── 5. The rollup is not a user action ──────────────────────────────────────
-- An unbounded UPDATE reachable from a signed-in session is a request amplifier: one
-- call rewrites every recent row, and nothing stops a caller looping it.
-- The function is SECURITY INVOKER, so RLS is the whole control: `posts_update_own`
-- holds a signed-in caller to their own posts, and `anon` has no UPDATE policy at all.
-- The first draft was DEFINER with a hand-written guard that PERMITTED every caller
-- without a JWT; security review caught it, and these two assert the replacement.
--
-- The interesting half is the second one. A caller who owns posts legitimately
-- recomputes their own — idempotent, and bounded by how much they have uploaded.
-- What must never happen is one account moving another account's numbers.
select pg_temp.set_user('c1000000-0000-0000-0000-000000000001');

reset role;
update posts set hot_score = 42.0 where id = 'c3000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.set_user('c1000000-0000-0000-0000-000000000001');

select public.refresh_post_hot_scores();

select pg_temp.assert(
  'a signed-in caller cannot rewrite another author''s rollup score',
  (select hot_score = 42.0 from posts where id = 'c3000000-0000-0000-0000-000000000001'),
  true);

set local role anon;
select pg_temp.assert(
  'anon cannot execute the rollup at all',
  pg_temp.allows($$select public.refresh_post_hot_scores()$$),
  false);
set local role authenticated;

-- THE CASE THAT PINS THE FIX. A principal holding EXECUTE but carrying no JWT — the
-- shape `anon` takes if a future DROP+CREATE re-triggers Supabase's default grant, and
-- the shape service_role always has. The rejected first draft guarded with
-- `if auth.uid() is not null and not is_ops() then return 0`, which PERMITS exactly
-- this caller and would rewrite every recent row. Under SECURITY INVOKER,
-- posts_update_own requires `author_id = auth.uid()`, and a null uid matches nothing.
select pg_temp.set_user(null);
select public.refresh_post_hot_scores();

select pg_temp.assert(
  'a caller with no JWT cannot rewrite anyone''s rollup score',
  (select hot_score = 42.0 from posts where id = 'c3000000-0000-0000-0000-000000000001'),
  true);
select pg_temp.set_user('c1000000-0000-0000-0000-000000000001');

-- And the existence oracle security review demonstrated: the impressions writer is
-- SECURITY DEFINER, so its join over `posts` bypasses posts_select_authenticated. With
-- no visibility predicate it wrote a row for any id that merely EXISTS, which the
-- caller could then read back through their own-row policy — turning a blocked user
-- into someone who can confirm which of the blocker's posts are still there.
select public.record_post_impressions(
  array['c3000000-0000-0000-0000-0000000000f6']::uuid[]);

select pg_temp.assert(
  'no impression is recorded for a post the blocker has hidden',
  exists (select 1 from public.post_impressions
           where user_id = 'c1000000-0000-0000-0000-000000000001'
             and post_id = 'c3000000-0000-0000-0000-0000000000f6'),
  false);

-- The control: the same call for a post the viewer CAN see does write a row. Without
-- this, deleting the whole INSERT would also pass the assertion above.
select public.record_post_impressions(
  array['c3000000-0000-0000-0000-0000000000f1']::uuid[]);

select pg_temp.assert(
  'while a visible post in the same call is recorded normally',
  exists (select 1 from public.post_impressions
           where user_id = 'c1000000-0000-0000-0000-000000000001'
             and post_id = 'c3000000-0000-0000-0000-0000000000f1'),
  true);

reset role;
rollback;
