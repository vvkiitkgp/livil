-- ============================================================================
-- The credit functions were missed by LIV-16's pg_temp hardening
-- ============================================================================
--
-- `20260806130000_credit_accept_decline.sql` added three SECURITY DEFINER functions with
-- `set search_path = public`:
--
--   · credit_respond(uuid, boolean)
--   · list_pending_credits()
--   · tg_notify_track_credits()
--
-- `search_path = public` closes the SCHEMA-shadowing form and looks right, which is exactly
-- why this keeps happening. It does NOT close the pg_temp RELATION-shadowing form, because
-- Postgres searches the session temp schema FIRST for table/view/sequence/type names
-- whenever pg_temp is not itself listed in the path — ahead of `public`, ahead even of
-- `pg_catalog`. Creating relations there needs nothing but ordinary database access.
--
-- That is the LIV-16 finding, already fixed once across the whole surface in
-- `20260724000000_liv16_definer_search_path_pg_temp.sql`. These three were written after it
-- and did not inherit the rule. 54 of the 57 DEFINER functions in `public` already comply;
-- this is the remaining three.
--
-- ── Why it went unnoticed ────────────────────────────────────────────────────
--
-- There IS a lint for this — `supabase/tests/rls/definer-search-path.test.sql` — and it
-- asserts the property for EVERY definer function precisely so a new one added without the
-- rule fails on the migration that introduces it. It never fired, because it runs after
-- `credits-accept-decline.test.sql` in the same CI job and that file aborted on a privilege
-- error of its own, taking the job down before the lint was reached. The gate existed and
-- was silently unreachable. Fixed in the commit before this one.
--
-- ── Why ALTER, not CREATE OR REPLACE ─────────────────────────────────────────
--
-- `alter function ... set search_path` changes the setting and nothing else. Re-declaring
-- the bodies to add one clause would put three function definitions back through a
-- copy-paste, and `20260806200708_credit_functions_verbatim_for_parity` exists because that
-- has already gone wrong here once — production and the repo disagreed about a body that
-- had been retyped. The one-line form cannot drift what it does not restate. This is also
-- exactly the form LIV-16 used for all 54.
--
-- ── Scope ────────────────────────────────────────────────────────────────────
--
-- `public, pg_temp` rather than `''`. Appending pg_temp LAST means an attacker's temp
-- relation is consulted only after `public`, which is the hardening; an empty path would
-- additionally force every reference in every body to be schema-qualified, which is a
-- rewrite of working code rather than a fix to it. LIV-16 argued this and chose the same.

alter function public.credit_respond(p_credit_id uuid, p_accept boolean)
  set search_path = public, pg_temp;

alter function public.list_pending_credits()
  set search_path = public, pg_temp;

alter function public.tg_notify_track_credits()
  set search_path = public, pg_temp;
