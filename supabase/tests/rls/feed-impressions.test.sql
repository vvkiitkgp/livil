-- post_impressions — the boundary, and the silent-no-op trap.
--
-- PROP-0010 phase 1. What this asserts, and why each one is here rather than assumed:
--
--   · the RPC attributes rows to auth.uid() and nobody else — a caller cannot write
--     somebody else's impressions, because the actor is never a parameter;
--   · the 10-minute rate limit holds, so `seen_count` counts OCCASIONS and not thumb
--     movements. Without it the suppression threshold burns a post inside one sitting;
--   · a client cannot write the table directly — an UPDATE path would let anyone reset
--     their own suppression, which is the one thing the table exists to prevent;
--   · a viewer reads their OWN rows and nobody else's;
--   · THE IMPORTANT ONE — suppression actually fires when `fetch_home_feed` runs as
--     `authenticated`. That function is SECURITY INVOKER, so a missing or wrong SELECT
--     policy makes the impression join read zero rows: the feed still renders, the shape
--     is still right, and the suppression silently does nothing. Every case below runs
--     under `set local role authenticated` for exactly that reason — as the table owner
--     RLS is bypassed and the test would pass while the feature is broken;
--   · suppression DEMOTES rather than drops (tier 4, still returned), so an active
--     viewer cannot be shown an empty feed. `feed_bucket` carries ONE distinction since
--     20260816020000 — 1 = ranked normally, 4 = seen enough — because affinity moved into
--     the score and only suppression still needs to beat every score outright;
--   · engagement — a play OR a like — exempts a post from suppression;
--   · one viewer's suppression does not touch another's feed.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/feed-impressions.test.sql
--
-- Exercises the database, not PostgREST (P32).

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

-- SECURITY DEFINER so it works whatever role is assumed — replacing auth.uid() needs
-- CREATE on schema auth, which `authenticated` does not have.
--
-- `DISCARD PLANS` is load-bearing (the lesson recorded in search-analytics.test.sql):
-- auth.uid() is inlined into cached plans, so without this the first user switch is the
-- only one that takes effect and every later assertion silently tests the first user.
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

-- The bucket the CURRENT viewer's feed puts a post in, or NULL if the feed does not
-- return it at all. SECURITY INVOKER (the default) — that is the whole point.
create or replace function pg_temp.bucket_of(p uuid)
returns integer language sql stable as $$
  select f.feed_bucket from public.fetch_home_feed(50) f where f.post_id = p;
$$;

-- Ages a pair past the RPC's rate-limit window. Runs as the table owner, because there
-- is deliberately no client UPDATE policy.
create or replace function pg_temp.age_impression(u uuid, p uuid, mins int)
returns void language plpgsql security definer as $$
begin
  update public.post_impressions
     set last_seen_at = now() - make_interval(mins => mins)
   where user_id = u and post_id = p;
end $$;

grant usage on schema auth to authenticated;

-- ── Fixtures (inserted as the table owner → RLS not applied to the setup) ────
-- VIEWER is the subject. OTHER proves suppression is per-person. AUTHOR posts three
-- uploads: one the viewer ignores, one they play, one they like.
insert into auth.users (id) values
  ('f1000000-0000-0000-0000-000000000001'),  -- VIEWER
  ('f1000000-0000-0000-0000-000000000002'),  -- OTHER
  ('f1000000-0000-0000-0000-000000000003')   -- AUTHOR
on conflict do nothing;

insert into profiles (id, username, username_set) values
  ('f1000000-0000-0000-0000-000000000001', 'fi_viewer', true),
  ('f1000000-0000-0000-0000-000000000002', 'fi_other',  true),
  ('f1000000-0000-0000-0000-000000000003', 'fi_author', true)
on conflict do nothing;

insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('f2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000003',
   'fi track', 'audio', 'https://example.invalid/fi.mp3')
on conflict do nothing;

-- Uploads, not reposts: posts_select_authenticated gates reposts on friendship, and a
-- visibility failure here would look exactly like a suppression success.
insert into posts (id, author_id, kind, track_id) values
  ('f3000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000003',
   'upload', 'f2000000-0000-0000-0000-000000000001'),   -- IGNORED  → should be suppressed
  ('f3000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000003',
   'upload', 'f2000000-0000-0000-0000-000000000001'),   -- PLAYED   → exempt
  ('f3000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000003',
   'upload', 'f2000000-0000-0000-0000-000000000001')    -- LIKED    → exempt
on conflict do nothing;

-- ── 1. The writer attributes to auth.uid(), and rate-limits ─────────────────
set local role authenticated;
select pg_temp.set_user('f1000000-0000-0000-0000-000000000001');

select public.record_post_impressions(array['f3000000-0000-0000-0000-000000000001']::uuid[]);

select pg_temp.assert_num(
  'first flush records one occasion',
  (select seen_count from public.post_impressions
    where user_id = 'f1000000-0000-0000-0000-000000000001'
      and post_id = 'f3000000-0000-0000-0000-000000000001')::bigint,
  1);

-- Scrolling the same card back into view seconds later is the SAME exposure.
select public.record_post_impressions(array['f3000000-0000-0000-0000-000000000001']::uuid[]);
select public.record_post_impressions(array['f3000000-0000-0000-0000-000000000001']::uuid[]);

select pg_temp.assert_num(
  'a second look inside 10 minutes does not count again',
  (select seen_count from public.post_impressions
    where user_id = 'f1000000-0000-0000-0000-000000000001'
      and post_id = 'f3000000-0000-0000-0000-000000000001')::bigint,
  1);

-- A garbage id is dropped rather than raising — the batch is best-effort and must never
-- fail the flush for the ids that are real.
select public.record_post_impressions(
  array['f3000000-0000-0000-0000-0000000000ff']::uuid[]);
select pg_temp.assert_num(
  'an unknown post id writes nothing and does not raise',
  (select count(*) from public.post_impressions
    where user_id = 'f1000000-0000-0000-0000-000000000001')::bigint,
  1);

-- ── 2. Separate occasions accumulate ────────────────────────────────────────
reset role;
select pg_temp.age_impression(
  'f1000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', 20);
set local role authenticated;
select public.record_post_impressions(array['f3000000-0000-0000-0000-000000000001']::uuid[]);

reset role;
select pg_temp.age_impression(
  'f1000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', 20);
set local role authenticated;
select public.record_post_impressions(array['f3000000-0000-0000-0000-000000000001']::uuid[]);

select pg_temp.assert_num(
  'three separate occasions reach the suppression threshold',
  (select seen_count from public.post_impressions
    where user_id = 'f1000000-0000-0000-0000-000000000001'
      and post_id = 'f3000000-0000-0000-0000-000000000001')::bigint,
  3);

-- ── 3. No client write path ─────────────────────────────────────────────────
select pg_temp.assert(
  'a client cannot insert impressions directly',
  pg_temp.allows($$insert into public.post_impressions (user_id, post_id)
                   values ('f1000000-0000-0000-0000-000000000001',
                           'f3000000-0000-0000-0000-000000000002')$$),
  false);

-- An UPDATE with no policy does not raise — RLS filters it to zero rows. Asserting the
-- absence of an error would prove nothing; the stored value is the proof.
update public.post_impressions set seen_count = 0
 where user_id = 'f1000000-0000-0000-0000-000000000001';

select pg_temp.assert_num(
  'a client cannot reset its own suppression',
  (select seen_count from public.post_impressions
    where user_id = 'f1000000-0000-0000-0000-000000000001'
      and post_id = 'f3000000-0000-0000-0000-000000000001')::bigint,
  3);

-- ── 4. Own rows only ────────────────────────────────────────────────────────
select pg_temp.assert_num(
  'the viewer reads their own impressions',
  (select count(*) from public.post_impressions)::bigint,
  1);

select pg_temp.set_user('f1000000-0000-0000-0000-000000000002');
select pg_temp.assert_num(
  'another account reads none of them',
  (select count(*) from public.post_impressions)::bigint,
  0);

-- ── 5. Suppression fires, and DEMOTES rather than drops ─────────────────────
select pg_temp.set_user('f1000000-0000-0000-0000-000000000001');

select pg_temp.assert_num(
  'a post seen three times and never acted on lands in bucket 4',
  pg_temp.bucket_of('f3000000-0000-0000-0000-000000000001')::bigint,
  4);

select pg_temp.assert(
  'and is still returned — demoted, never dropped',
  pg_temp.bucket_of('f3000000-0000-0000-0000-000000000001') is not null,
  true);

-- ── 6. Engagement exempts ───────────────────────────────────────────────────
-- Both posts are pushed well past the threshold, so anything other than the exemption
-- keeping them out of bucket 4 would have to be an accident.
reset role;
insert into public.post_impressions (user_id, post_id, seen_count, last_seen_at) values
  ('f1000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000002',
   9, now()),
  ('f1000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000003',
   9, now())
on conflict (user_id, post_id) do update set seen_count = excluded.seen_count;

insert into public.post_views (post_id, user_id) values
  ('f3000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001')
on conflict do nothing;

insert into public.post_likes (post_id, user_id) values
  ('f3000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000001')
on conflict do nothing;

set local role authenticated;
select pg_temp.set_user('f1000000-0000-0000-0000-000000000001');

-- This is the assertion that fails if post_views has no own-row SELECT policy: the
-- invoker reads zero rows, the play is invisible, and the post is suppressed anyway.
select pg_temp.assert_num(
  'a post the viewer PLAYED is never suppressed',
  pg_temp.bucket_of('f3000000-0000-0000-0000-000000000002')::bigint,
  1);

select pg_temp.assert_num(
  'a post the viewer LIKED is never suppressed',
  pg_temp.bucket_of('f3000000-0000-0000-0000-000000000003')::bigint,
  1);

-- ── 7. Suppression is per-person ────────────────────────────────────────────
select pg_temp.set_user('f1000000-0000-0000-0000-000000000002');

select pg_temp.assert_num(
  'the same post is untouched in another account''s feed',
  pg_temp.bucket_of('f3000000-0000-0000-0000-000000000001')::bigint,
  1);

-- ── 8. The post_views read boundary ─────────────────────────────────────────
-- 20260816000000 gave post_views an own-row SELECT policy, reopening a table that
-- 20260804050000 had closed COMPLETELY — it is a full listening history, "a sleep
-- schedule, a work schedule, a taste profile and a co-listening graph" in that
-- migration's words.
--
-- Security review found nothing in the repo would have caught it being widened again:
-- replacing the policy with `using (true)`, or adding an anon-readable one, passed
-- every suite. The read boundary was asserted nowhere — authorization.test.sql covers
-- only the WRITE path. Dropping the policy was caught; WIDENING it was not, and
-- widening is the direction the original vulnerability went.
--
-- Placed here, and not with the other own-rows case above, for a reason worth keeping:
-- the viewer's post_views row is not inserted until section 6, so asserting this
-- earlier would compare zero against zero and pass with the policy wide open.
select pg_temp.assert_num(
  'the viewer''s own plays exist to be read',
  (select count(*) from public.post_views)::bigint,
  0);   -- as OTHER: own-row policy, and OTHER has played nothing

select pg_temp.set_user('f1000000-0000-0000-0000-000000000001');
select pg_temp.assert_num(
  'the viewer reads their own play',
  (select count(*) from public.post_views)::bigint,
  1);

select pg_temp.set_user('f1000000-0000-0000-0000-000000000002');
select pg_temp.assert_num(
  'and another account reads none of them, named explicitly',
  (select count(*) from public.post_views
    where user_id = 'f1000000-0000-0000-0000-000000000001')::bigint,
  0);

select pg_temp.assert_num(
  'nor through a join on posts',
  (select count(*) from public.post_views pv
     join public.posts p on p.id = pv.post_id)::bigint,
  0);

-- AS ANON, which is a separate question and was initially missed: RLS policies are
-- OR-ed and scoped per role, so adding a permissive `TO anon` policy alongside the
-- own-row one leaves every authenticated assertion above green while opening the table
-- to the anon key that ships inside the app. CI grants anon SELECT on every table, so
-- only the policy set stands between anon and this data — which is the point.
set local role anon;
select pg_temp.assert_num(
  'and anon reads nothing from post_views at all',
  (select count(*) from public.post_views)::bigint,
  0);
set local role authenticated;

reset role;
rollback;
