-- ============================================================================
-- Stories hardening tests — PROP-0004 / ADR-0009, against the REAL policies
-- ============================================================================
--
-- WHY THIS EXISTS
--
-- RLS is the entire authorization perimeter (ADR-0004). Stories shipped with the
-- D-53 "client validation is not RLS" shape: stories_insert was
-- `with check (author_id = auth.uid())` only, so a raw PostgREST client could
--   * send `expires_at: '2099-01-01'` → a PERMANENTLY visible story (stories_select
--     gates on `expires_at > now()`), and
--   * forge track_id / original_post_id with no linkage or kind='upload' check
--     (createStory validates those client-side only, and the client is bypassable).
--
-- These tests attempt REAL writes/reads as the `authenticated` role, so the DEPLOYED
-- trigger + policy are what allow or deny. Verify the PROPERTY ("a client-supplied
-- expiry does not survive", "an unlinked repost is rejected"), not the change.
--
-- HOW TO RUN — against the ephemeral Postgres in CI, after all migrations are
-- applied and the app roles are granted table access:
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/stories-harden.test.sql
-- ============================================================================

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

-- auth.uid() is stubbed per-case because there is no JWT in this context.
create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
end $$;

-- Runs a statement as the CURRENT role and reports whether the database allowed it.
-- SECURITY INVOKER (default), so `set local role authenticated` is respected and RLS
-- applies exactly as it would to a PostgREST request. A WITH CHECK violation raises
-- insufficient_privilege (42501) → false.
create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when insufficient_privilege then return false;
  when unique_violation      then return true;   -- allowed; the row simply existed
end $$;

-- Real Supabase grants `authenticated` USAGE on the auth schema; the bare-Postgres
-- CI shim (ci.yml) does not. Step 3 calls list_active_stories() as authenticated, and
-- because it is a STABLE SQL function the planner INLINES it into the caller's query,
-- re-resolving auth.uid() in the caller's context — which then needs auth-schema usage.
-- Granting it here makes the environment faithful to production; it weakens no policy
-- (auth.uid() is meant to be callable by authenticated) and is rolled back with the txn.
grant usage on schema auth to authenticated;

-- ── Fixtures (inserted as the table owner → RLS not applied to the setup) ────
insert into auth.users (id) values
  ('10000000-0000-0000-0000-000000000001'),  -- storyteller / author
  ('10000000-0000-0000-0000-000000000002')   -- a second uploader
on conflict do nothing;

insert into profiles (id, username, username_set) values
  ('10000000-0000-0000-0000-000000000001', 'storyteller', true),
  ('10000000-0000-0000-0000-000000000002', 'uploader2',   true)
on conflict do nothing;

-- Two tracks by the author, so we can build an insert whose track_id does NOT match
-- its original_post_id's track_id.
insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('20000000-0000-0000-0000-00000000000a',
   '10000000-0000-0000-0000-000000000001', 'Track A', 'audio', 'https://x/a.mp3'),
  ('20000000-0000-0000-0000-00000000000b',
   '10000000-0000-0000-0000-000000000001', 'Track B', 'audio', 'https://x/b.mp3')
on conflict do nothing;

-- P1: a genuine UPLOAD of Track A (the legitimate story target).
insert into posts (id, author_id, kind, track_id) values
  ('30000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'upload',
   '20000000-0000-0000-0000-00000000000a')
on conflict do nothing;

-- P2: a REPOST (kind <> 'upload') of Track A — used to prove a story cannot hang
-- off a non-upload post even when the track_id matches.
insert into posts (id, author_id, kind, track_id, original_post_id) values
  ('30000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001', 'repost',
   '20000000-0000-0000-0000-00000000000a',
   '30000000-0000-0000-0000-000000000001')
on conflict do nothing;

-- ============================================================================
-- Step 1 — expires_at is pinned server-side (the trigger overwrites the client)
-- ============================================================================
-- An ordinary authenticated author inserts a story with a 10-year expiry against a
-- perfectly legitimate target. The BEFORE INSERT trigger must overwrite it.
select pg_temp.set_user('10000000-0000-0000-0000-000000000001');
set local role authenticated;

insert into stories (id, author_id, track_id, original_post_id,
                     clip_start_sec, clip_end_sec, expires_at)
values ('40000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-00000000000a',
        '30000000-0000-0000-0000-000000000001',
        0, 5,
        now() + interval '10 years');

reset role;  -- read the stored value as the owner, bypassing stories_select

-- now() is the transaction start time and is constant across this test, so the pinned
-- value equals now()+24h exactly; allow a small slack for defensiveness.
select pg_temp.assert(
  'step 1: a client-supplied expires_at is overwritten to ~now()+24h',
  (select abs(extract(epoch from (expires_at - (now() + interval '24 hours')))) < 120
     from stories where id = '40000000-0000-0000-0000-000000000001'),
  true);

select pg_temp.assert(
  'step 1: the client''s 10-year expires_at was NOT stored',
  (select expires_at > now() + interval '365 days'
     from stories where id = '40000000-0000-0000-0000-000000000001'),
  false);

-- ============================================================================
-- Step 2 — stories_insert enforces the repost linkage (track + kind='upload')
-- ============================================================================
select pg_temp.set_user('10000000-0000-0000-0000-000000000001');
set local role authenticated;

-- (a) track_id does NOT match original_post_id's track_id → rejected.
--     original_post_id = P1 (Track A), but the story claims Track B.
select pg_temp.assert(
  'step 2a: an insert whose track_id != original_post_id.track_id is REJECTED',
  pg_temp.allows($$insert into stories
      (id, author_id, track_id, original_post_id, clip_start_sec, clip_end_sec)
    values ('40000000-0000-0000-0000-0000000000a1',
            '10000000-0000-0000-0000-000000000001',
            '20000000-0000-0000-0000-00000000000b',
            '30000000-0000-0000-0000-000000000001', 0, 5)$$),
  false);

-- (b) original_post_id.kind <> 'upload' → rejected. Track matches (Track A); the only
--     defect is that P2 is a repost, so this isolates the kind check.
select pg_temp.assert(
  'step 2b: an insert whose original_post_id.kind <> ''upload'' is REJECTED',
  pg_temp.allows($$insert into stories
      (id, author_id, track_id, original_post_id, clip_start_sec, clip_end_sec)
    values ('40000000-0000-0000-0000-0000000000b1',
            '10000000-0000-0000-0000-000000000001',
            '20000000-0000-0000-0000-00000000000a',
            '30000000-0000-0000-0000-000000000002', 0, 5)$$),
  false);

-- (c) a legitimate createStory()-shaped insert (upload P1, matching Track A) SUCCEEDS.
select pg_temp.assert(
  'step 2c: a legitimate story insert (upload + matching track) is ALLOWED',
  pg_temp.allows($$insert into stories
      (id, author_id, track_id, original_post_id, clip_start_sec, clip_end_sec)
    values ('40000000-0000-0000-0000-0000000000c1',
            '10000000-0000-0000-0000-000000000001',
            '20000000-0000-0000-0000-00000000000a',
            '30000000-0000-0000-0000-000000000001', 0, 5)$$),
  true);

-- Cross-check: neither rejected row exists; the allowed one does.
select pg_temp.assert(
  'step 2: the two rejected inserts left no row behind',
  exists(select 1 from stories where id in
    ('40000000-0000-0000-0000-0000000000a1',
     '40000000-0000-0000-0000-0000000000b1')),
  false);
select pg_temp.assert(
  'step 2: the legitimate insert persisted',
  exists(select 1 from stories where id = '40000000-0000-0000-0000-0000000000c1'),
  true);

reset role;

-- ============================================================================
-- Step 3 — list_active_stories() is bounded by its LIMIT
-- ============================================================================
-- Seed 201 eligible stories for the author (all valid targets), so that WITHOUT the
-- LIMIT the RPC would return >200. The trigger pins each expires_at to now()+24h, so
-- all are active; stories_select shows an author their own stories.
insert into stories (author_id, track_id, original_post_id, clip_start_sec, clip_end_sec)
select '10000000-0000-0000-0000-000000000001',
       '20000000-0000-0000-0000-00000000000a',
       '30000000-0000-0000-0000-000000000001',
       0, 5
from generate_series(1, 201);

select pg_temp.set_user('10000000-0000-0000-0000-000000000001');
set local role authenticated;

-- The property: no more than the LIMIT is ever returned.
select pg_temp.assert(
  'step 3: list_active_stories() returns no more than the LIMIT of 200',
  (select count(*) <= 200 from public.list_active_stories()),
  true);

-- And the LIMIT actually truncates — >200 rows are eligible, so a removed LIMIT would
-- return more than 200. Exactly 200 proves it is doing work, not passing vacuously.
select pg_temp.assert(
  'step 3: exactly 200 rows come back when >200 are eligible (LIMIT truncates)',
  (select count(*) = 200 from public.list_active_stories()),
  true);

reset role;

rollback;
