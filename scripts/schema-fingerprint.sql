-- ============================================================================
-- Schema fingerprint — the authorization perimeter, as a diffable manifest
-- ============================================================================
--
-- WHY THIS EXISTS
--
-- CI replays every migration into an ephemeral Postgres and property-tests the result
-- (.github/workflows/ci.yml, job `migrations`). That proves the migrations are CORRECT.
-- It does not prove they are INSTALLED. On 2026-07-22 the LIV-10 authorization fix sat
-- merged-and-unapplied while the repository, the PR, and every generated knowledge-base
-- document read as fixed — see D-55. The repo declared 95 policies; production enforced
-- 99. A single comparison would have caught it.
--
-- This file produces that comparison's input: one line per security-relevant object,
-- sorted, from whichever database it is run against. Run it on both sides and diff.
--
-- WHAT IT DELIBERATELY DOES NOT COMPARE
--
--   Table/sequence ACLs, and grants to `postgres` / `service_role`. Those legitimately
--   differ: the CI harness runs a blanket `grant all on all tables ... to authenticated`
--   after replay, and Supabase bootstraps grants production has and an empty Postgres
--   does not. Including them would produce false positives, and a parity check that
--   cries wolf gets muted — which is worse than not having one (P6).
--
--   What IS compared for functions is the security question rather than the ACL string:
--   can PUBLIC execute this, and can `anon`. That survives both environments' noise.
--
-- WHY FUNCTION BODIES ARE HASHED FROM `prosrc`, NOT DEPARSED
--
--   `prosrc` is stored verbatim as written in the migration, so it is identical across
--   server versions. `pg_get_functiondef` is reconstructed and is not. This matters:
--   CI runs postgres:15 and production runs 17.6.
--
--   Policy predicates have no such escape — `pg_get_expr` always deparses. Whitespace is
--   collapsed below to absorb formatting differences, but a cross-major deparse change
--   would still show as a diff. If that happens, the answer is to align CI's image with
--   production's version, not to loosen this file until it stops complaining.
--
-- USAGE
--
--   psql "$TARGET" -At -f scripts/schema-fingerprint.sql > manifest.txt
--
--   -A (unaligned) and -t (tuples only) matter: without them psql adds padding and a row
--   count, and every line differs for reasons that are not about the schema.
-- ============================================================================

with pol as (
  select
    c.relname                                                     as tbl,
    p.polname                                                     as name,
    p.polcmd::text                                                as cmd,
    coalesce(
      (select string_agg(r.rolname, ',' order by r.rolname)
         from pg_roles r
        where r.oid = any(p.polroles)),
      'PUBLIC')                                                   as roles,
    -- Whitespace collapsed so that reformatting a migration is not reported as drift.
    regexp_replace(coalesce(pg_get_expr(p.polqual,      p.polrelid), '-'), '\s+', ' ', 'g') as qual,
    regexp_replace(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'), '\s+', ' ', 'g') as wchk
  from pg_policy p
  join pg_class     c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
)
select format('POLICY %s.%s cmd=%s roles=%s using=%s check=%s',
              tbl, name, cmd, roles, qual, wchk)
from pol

union all

-- A policy on a table with RLS disabled is inert, so the flag is part of the perimeter,
-- not metadata about it. This is the same check LIV-10's apply-time guard makes first.
select format('RLS %s enabled=%s', c.relname, c.relrowsecurity)
  from pg_class     c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'r'

union all

select format('FUNC %s(%s) secdef=%s public_exec=%s anon_exec=%s body=%s',
              p.proname,
              pg_get_function_identity_arguments(p.oid),
              p.prosecdef,
              has_function_privilege('public', p.oid, 'execute'),
              -- `anon` is the key compiled into the mobile app and published on the
              -- marketing site. Whether it can execute a DEFINER function is the single
              -- most consequential fact about that function.
              case when exists (select 1 from pg_roles where rolname = 'anon')
                   then has_function_privilege('anon', p.oid, 'execute')::text
                   else 'no-anon-role' end,
              md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')))
  from pg_proc      p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prokind = 'f'
   -- PLATFORM-OWNED, excluded deliberately and by name.
   --
   -- rls_auto_enable() is a Supabase event-trigger function that enables RLS on any new
   -- table created in `public`. It is created by the platform, not by us, so it exists in
   -- production and can never exist in a replay — a permanent one-line diff that would
   -- train everyone to skim past this check's output (P6).
   --
   -- Excluded rather than captured: writing a platform object into our migrations means
   -- fighting whatever the platform does with it next. It is benign to exclude — it
   -- `returns event_trigger`, so it is not directly callable, and the migrations enable
   -- RLS explicitly on all 31 tables anyway (verified: RLS state matches exactly), so it
   -- is belt-and-braces rather than load-bearing.
   --
   -- Anything added here must be argued in a comment like this one. An unexplained name
   -- on this list is indistinguishable from hiding a finding.
   and p.proname not in ('rls_auto_enable')

union all

-- Triggers are in here because leaving them out is what let the first real finding hide.
-- On the first run of this check, production had five counter triggers
-- (trg_post_likes_count, trg_post_comments_count, trg_post_reposts_count,
-- trg_post_views_count, trg_follows_profile_counts) that exist in NO migration. The
-- baseline creates the counter COLUMNS; nothing in the repository creates the triggers
-- that maintain them, so a database rebuilt from source has every counter permanently
-- at zero. D-08 was closed on "31 tables / 99 policies" — tables and policies matched,
-- and nobody counted functions or triggers.
select format('TRIGGER %s.%s fn=%s enabled=%s', c.relname, t.tgname, p.proname, t.tgenabled)
  from pg_trigger   t
  join pg_class     c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc      p on p.oid = t.tgfoid
 where n.nspname = 'public'
   and not t.tgisinternal

order by 1;
