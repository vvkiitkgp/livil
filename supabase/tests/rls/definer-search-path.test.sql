-- ============================================================================
-- SECURITY DEFINER search_path lint — every DEFINER function must be pg_temp-shadow-safe
-- ============================================================================
--
-- WHY THIS EXISTS
--
-- A SECURITY DEFINER function with no pinned `search_path` resolves unqualified names
-- using the CALLER's search_path — the standard Postgres privilege-escalation shape,
-- and the whole of LIV-11 finding #2. LIV-10 pinned it on the functions it touched and
-- LIV-11 pinned it on the rest; this test is the ratchet that keeps it pinned. A new
-- DEFINER function added without a safe `set search_path = ...` fails CI here, on the
-- migration that introduces it, rather than months later in an audit.
--
-- It asserts a PROPERTY, not a list of names — so it needs no maintenance as functions
-- come and go, and it cannot be satisfied by pinning some other GUC.
--
-- WHAT "SAFE" MEANS HERE — TIGHTENED BY LIV-16.
--
-- Pinning is necessary but NOT sufficient. `search_path = public` closes the schema-
-- shadowing form (the path is fixed, so a caller cannot prepend a schema), but NOT the
-- pg_temp RELATION-shadowing form: Postgres searches the session temp schema FIRST for
-- table/type names whenever pg_temp is not itself listed in the path, and TEMPORARY is
-- granted to PUBLIC on this project. So a caller can create an empty `pg_temp.<name>`
-- that shadows a `public` table a DEFINER body reads unqualified. (Reproduced on the
-- pre-LIV-16 schema: is_username_available('taken') flips from false to true once a
-- `pg_temp.profiles` exists.)
--
-- LIV-16 closes this by forcing pg_temp to be searched LAST — the PostgreSQL manual's own
-- remedy ("write pg_temp as the last entry in search_path"). This lint now requires that.
-- A DEFINER function passes iff it pins a search_path whose LAST entry is `pg_temp`
--   (e.g. `public, pg_temp` or `public, auth, pg_temp`),
-- OR whose value is the empty string `''` — the stricter fully-qualified-identifiers form,
-- which resolves nothing unqualified except pg_catalog and so has no pg_temp exposure. It
-- is accepted so a function can adopt `= ''` later with no change here.
--
-- Both LIV-16's conversion and this tightened predicate land in the same change: before
-- LIV-16 every function ends in `public` (not `pg_temp`), so this predicate flags all of
-- them; the migration is what makes it pass.
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
  -- For each SECURITY DEFINER function in public, extract its pinned search_path value
  -- (the text after `search_path=` in proconfig) and decide whether it is pg_temp-safe:
  --   * value = '' (or the quoted empty forms)             -> safe (fully qualified)
  --   * last comma-separated, trimmed, unquoted token = pg_temp -> safe (pg_temp last)
  --   * anything else (incl. no pinned search_path at all) -> UNSAFE
  select string_agg(proname || ' [' || coalesce(sp_val, 'unpinned') || ']', ', ' order by proname)
    into v_bad
  from (
    select
      p.proname,
      (
        select substring(c from 'search_path=(.*)')
        from unnest(coalesce(p.proconfig, array[]::text[])) as c
        where c like 'search\_path=%'
        limit 1
      ) as sp_val
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  ) f
  where sp_val is null
     or not (
          btrim(sp_val) in ('', '""', '''''')
          or lower(
               btrim(
                 btrim(
                   split_part(
                     btrim(sp_val), ',',
                     array_length(string_to_array(btrim(sp_val), ','), 1)
                   )
                 ),
                 '"'
               )
             ) = 'pg_temp'
        );

  if v_bad is not null then
    raise exception 'FAIL  SECURITY DEFINER function(s) in public not pg_temp-shadow-safe (need pg_temp as the last search_path entry, or an empty search_path): %', v_bad;
  end if;

  raise notice 'ok    every SECURITY DEFINER function in public is pg_temp-shadow-safe';
end $$;

rollback;
