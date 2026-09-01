-- One score instead of three walls.
--
-- PROP-0010 phase 3. These assert the SEMANTICS of the ranking rather than the order of a
-- particular page, because the order of a page is a consequence and the semantics are the
-- decision. Each one names a property somebody could plausibly change by accident:
--
--   · affinity is a TERM — a stranger's fresh, strongly-engaged post can now outrank a
--     friend's week-old one. This is the behaviour change phase 3 exists for, and the
--     first time this feed has ever put a stranger above a friend;
--   · but affinity still WINS all else equal, which is what stops that being a regression;
--   · affinity takes the strongest relationship, it does not add them up — otherwise
--     someone who is both a friend and a starred artist quietly outranks every friend;
--   · listening counts. An author the viewer has actually played outranks one they have
--     never heard, by exactly the gap the two constants describe;
--   · suppression still beats every score outright, which is why it is a separate leading
--     sort key and not a large negative number in the score.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/feed-ranking.test.sql
--
-- Runs under `set local role authenticated`: fetch_home_feed is SECURITY INVOKER, and as
-- the table owner RLS is bypassed and none of this would mean anything.

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

-- Score comparisons need a tolerance, not equality: these are doubles built from exp() and
-- ln(). The band is stated per assertion so a drifting constant fails loudly rather than
-- being absorbed.
create or replace function pg_temp.assert_between(
  label text, actual double precision, lo double precision, hi double precision
)
returns void language plpgsql as $$
begin
  if actual is null or actual < lo or actual > hi then
    raise exception 'FAIL  %  (expected % .. %, got %)', label, lo, hi, actual;
  end if;
  raise notice 'ok    %  (%)', label, round(actual::numeric, 4);
end $$;

create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql security definer as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
  execute 'discard plans';
end $$;

-- Seed 0 → no jitter, so these compare the score itself rather than the session nudge.
create or replace function pg_temp.score_of(p uuid)
returns double precision language sql stable as $$
  select f.sort_key from public.fetch_home_feed(50, null, null, null, 0, null) f
   where f.post_id = p;
$$;

create or replace function pg_temp.tier_of(p uuid)
returns integer language sql stable as $$
  select f.feed_bucket from public.fetch_home_feed(50, null, null, null, 0, null) f
   where f.post_id = p;
$$;

create or replace function pg_temp.feed_ids()
returns uuid[] language sql stable as $$
  select array_agg(f.post_id order by f.feed_bucket asc, f.sort_key desc, f.post_id desc)
  from public.fetch_home_feed(50, null, null, null, 0, null) f;
$$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- EXACTLY ONE POST PER AUTHOR, deliberately. The per-author diversity penalty is phase 2's
-- and is tested there; giving anyone a second post here would fold that penalty into every
-- number below and make the bands meaningless.
insert into auth.users (id) values
  ('d1000000-0000-0000-0000-000000000001'),  -- VIEWER
  ('d1000000-0000-0000-0000-000000000002'),  -- FRIEND_STALE   friend, week-old post
  ('d1000000-0000-0000-0000-000000000003'),  -- FRIEND_FRESH   friend, brand-new post
  ('d1000000-0000-0000-0000-000000000004'),  -- FRIEND_STAR    friend AND starred
  ('d1000000-0000-0000-0000-000000000005'),  -- PLAYED         stranger the viewer played
  ('d1000000-0000-0000-0000-000000000006'),  -- HOT            stranger, heavily engaged
  ('d1000000-0000-0000-0000-000000000007'),  -- UNKNOWN        stranger, never encountered
  ('d1000000-0000-0000-0000-000000000008'),  -- BURNT          stranger, seen and ignored
  ('d1000000-0000-0000-0000-000000000009')   -- GLANCED        stranger, seen twice only
on conflict do nothing;

insert into profiles (id, username, username_set)
select id, 'fr_' || right(id::text, 2), true from auth.users
where id::text like 'd1000000-%'
on conflict do nothing;

insert into friendships (user_a_id, user_b_id, status, requested_by, accepted_at) values
  ('d1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002',
   'accepted', 'd1000000-0000-0000-0000-000000000001', now()),
  ('d1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000003',
   'accepted', 'd1000000-0000-0000-0000-000000000001', now()),
  ('d1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000004',
   'accepted', 'd1000000-0000-0000-0000-000000000001', now())
on conflict do nothing;

-- FRIEND_STAR is followed as well as befriended. If affinity summed instead of taking the
-- strongest, this is the account that would quietly outrank every other friend.
insert into follows (follower_id, following_id, kind) values
  ('d1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000004', 'star')
on conflict do nothing;

-- One track per post, so the duplicate-track penalty never enters these numbers either.
insert into tracks (id, uploader_id, title, media_kind, audio_url)
select
  ('d2000000-0000-0000-0000-00000000000' || n)::uuid,
  ('d1000000-0000-0000-0000-00000000000' || (n + 1))::uuid,
  'rank track ' || n, 'audio', 'https://example.invalid/r' || n || '.mp3'
from generate_series(1, 8) n
on conflict do nothing;

insert into posts (id, author_id, kind, track_id, created_at, likes_count) values
  -- A friend's post from a week ago, with nothing happening on it.
  ('d3000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002',
   'upload', 'd2000000-0000-0000-0000-000000000001',
   now() - interval '168 hours', 0),
  -- A friend's post from just now.
  ('d3000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000003',
   'upload', 'd2000000-0000-0000-0000-000000000002', now(), 0),
  -- Identical to the one above in every respect except the extra relationship.
  ('d3000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000004',
   'upload', 'd2000000-0000-0000-0000-000000000003', now(), 0),
  -- A stranger the viewer has listened to before.
  ('d3000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000005',
   'upload', 'd2000000-0000-0000-0000-000000000004', now(), 0),
  -- A stranger's post with real traction: 200 likes ≈ 400 engagement points, which is
  -- where the log term reaches about 1.0.
  ('d3000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-000000000006',
   'upload', 'd2000000-0000-0000-0000-000000000005', now(), 200),
  -- A stranger the viewer has never encountered at all.
  ('d3000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-000000000007',
   'upload', 'd2000000-0000-0000-0000-000000000006', now(), 0),
  -- Newest AND most engaged — and already shown three times without a flicker of
  -- interest. Everything about its score says top of the feed.
  ('d3000000-0000-0000-0000-000000000007', 'd1000000-0000-0000-0000-000000000008',
   'upload', 'd2000000-0000-0000-0000-000000000007', now(), 500),
  -- Identical to UNKNOWN's post in every respect. The only difference is that the viewer
  -- has already scrolled past it twice — below the suppression threshold, so it is still
  -- ranked normally, just less insistently.
  ('d3000000-0000-0000-0000-000000000008', 'd1000000-0000-0000-0000-000000000009',
   'upload', 'd2000000-0000-0000-0000-000000000008', now(), 0)
on conflict do nothing;

-- The viewer has played PLAYED's post. This is what puts that author on the 0.4 rung, and
-- it is a signal the old ranking could not see at all: it knew who you FOLLOWED and
-- nothing about who you had LISTENED TO.
insert into post_views (post_id, user_id) values
  ('d3000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000001')
on conflict do nothing;

insert into post_impressions (user_id, post_id, seen_count, last_seen_at) values
  ('d1000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000007',
   3, now()),
  ('d1000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000008',
   2, now())
on conflict (user_id, post_id) do update set seen_count = excluded.seen_count;

set local role authenticated;
select pg_temp.set_user('d1000000-0000-0000-0000-000000000001');

-- ── 1. Affinity is a term, not a wall ───────────────────────────────────────
-- friend + stale : 2.5·1.0 + 1.5·exp(-168/36)            ≈ 2.514
-- stranger + hot : 1.0·ln(401)/6 + 1.5·exp(0) + 0.4·1    ≈ 2.899
-- Under the old bucketing the friend post won by construction, whatever was in the
-- other one.
select pg_temp.assert(
  'a stranger''s fresh, engaged post outranks a friend''s week-old one',
  pg_temp.score_of('d3000000-0000-0000-0000-000000000005')
    > pg_temp.score_of('d3000000-0000-0000-0000-000000000001'),
  true);

-- ── 2. …but affinity still wins all else equal ──────────────────────────────
-- Same instant, same (zero) engagement. 2.5 against 0.4. If this ever flips, the feed has
-- stopped being about the people you know.
select pg_temp.assert_between(
  'a friend leads a stranger by the full affinity gap when nothing else differs',
  pg_temp.score_of('d3000000-0000-0000-0000-000000000002')
    - pg_temp.score_of('d3000000-0000-0000-0000-000000000006'),
  2.05, 2.15);   -- 2.5·1.0 − 0.4·1.0

-- ── 3. Affinity takes the strongest tie, it does not add them up ─────────────
-- FRIEND_STAR is both. Summing would give 2.5·1.7 and put them permanently above every
-- other friend, for a reason nobody chose and nobody would see in the UI.
select pg_temp.assert_between(
  'being both a friend and a starred artist is worth the same as being a friend',
  abs(pg_temp.score_of('d3000000-0000-0000-0000-000000000003')
        - pg_temp.score_of('d3000000-0000-0000-0000-000000000002')),
  0.0, 0.000001);

-- ── 4. Listening is a signal ────────────────────────────────────────────────
-- played : 2.5·0.4              = 1.0
-- unknown: 0.4·1.0 (discovery)  = 0.4
-- The discovery bonus is what makes this 0.6 rather than 1.0 — a never-encountered author
-- is deliberately not scored as far below as the arithmetic would otherwise put them.
select pg_temp.assert_between(
  'an author the viewer has played outranks one they have never heard',
  pg_temp.score_of('d3000000-0000-0000-0000-000000000004')
    - pg_temp.score_of('d3000000-0000-0000-0000-000000000006'),
  0.55, 0.65);

-- ── 5. Being shown something costs it, before it is ever suppressed ─────────
-- Two posts alike in every respect except that one has already been scrolled past twice.
-- Twice is BELOW the suppression threshold, so nothing here involves tier 4 — this is the
-- graded penalty on its own: 2.0 · (2/4) = 1.0.
--
-- Without this the feed only reacts to a post at the third showing, and reacts to it by
-- burying it completely. The gradient is what makes that a slope rather than a cliff.
select pg_temp.assert_between(
  'a post already seen twice ranks below an identical one never seen',
  pg_temp.score_of('d3000000-0000-0000-0000-000000000006')
    - pg_temp.score_of('d3000000-0000-0000-0000-000000000008'),
  0.95, 1.05);

select pg_temp.assert(
  'and two showings do not suppress it — it is still ranked normally',
  pg_temp.tier_of('d3000000-0000-0000-0000-000000000008') = 1,
  true);

-- ── 6. Suppression is not a score ───────────────────────────────────────────
-- This post is the newest in the feed and by far the most engaged; on score alone it
-- leads. It is last, because "seen enough" is a separate leading sort key rather than a
-- large negative number that every future term is a chance to overwhelm.
select pg_temp.assert(
  'the seen-enough post scores top of the feed and still ranks last',
  (pg_temp.feed_ids())[array_length(pg_temp.feed_ids(), 1)]
    = 'd3000000-0000-0000-0000-000000000007'::uuid,
  true);

select pg_temp.assert(
  'and it is still returned rather than dropped',
  pg_temp.tier_of('d3000000-0000-0000-0000-000000000007') = 4,
  true);

reset role;
rollback;
