-- profiles.guide_seen_at — the first-run guide's "already seen" stamp.
--
-- What this proves:
--   1. The owner can stamp their OWN row (the client writes it on finish/skip).
--   2. A stranger cannot stamp someone else's row — nor clear it to force the tour
--      back onto them. Paired with a read of the stored value, because an UPDATE
--      filtered out by profiles_update_own's USING raises nothing.
--   3. The stamp does not disturb the counter freeze: writing guide_seen_at alone
--      is accepted at trigger depth 1.
--
-- Runs as `authenticated` against the deployed policy, so what allows or denies here is
-- the database, not application code.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/first-run-guide.test.sql
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

create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
end $$;

grant usage on schema auth to authenticated;

-- ── Fixtures (as the table owner → RLS not applied to the setup) ────────────
insert into auth.users (id) values
  ('c1111111-0000-0000-0000-000000000001'),  -- NEWCOMER (guide not yet seen)
  ('c1111111-0000-0000-0000-000000000002')   -- STRANGER
on conflict do nothing;

insert into profiles (id, username, username_set, guide_seen_at) values
  ('c1111111-0000-0000-0000-000000000001', 'frg_newcomer', true, null),
  ('c1111111-0000-0000-0000-000000000002', 'frg_stranger', true, now())
on conflict do nothing;

-- The fixture insert is the only thing that leaves a NULL: the migration stamps every
-- pre-existing row, so a real newcomer's NULL comes from handle_new_user() only.
select pg_temp.assert('newcomer starts unstamped',
  (select guide_seen_at is null from profiles where id = 'c1111111-0000-0000-0000-000000000001'),
  true);

-- ── 1. Owner stamps their own row ───────────────────────────────────────────
-- auth.uid() is swapped as the superuser, THEN the role is assumed for the statement
-- under test, then reset so the assertion reads the stored row without RLS in the way.
select pg_temp.set_user('c1111111-0000-0000-0000-000000000001');
set local role authenticated;

update profiles set guide_seen_at = now() where id = 'c1111111-0000-0000-0000-000000000001';

reset role;
select pg_temp.assert('owner can stamp guide_seen_at',
  (select guide_seen_at is not null from profiles where id = 'c1111111-0000-0000-0000-000000000001'),
  true);

-- ── 2. Stranger cannot clear it (force the tour back on) or restamp it ──────
select pg_temp.set_user('c1111111-0000-0000-0000-000000000002');
set local role authenticated;

update profiles set guide_seen_at = null where id = 'c1111111-0000-0000-0000-000000000001';

reset role;
select pg_temp.assert('stranger cannot clear another user''s stamp',
  (select guide_seen_at is not null from profiles where id = 'c1111111-0000-0000-0000-000000000001'),
  true);

select pg_temp.set_user('c1111111-0000-0000-0000-000000000002');
set local role authenticated;

update profiles set guide_seen_at = '2000-01-01'::timestamptz
  where id = 'c1111111-0000-0000-0000-000000000001';

reset role;
select pg_temp.assert('stranger cannot rewrite another user''s stamp',
  (select guide_seen_at > '2000-01-02'::timestamptz from profiles where id = 'c1111111-0000-0000-0000-000000000001'),
  true);

rollback;
