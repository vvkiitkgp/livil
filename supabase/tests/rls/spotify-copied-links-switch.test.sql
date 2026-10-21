-- Copied Spotify link detection kill switch (20261114000000).
--
-- The app asks spotify_copied_links_enabled() and does no clipboard check while it is false.
-- These tests pin: it starts ON; the owner's one-line update turns it off; a missing row
-- reads as off; signed-out callers cannot ask; clients cannot flip it themselves.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/spotify-copied-links-switch.test.sql

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

-- True when the statement succeeded; false when the database refused it for ANY reason.
-- SECURITY INVOKER, so `set local role` is respected.
create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when others then return false;
end $$;

grant usage on schema auth to authenticated;

-- ── 1. Starts ON ────────────────────────────────────────────────────────────
select pg_temp.set_user('c6000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('1   as shipped: the app is told it is on', spotify_copied_links_enabled(), true);

-- ── 2. Clients cannot flip it ───────────────────────────────────────────────
-- Whether this raises depends on table grants (production revokes them; the CI harness
-- re-grants everything), so assert the outcome: RLS with no policies changes no row.
select pg_temp.allows($q$update app_switches set enabled = false where key = 'spotify_copied_links'$q$);
reset role;
select pg_temp.assert('2   a client update left it on',
  (select enabled from app_switches where key = 'spotify_copied_links'), true);

-- ── 3. The owner's switch-off ───────────────────────────────────────────────
select enabled as reposts_before from app_switches where key = 'spotify_reposts' \gset
update public.app_switches set enabled = false, updated_at = now()
 where key = 'spotify_copied_links';
set local role authenticated;
select pg_temp.assert('3   switched OFF: the app is told it is off', spotify_copied_links_enabled(), false);
select pg_temp.assert('3a  … and Spotify reposts are untouched',
  spotify_reposts_enabled(), :'reposts_before'::boolean);
reset role;

-- ── 4. No row reads as off ──────────────────────────────────────────────────
delete from app_switches where key = 'spotify_copied_links';
set local role authenticated;
select pg_temp.assert('4   no row: off', spotify_copied_links_enabled(), false);
reset role;

-- ── 5. Signed-out callers cannot ask ────────────────────────────────────────
set local role anon;
select pg_temp.assert('5   anon cannot call it',
  pg_temp.allows('select public.spotify_copied_links_enabled()'), false);
reset role;

rollback;
