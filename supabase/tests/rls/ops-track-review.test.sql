-- ops_tracks_for_user — an operator reviews the work, blocks notwithstanding.
--
-- THE BUG THIS PINS, which shipped and was caught by eye rather than by a test:
-- /studio/ops showed an artist with 19 tracks, and the review page behind that number said
-- "No uploads". No error, no warning — `tracks_select_authenticated` is block-aware since
-- 20260809000000, RLS silently returns fewer rows, and a block existed between the operator
-- and that artist. The artist's NAME still rendered, because profiles has a
-- shares_conversation_with exception and tracks has none, so the page looked like a
-- perfectly healthy page about somebody with an empty catalogue.
--
-- The properties, all of which fail SILENTLY:
--
--   1. AN OPERATOR SEES THE WORK EVEN WHEN A BLOCK EXISTS. Otherwise any user gets partial
--      control of their own moderation by blocking the reviewer.
--   2. THE LIST AGREES WITH THE ROSTER'S COUNT. Both must be computed under the same
--      authority; a count that links to a page contradicting it reads as data loss.
--   3. NON-OPS GET NOTHING, and get it quietly — the route has no guard, by design.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/ops-track-review.test.sql
--
-- Runs after every migration, in the same ephemeral Postgres as authorization.test.sql.

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

-- DISCARD PLANS for the same reason as first-100-badges.test.sql: is_ops() is STABLE SQL
-- and gets inlined into cached plans carrying whichever auth.uid() body existed at first
-- call, so redefining auth.uid() alone does not take effect.
create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
  discard plans;
end $$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('c2000000-0000-0000-0000-0000000000c1'::uuid, 'reviewer@example.invalid'),
  ('c2000000-0000-0000-0000-00000000000a'::uuid, 'artist@example.invalid'),
  ('c2000000-0000-0000-0000-00000000000b'::uuid, 'nosy@example.invalid');

insert into public.profiles (id, username) values
  ('c2000000-0000-0000-0000-0000000000c1'::uuid, 'reviewer'),
  ('c2000000-0000-0000-0000-00000000000a'::uuid, 'blockedartist'),
  ('c2000000-0000-0000-0000-00000000000b'::uuid, 'nosyuser');

insert into public.ops_users (user_id) values ('c2000000-0000-0000-0000-0000000000c1'::uuid);

-- EXPLICIT, DISTINCT created_at values. Both rows would otherwise take `now()` from the
-- same statement and share a timestamp to the microsecond, leaving `order by created_at
-- desc` free to return either first — an ordering assertion that passes or fails at random.
insert into public.tracks (id, uploader_id, title, media_kind, audio_url, created_at) values
  ('c2000000-0000-0000-0000-0000000000f1'::uuid, 'c2000000-0000-0000-0000-00000000000a'::uuid,
   'First upload',  'audio', 'https://example.invalid/1.mp3', '2026-01-01T00:00:00Z'),
  ('c2000000-0000-0000-0000-0000000000f2'::uuid, 'c2000000-0000-0000-0000-00000000000a'::uuid,
   'Second upload', 'audio', 'https://example.invalid/2.mp3', '2026-02-01T00:00:00Z');

-- The artist blocks the operator. This is the exact production shape, and the direction
-- matters less than it looks: is_blocked_between() is symmetric on purpose.
insert into public.blocked_users (blocker_id, blocked_id) values
  ('c2000000-0000-0000-0000-00000000000a'::uuid, 'c2000000-0000-0000-0000-0000000000c1'::uuid);

-- ── The block really does hide them from an ordinary read ───────────────────
--
-- Asserted FIRST, as the control. Without it, a green suite below would be consistent with
-- the block simply not existing, and the regression this file guards could not be observed.
select pg_temp.set_user('c2000000-0000-0000-0000-0000000000c1'::uuid);
set local role authenticated;
select pg_temp.assert(
  'RLS hides the blocked artist''s tracks from a direct read — this is the trap',
  (select count(*) = 0 from public.tracks
    where uploader_id = 'c2000000-0000-0000-0000-00000000000a'::uuid), true);
reset role;

-- ── …but the operator still reviews them ────────────────────────────────────
--
-- AS `authenticated`, NOT AS THE SESSION USER. `reset role` would return us to postgres,
-- which bypasses RLS unconditionally — so these would pass whether or not the function is
-- DEFINER, and the property under test would be asserted by a pg_proc lookup rather than by
-- the operation. That is the failure mode ci.yml already warns about for the authorization
-- suite: "an earlier version evaluated a hand-written COPY of the predicate and would have
-- passed with the policy reverted".
set local role authenticated;

select pg_temp.assert(
  'ops_tracks_for_user returns both tracks despite the block',
  (select count(*) = 2 from public.ops_tracks_for_user('c2000000-0000-0000-0000-00000000000a'::uuid)), true);

-- Rule 2: this is the number the roster links FROM. If the two ever disagree again, the
-- operator sees a count pointing at a page that contradicts it.
select pg_temp.assert(
  'the list agrees with the roster count ops_users_overview() shows',
  (select (select count(*) from public.ops_tracks_for_user('c2000000-0000-0000-0000-00000000000a'::uuid))
        = (select o.tracks_count from public.ops_users_overview() o
            where o.id = 'c2000000-0000-0000-0000-00000000000a'::uuid)), true);

-- NO `order by` INSIDE array_agg. Sorting here would re-impose the expected order on
-- whatever the function returned, so the assertion would pass with the function's own
-- ORDER BY deleted — or reversed. An unordered array_agg over `return query` preserves the
-- order the rows arrived in, which is the thing being tested.
select pg_temp.assert(
  'newest first, so an operator reads the current work before the old work',
  (select array_agg(t.title) = array['Second upload', 'First upload']
     from public.ops_tracks_for_user('c2000000-0000-0000-0000-00000000000a'::uuid) t), true);

-- THE BEHAVIOURAL ASSERTION ABOVE PINS THE SORT'S DIRECTION, NOT ITS EXISTENCE. With the
-- ORDER BY deleted outright the planner picks tracks_uploader_created_idx, which already
-- yields newest-first, so the rows come back correct BY ACCIDENT and that assertion stays
-- green. Reversing the sort turns it red; removing it does not. This is weaker than a
-- behavioural test and it is not a test that cannot fail.
select pg_temp.assert(
  'and the ordering is explicit rather than inherited from whichever index the planner picks',
  pg_get_functiondef('public.ops_tracks_for_user(uuid)'::regprocedure)
    ilike '%order by t.created_at desc%', true);

-- The artist's IDENTITY, which was the second half of the same bug: `profiles` carries the
-- same block clause `tracks` does, so reading it as the operator renders a page with no
-- name. `shares_conversation_with` masked this in the reported case; these fixtures share
-- no conversation, so the control below is the honest one.
select pg_temp.assert(
  'RLS hides the blocked artist''s PROFILE from a direct read too',
  (select count(*) = 0 from public.profiles
    where id = 'c2000000-0000-0000-0000-00000000000a'::uuid), true);

select pg_temp.assert(
  'but ops_profile_for_user still names them',
  (select username = 'blockedartist' from public.ops_profile_for_user('c2000000-0000-0000-0000-00000000000a'::uuid)), true);

reset role;

-- ── Rule 3: nobody else ─────────────────────────────────────────────────────
select pg_temp.set_user('c2000000-0000-0000-0000-00000000000b'::uuid);
select pg_temp.assert(
  'a signed-in non-ops user gets EMPTY, not an error and not the rows',
  (select count(*) = 0 from public.ops_tracks_for_user('c2000000-0000-0000-0000-00000000000a'::uuid)), true);

-- WEAKER THAN IT LOOKS IN CI, and worth knowing before anyone "simplifies" the revoke pair
-- in the migration. CI's bare Postgres gives `anon` no default privileges, so `revoke all
-- ... from public` alone already satisfies this; the anon-specific revoke is what matters in
-- PRODUCTION, where Supabase grants EXECUTE to anon directly. That one is covered by
-- scripts/check-definer-anon-grants.mjs, not by this line.
select pg_temp.assert(
  'a signed-in non-ops user cannot name the artist either',
  (select count(*) = 0 from public.ops_profile_for_user('c2000000-0000-0000-0000-00000000000a'::uuid)), true);

select pg_temp.assert(
  'anon cannot execute it at all',
  has_function_privilege('anon', 'public.ops_tracks_for_user(uuid)', 'execute'), false);

-- Definer rights are what bypass the block, so the is_ops() gate inside the body is the
-- only thing between this function and every signed-in account.
select pg_temp.assert(
  'it is SECURITY DEFINER',
  (select prosecdef from pg_proc where oid = 'public.ops_tracks_for_user(uuid)'::regprocedure), true);

select pg_temp.assert(
  'and it still checks is_ops()',
  pg_get_functiondef('public.ops_tracks_for_user(uuid)'::regprocedure) ilike '%is_ops()%', true);

-- ── the foundation nothing else pins ────────────────────────────────────────
--
-- is_ops() is DEFINER over `ops_users`, which has RLS enabled and ZERO policies — that is
-- what makes it deny-all. Policies OR together, so a single permissive policy added later
-- in good faith would open the operator roster to everyone and silently make is_ops()
-- meaningless for every function that depends on it. Same failure mode as follows_select.
select pg_temp.assert(
  'ops_users still has no policies — every ops function''s authority rests on this',
  (select count(*) = 0 from pg_policy where polrelid = 'public.ops_users'::regclass), true);

rollback;
