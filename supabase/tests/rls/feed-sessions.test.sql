-- Home feed sessions — stable while you scroll, different when you pull down.
--
-- PROP-0010 phase 2. The properties asserted here are the ones that make the difference
-- between "refresh re-ranks" and "refresh is random", and they pull in opposite directions:
--
--   · SAME session (seed + origin) → byte-identical ordering, every time. Without this,
--     page 2 of a scroll is compared against scores page 1 was never issued from, and rows
--     are silently skipped or repeated;
--   · DIFFERENT seed → a different order over the SAME posts. This is the reported defect:
--     two refreshes seconds apart returned an identical page, so nothing appeared to happen;
--   · the frozen origin is CLAMPED, because it arrives from the client and is the
--     denominator of the decay — far-past flattens the ranking, far-future explodes it;
--   · seed 0 is the unseeded ordering, so an app version that predates sessions keeps the
--     behaviour it was written against;
--   · one prolific author does not own the page, and one track does not appear twice in it.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/feed-sessions.test.sql
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

create or replace function pg_temp.assert_num(label text, actual bigint, expected bigint)
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

-- The feed as the current viewer sees it, in order. SECURITY INVOKER by default.
create or replace function pg_temp.feed_ids(
  p_seed bigint default 0,
  p_limit int default 50,
  p_origin timestamptz default null
)
returns uuid[] language sql stable as $$
  select array_agg(f.post_id order by f.feed_bucket asc, f.sort_key desc, f.post_id desc)
  from public.fetch_home_feed(p_limit, null, null, null, p_seed, p_origin) f;
$$;

-- One post's score under a given origin. Seed 0, so this is the score itself.
create or replace function pg_temp.score_at(p uuid, o timestamptz)
returns double precision language sql stable as $$
  select f.sort_key from public.fetch_home_feed(50, null, null, null, 0, o) f
   where f.post_id = p;
$$;

-- Walks the cursor exactly as the client does, and returns every id it was handed.
-- Duplicates are preserved deliberately — finding them is the point.
create or replace function pg_temp.feed_paged(p_seed bigint, p_page int)
returns uuid[] language plpgsql stable as $$
declare
  v_out uuid[] := '{}';
  v_bucket int := null;
  v_key double precision := null;
  v_id uuid := null;
  v_rows int;
  v_origin timestamptz := now();
  r record;
begin
  loop
    v_rows := 0;
    for r in
      select * from public.fetch_home_feed(p_page, v_bucket, v_key, v_id, p_seed, v_origin)
    loop
      v_out := v_out || r.post_id;
      v_bucket := r.feed_bucket;
      v_key := r.sort_key;
      v_id := r.post_id;
      v_rows := v_rows + 1;
    end loop;
    exit when v_rows < p_page;
  end loop;
  return v_out;
end $$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- VIEWER is friends with both FRIEND and PROLIFIC, so everything below lands in
-- bucket 1 and the assertions are about the score rather than about bucketing.
insert into auth.users (id) values
  ('e1000000-0000-0000-0000-000000000001'),  -- VIEWER
  ('e1000000-0000-0000-0000-000000000002'),  -- FRIEND
  ('e1000000-0000-0000-0000-000000000003')   -- PROLIFIC
on conflict do nothing;

insert into profiles (id, username, username_set) values
  ('e1000000-0000-0000-0000-000000000001', 'fs_viewer',   true),
  ('e1000000-0000-0000-0000-000000000002', 'fs_friend',   true),
  ('e1000000-0000-0000-0000-000000000003', 'fs_prolific', true)
on conflict do nothing;

-- friendships_check enforces user_a_id < user_b_id.
insert into friendships (user_a_id, user_b_id, status, requested_by, accepted_at) values
  ('e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002',
   'accepted', 'e1000000-0000-0000-0000-000000000001', now()),
  ('e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000003',
   'accepted', 'e1000000-0000-0000-0000-000000000001', now())
on conflict do nothing;

-- PROLIFIC uploads eight tracks in eight hours, each its own track so nothing here is
-- measuring the duplicate-track rule by accident.
insert into tracks (id, uploader_id, title, media_kind, audio_url)
select
  ('e2000000-0000-0000-0000-00000000000' || n)::uuid,
  'e1000000-0000-0000-0000-000000000003',
  'prolific ' || n, 'audio', 'https://example.invalid/p' || n || '.mp3'
from generate_series(1, 8) n
on conflict do nothing;

insert into posts (id, author_id, kind, track_id, created_at)
select
  ('e3000000-0000-0000-0000-00000000000' || n)::uuid,
  'e1000000-0000-0000-0000-000000000003',
  'upload',
  ('e2000000-0000-0000-0000-00000000000' || n)::uuid,
  now() - make_interval(hours => n - 1)
from generate_series(1, 8) n
on conflict do nothing;

-- FRIEND posts once, EIGHT HOURS AGO — older than every one of PROLIFIC's. Without the
-- per-author penalty this post is ninth; with it, it should reach the top few.
insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('e2000000-0000-0000-0000-0000000000f1', 'e1000000-0000-0000-0000-000000000002',
   'friend track', 'audio', 'https://example.invalid/f1.mp3')
on conflict do nothing;

insert into posts (id, author_id, kind, track_id, created_at) values
  ('e3000000-0000-0000-0000-0000000000f1', 'e1000000-0000-0000-0000-000000000002',
   'upload', 'e2000000-0000-0000-0000-0000000000f1',
   now() - interval '8 hours')
on conflict do nothing;

-- FRIEND reposts PROLIFIC's second-newest track, just now. It therefore shares a track
-- with post e3…02 and is the newest thing in the feed. Reposts are visible here because
-- posts_select_authenticated allows them between friends.
insert into posts (id, author_id, kind, track_id, original_post_id, created_at) values
  ('e3000000-0000-0000-0000-0000000000f2', 'e1000000-0000-0000-0000-000000000002',
   'repost', 'e2000000-0000-0000-0000-000000000002',
   'e3000000-0000-0000-0000-000000000002', now())
on conflict do nothing;

set local role authenticated;
select pg_temp.set_user('e1000000-0000-0000-0000-000000000001');

-- ── 1. A session is stable ──────────────────────────────────────────────────
-- The origin is pinned so this asserts the seed's contribution alone; case 3 covers
-- what happens when it is left to default.
select pg_temp.assert(
  'the same seed and origin produce the same order, every time',
  pg_temp.feed_ids(12345, 50, now())
    = pg_temp.feed_ids(12345, 50, now()),
  true);

-- ── 2. A new seed re-ranks, without changing what is in the feed ────────────
select pg_temp.assert(
  'a different seed produces a different order — this is the reported defect',
  pg_temp.feed_ids(12345, 50, now())
    = pg_temp.feed_ids(99999, 50, now()),
  false);

select pg_temp.assert(
  'and re-ranks the same posts rather than hiding any',
  (select array_agg(x order by x) from unnest(pg_temp.feed_ids(12345, 50, now())) x)
    = (select array_agg(x order by x) from unnest(pg_temp.feed_ids(99999, 50, now())) x),
  true);

-- ── 3. Seed 0 is the unseeded ordering ──────────────────────────────────────
-- Not "jitter keyed on zero": hashing zero would still shuffle. An app version that
-- predates sessions sends no seed at all and must keep the ordering it was written
-- against, so the parameter default and seed 0 have to be the same thing.
select pg_temp.assert(
  'the parameter defaults reproduce the seed-0 ordering, for app versions with no seed',
  (select array_agg(f.post_id order by f.feed_bucket, f.sort_key desc, f.post_id desc)
     from public.fetch_home_feed(50) f)
    = pg_temp.feed_ids(0, 50, null),
  true);

-- And that seed 0 contributes NOTHING, rather than contributing a fixed nudge. Stated as
-- an exact identity instead of a bound: a seeded score minus the seed-0 score must equal
-- that seed's nudge on its own. If seed 0 were hashed like any other, the difference would
-- be the gap between two nudges and this would not hold for any seed.
--
-- An earlier version of this case asserted "the newest post leads" instead, which was a
-- consequence rather than the property — and it stopped being true in 20260816020000 for a
-- legitimate reason: engagement began counting for friends' posts too, so an original that
-- has been reposted now outranks the brand-new repost of it.
select pg_temp.assert(
  'seed 0 applies no jitter — a seeded score differs from it by exactly that seed''s nudge',
  (select bool_and(
     abs(
       (seeded.sort_key - plain.sort_key)
       - 0.15 * (hashtextextended(plain.post_id::text, s.seed)::double precision
                 / 9223372036854775807.0)
     ) < 0.000001)
   from (values (7::bigint), (12345::bigint), (99999::bigint)) s(seed)
   cross join lateral public.fetch_home_feed(50, null, null, null, 0, now()) plain
   join lateral public.fetch_home_feed(50, null, null, null, s.seed, now()) seeded
     on seeded.post_id = plain.post_id),
  true);

-- ── 4. Pagination is coherent within a session ──────────────────────────────
-- Every page after the first is compared against a cursor issued from the previous
-- page's scores. If the origin were not frozen, those scores would have moved.
select pg_temp.assert(
  'paging through a session hands out no post twice',
  (select count(*) = count(distinct id) from (
     select unnest(pg_temp.feed_paged(777, 3)) as id
   ) t),
  true);

select pg_temp.assert(
  'and paging visits exactly the posts a single call returns',
  (select array_agg(x order by x) from unnest(pg_temp.feed_paged(777, 3)) x)
    = (select array_agg(x order by x) from unnest(pg_temp.feed_ids(777, 50, now())) x),
  true);

-- ── 5. The frozen origin, and its clamp ─────────────────────────────────────
-- First, that the parameter reaches the scoring at all. Without this the two clamp
-- assertions below would pass trivially — an origin that changed nothing would look
-- "clamped" to every value.
--
-- What this file CANNOT observe: that freezing the origin holds the ranking still
-- ACROSS requests. `now()` is transaction-scoped in Postgres, so inside one test
-- transaction a live now() and a frozen origin are indistinguishable. The effect
-- that matters — page 3 being scored against the same instant page 1 was — only
-- appears across real round-trips.
-- Asserted on the SCORE rather than on the resulting order. An earlier version compared
-- orderings, which passed only because those particular fixtures happened to contain a pair
-- close enough to swap — it went green or red depending on the score weights rather than on
-- whether the origin was wired in at all. FRIEND's post is eight hours old, so moving the
-- origin an hour earlier makes it an hour younger and its freshness term must rise.
select pg_temp.assert(
  'the origin reaches the ranking — moving it back makes an older post score higher',
  pg_temp.score_at('e3000000-0000-0000-0000-0000000000f1', now() - interval '1 hour')
    > pg_temp.score_at('e3000000-0000-0000-0000-0000000000f1', now()),
  true);

-- The clamp itself. This is untrusted input and it is the denominator of the decay.
select pg_temp.assert(
  'an origin far in the future is clamped to now',
  pg_temp.feed_ids(0, 50, now() + interval '10 years')
    = pg_temp.feed_ids(0, 50, now()),
  true);

select pg_temp.assert(
  'an origin far in the past is clamped to one hour ago',
  pg_temp.feed_ids(0, 50, now() - interval '10 years')
    = pg_temp.feed_ids(0, 50, now() - interval '1 hour'),
  true);

-- ── 6. One track does not appear twice in the same page ─────────────────────
-- The repost is the newest post in the feed and its original is the second newest, so
-- without the duplicate penalty they would be the top two cards — the same audio, twice.
select pg_temp.assert_num(
  'a track and its repost do not both make the top three',
  (select count(distinct p.track_id)
     from unnest((pg_temp.feed_ids(0, 50, now()))[1:3]) as u(id)
     join posts p on p.id = u.id)::bigint,
  3);

-- ── 7. One author does not own the page ─────────────────────────────────────
-- FRIEND's only post is OLDER than all eight of PROLIFIC's. Ranked on recency alone it
-- is ninth; the per-author penalty is the whole reason it is not.
select pg_temp.assert(
  'the older post of a quieter author reaches the top of the page',
  array_position(pg_temp.feed_ids(0, 50, now()),
                 'e3000000-0000-0000-0000-0000000000f1'::uuid) <= 4,
  true);

select pg_temp.assert(
  'and one author never holds every one of the top three slots',
  (select count(*) from unnest((pg_temp.feed_ids(0, 50, now()))[1:3]) as u(id)
    join posts p on p.id = u.id
   where p.author_id = 'e1000000-0000-0000-0000-000000000003') < 3,
  true);

-- ── 8. A post old enough to underflow the decay ─────────────────────────────
-- `exp()` raises rather than returning zero past about -709, so an unclamped decay
-- starts throwing for EVERY viewer once any visible post is old enough — roughly a
-- year on the 12-hour constant. The clamp in the migration is what stops that, and
-- this is the only assertion that would notice it being removed.
reset role;
insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('e2000000-0000-0000-0000-0000000000f9', 'e1000000-0000-0000-0000-000000000002',
   'ancient track', 'audio', 'https://example.invalid/f9.mp3')
on conflict do nothing;
insert into posts (id, author_id, kind, track_id, created_at) values
  ('e3000000-0000-0000-0000-0000000000f9', 'e1000000-0000-0000-0000-000000000002',
   'upload', 'e2000000-0000-0000-0000-0000000000f9',
   now() - interval '5 years')
on conflict do nothing;
set local role authenticated;
select pg_temp.set_user('e1000000-0000-0000-0000-000000000001');

-- Scoped to this file's own authors rather than to "last in the whole feed". Security
-- review pointed out the original was coupled to global table state: it passed on a
-- clean database and failed on one carrying unrelated posts. Every suite rolls back so
-- CI was never affected, but an assertion that depends on what else happens to be in
-- the table is not asserting what it says it is.
select pg_temp.assert(
  'a five-year-old post does not make the feed raise, and ranks below every other post here',
  (select bool_and(pg_temp.score_at(p.id, now())
                     > pg_temp.score_at('e3000000-0000-0000-0000-0000000000f9', now()))
     from posts p
    where p.author_id in ('e1000000-0000-0000-0000-000000000002',
                          'e1000000-0000-0000-0000-000000000003')
      and p.id <> 'e3000000-0000-0000-0000-0000000000f9'),
  true);

reset role;
rollback;
