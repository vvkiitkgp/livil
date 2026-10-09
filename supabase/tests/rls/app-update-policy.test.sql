-- App update prompt policy (20261018000000).
--
-- Pins: (1) everyone can READ it — signed out too, so a blocking update reaches the
-- sign-in screen; (2) no client can write it; (3) the constraints that keep a typo in the
-- dashboard from blocking everyone; (4) edits are stamped with the server clock.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/app-update-policy.test.sql

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

create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when others then return false;
end $$;

-- Row-count variant: RLS refuses UPDATE/DELETE by matching nothing, not by raising.
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

-- ── 0. Seeded, inert ────────────────────────────────────────────────────────
select pg_temp.assert('0a  one row per platform, seeded at 0 / 0 (no prompt for anyone)',
  (select count(*) = 2 and bool_and(latest_build = 0 and minimum_build = 0 and message is null)
     from app_update_policy where platform in ('ios', 'android')), true);

-- ── 1. Everyone reads ───────────────────────────────────────────────────────
set local role anon;
select pg_temp.assert('1a  signed out: reads both rows',
  (select count(*) = 2 from app_update_policy), true);
reset role;
set local role authenticated;
select pg_temp.assert('1b  signed in: reads both rows',
  (select count(*) = 2 from app_update_policy), true);
reset role;

-- ── 2. Nobody writes from a client ──────────────────────────────────────────
set local role authenticated;
select pg_temp.assert('2a  signed in: cannot raise the minimum (would lock everyone out)',
  pg_temp.rows_affected($q$update app_update_policy set latest_build = 999, minimum_build = 999$q$) <= 0, true);
select pg_temp.assert('2b  signed in: cannot add a platform',
  pg_temp.allows($q$insert into app_update_policy (platform) values ('web')$q$), false);
select pg_temp.assert('2c  signed in: cannot delete a row',
  pg_temp.rows_affected($q$delete from app_update_policy$q$) <= 0, true);
reset role;
set local role anon;
select pg_temp.assert('2d  signed out: cannot change it either',
  pg_temp.rows_affected($q$update app_update_policy set minimum_build = 999$q$) <= 0, true);
reset role;
select pg_temp.assert('2e  …and nothing changed',
  (select bool_and(latest_build = 0 and minimum_build = 0) from app_update_policy), true);

-- ── 3. Dashboard typos are refused ──────────────────────────────────────────
select pg_temp.assert('3a  minimum above latest is refused',
  pg_temp.allows($q$update app_update_policy set latest_build = 77, minimum_build = 78 where platform = 'ios'$q$), false);
select pg_temp.assert('3b  a negative build is refused',
  pg_temp.allows($q$update app_update_policy set latest_build = -1 where platform = 'ios'$q$), false);
select pg_temp.assert('3c  an unknown platform is refused',
  pg_temp.allows($q$insert into app_update_policy (platform) values ('windows')$q$), false);
select pg_temp.assert('3d  an empty message is refused (NULL means "default text")',
  pg_temp.allows($q$update app_update_policy set message = '' where platform = 'ios'$q$), false);
select pg_temp.assert('3e  a sensible edit is accepted',
  pg_temp.allows($q$update app_update_policy set latest_build = 77, minimum_build = 0,
    message = 'Spotify reposts are here' where platform = 'android'$q$), true);

-- ── 4. Server clock on edit ─────────────────────────────────────────────────
update app_update_policy set updated_at = '2001-01-01' where platform = 'ios';
select pg_temp.assert('4   updated_at is the server clock, whatever the edit says',
  (select updated_at = now() from app_update_policy where platform = 'ios'), true);

rollback;
