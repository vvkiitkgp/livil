-- ============================================================================
-- SECURITY DEFINER search_path lint — no DEFINER function may be left unpinned
-- ============================================================================
--
-- WHY THIS EXISTS
--
-- A SECURITY DEFINER function with no pinned `search_path` resolves unqualified names
-- using the CALLER's search_path — the standard Postgres privilege-escalation shape,
-- and the whole of LIV-11 finding #2. LIV-10 pinned it on the functions it touched and
-- LIV-11 pinned it on the rest; this test is the ratchet that keeps it pinned. A new
-- DEFINER function added without `set search_path = ...` fails CI here, on the migration
-- that introduces it, rather than months later in an audit.
--
-- It asserts the PROPERTY ("every DEFINER function in public pins search_path"), not a
-- list of names — so it needs no maintenance as functions come and go, and it cannot be
-- satisfied by pinning some other GUC: the predicate requires a `search_path=` entry.
--
-- SCOPE — what this lint does and does NOT guarantee. It asserts a search_path IS pinned.
-- It does NOT assert the pin is pg_temp-shadow-safe: `= public` passes, yet pg_temp is
-- searched before `public` for table names unless listed later, and TEMPORARY is granted
-- to PUBLIC on this project. Closing that is a repo-wide follow-up (standardise on
-- `search_path = ''` with qualified identifiers); tightening this predicate to require it
-- must land in the same change, or it would fail on the 40 existing `= public` functions.
--
-- HOW TO RUN — against the ephemeral Postgres in CI, after all migrations are applied:
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/definer-search-path.test.sql
-- ============================================================================

\set ON_ERROR_STOP on
begin;

do $$
declare
  v_bad text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as c
      where c like 'search\_path=%'
    );

  if v_bad is not null then
    raise exception 'FAIL  SECURITY DEFINER function(s) in public with no pinned search_path: %', v_bad;
  end if;

  raise notice 'ok    every SECURITY DEFINER function in public pins search_path';
end $$;

rollback;
