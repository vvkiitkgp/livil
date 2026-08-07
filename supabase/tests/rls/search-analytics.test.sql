-- Search tap analytics — the boundary, not the happy path.
--
-- Asserts the properties this table's design rests on:
--   - a client may record its OWN taps and nobody else's (forged user_ids would be forged
--     votes, because the aggregate counts distinct people);
--   - NO client can read the rows, at all — the privacy design is "write-only from the
--     client's point of view", and it is a no-SELECT-policy, not a narrow policy;
--   - the aggregate is ops-only and returns EMPTY, not an error, for everybody else;
--   - one person tapping fifty times does not outrank fifty people tapping once.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/search-analytics.test.sql
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

-- SECURITY DEFINER so it works whatever role is assumed — replacing auth.uid() needs CREATE
-- on schema auth, which `authenticated` does not have. (The lesson from LIV-93: without this
-- the first `set local role` poisons every later switch and the file aborts mid-way.)
--
-- `DISCARD PLANS` is load-bearing, and cost an hour to find. `auth.uid()` and `is_ops()` are
-- SQL functions, so Postgres INLINES them into the calling plan — and plpgsql caches that
-- plan. The first call to a gated function therefore bakes the CURRENT auth.uid() body into
-- the cache; replacing the function afterwards does not rebuild it, so every later call in
-- the session still sees the FIRST user. Concretely: assert "a non-ops caller gets empty",
-- then switch to an ops user, and the ops call still returns empty — the gate looks broken
-- while being correct.
--
-- This is a property of the HARNESS, not the product: nothing in production redefines
-- auth.uid() mid-session (it reads a request GUC). Any test file that switches users and
-- calls the same SECURITY DEFINER function twice needs this.
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

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('5a000000-0000-0000-0000-000000000001', 'ops@example.invalid'),
  ('5a000000-0000-0000-0000-000000000002', 'listener@example.invalid'),
  ('5a000000-0000-0000-0000-000000000003', 'other@example.invalid');

insert into profiles (id, username, username_set) values
  ('5a000000-0000-0000-0000-000000000001', 'sa_ops', true),
  ('5a000000-0000-0000-0000-000000000002', 'sa_listener', true),
  ('5a000000-0000-0000-0000-000000000003', 'sa_other', true);

insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('5a000000-0000-0000-0000-0000000000a1',
   '5a000000-0000-0000-0000-000000000001', 'Popular Song', 'audio', 'https://example.invalid/a.mp3'),
  ('5a000000-0000-0000-0000-0000000000a2',
   '5a000000-0000-0000-0000-000000000001', 'Spammed Song', 'audio', 'https://example.invalid/b.mp3');

insert into ops_users (user_id) values ('5a000000-0000-0000-0000-000000000001');

-- Ranking data, seeded here rather than mid-file: two people open "Popular Song" once each,
-- one person opens "Spammed Song" five times. Seeding it as the owner up front keeps the
-- file free of a mid-run `reset role`, which made the later role/uid state hard to reason
-- about — and a test whose own setup is confusing is not evidence of anything.
insert into search_result_taps (kind, entity_id, user_id) values
  ('track','5a000000-0000-0000-0000-0000000000a1','5a000000-0000-0000-0000-000000000003'),
  ('track','5a000000-0000-0000-0000-0000000000a2','5a000000-0000-0000-0000-000000000003'),
  ('track','5a000000-0000-0000-0000-0000000000a2','5a000000-0000-0000-0000-000000000003'),
  ('track','5a000000-0000-0000-0000-0000000000a2','5a000000-0000-0000-0000-000000000003'),
  ('track','5a000000-0000-0000-0000-0000000000a2','5a000000-0000-0000-0000-000000000003'),
  ('track','5a000000-0000-0000-0000-0000000000a2','5a000000-0000-0000-0000-000000000003');

-- ── 1. A client records its own taps, and only its own ──────────────────────
select pg_temp.set_user('5a000000-0000-0000-0000-000000000002');
set local role authenticated;

select pg_temp.assert(
  'a listener can record their own tap',
  pg_temp.allows($$insert into search_result_taps (kind, entity_id, user_id)
                   values ('track','5a000000-0000-0000-0000-0000000000a1',
                           '5a000000-0000-0000-0000-000000000002')$$), true);

-- Forged attribution is the attack that matters here: the aggregate counts DISTINCT users,
-- so writing rows under other people's ids is how you would manufacture a chart position.
select pg_temp.assert(
  'a listener canNOT record a tap as somebody else',
  pg_temp.allows($$insert into search_result_taps (kind, entity_id, user_id)
                   values ('track','5a000000-0000-0000-0000-0000000000a1',
                           '5a000000-0000-0000-0000-000000000003')$$), false);

-- ── 2. Nobody can read the rows ─────────────────────────────────────────────
-- Not "sees only their own" — sees NOTHING. RLS is on with no SELECT policy at all, which
-- is the privacy design rather than an omission.
select pg_temp.assert(
  'the tapper cannot read back even their OWN tap rows',
  (select count(*) = 0 from search_result_taps), true);

select pg_temp.assert(
  'a tap row cannot be edited',
  pg_temp.allows($$update search_result_taps set kind = 'album'$$), true);
select pg_temp.assert(
  '...and the update matched nothing, because no row is visible or writable',
  (select count(*) = 0 from search_result_taps where kind = 'album'), true);

-- ── 3. The aggregate is ops-only ────────────────────────────────────────────
select pg_temp.assert(
  'a non-ops caller gets EMPTY, not an error',
  (select count(*) = 0 from ops_top_search_results('track', 30, 20)), true);

-- ── 4. Distinct people beat repeat taps ─────────────────────────────────────
select pg_temp.set_user('5a000000-0000-0000-0000-000000000001');
set local role authenticated;

select pg_temp.assert(
  'ops sees results',
  (select count(*) > 0 from ops_top_search_results('track', 30, 20)), true);

-- The anti-gaming property, stated as a test: 2 people once each outranks 1 person 5 times.
select pg_temp.assert(
  'the song two people opened ranks above the one person tapped five times',
  (select title = 'Popular Song' from ops_top_search_results('track', 30, 20) limit 1), true);

select pg_temp.assert(
  'the spammed song reports 1 person despite 5 taps',
  (select people = 1 and taps = 5 from ops_top_search_results('track', 30, 20)
    where title = 'Spammed Song'), true);

-- ── 5. Bounds are enforced, not trusted ─────────────────────────────────────
select pg_temp.assert(
  'an absurd limit is clamped rather than run',
  (select count(*) <= 100 from ops_top_search_results('track', 30, 100000)), true);

select pg_temp.assert(
  'a zero/negative window does not error',
  (select count(*) >= 0 from ops_top_search_results('track', -5, 20)), true);

rollback;
