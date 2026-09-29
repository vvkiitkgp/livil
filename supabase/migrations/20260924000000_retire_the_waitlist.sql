-- ============================================================================
-- Retire the waitlist
-- ============================================================================
--
-- The waitlist existed to ration access during closed testing. Livil has been in full
-- production on Play since 2026-08-14 — open to everyone, no invite, no tester list —
-- and the signup form was taken off the marketing site at that point. What remained was
-- a table nothing wrote to, two SECURITY DEFINER functions nothing called, and (until
-- the same change that ships this migration) a deployed edge function that accepted
-- unauthenticated POSTs and sent mail on the strength of them.
--
-- The last row was written on 2026-08-07. The ten rows are archived outside this repo
-- before this runs; they are eight people who were invited and already have accounts,
-- plus two rows from testing the form itself. Nothing references them.
--
-- ── WHAT THIS MUST NOT TAKE WITH IT ────────────────────────────────────────
--
-- `ops_users` and `is_ops()` were created by 20260805000000_waitlist_ops_dashboard.sql,
-- whose name says waitlist. They are NOT waitlist objects: `is_ops()` is the gate on the
-- reports queue, the copyright queue, the user roster, the badge grants and the team
-- inbox. Reverting that migration wholesale — the obvious way to do this — would lock
-- every operator out of the entire backstage. Only the four waitlist objects go, and the
-- verify block at the bottom fails if the ops gate went with them.
--
-- ── ORDER ──────────────────────────────────────────────────────────────────
--
-- Delete the `waitlist-join` and `waitlist-invite` edge functions BEFORE applying this.
-- Both talk to these objects; a deployed function whose table has gone answers a caller
-- with a 500 rather than a 404, which reads as a broken endpoint instead of an absent
-- one. Nothing in either client calls them, so there is no client-side ordering to keep.
-- ============================================================================

-- The table takes its own policies (waitlist_insert_anon / _select_ops / _update_ops)
-- and its index (waitlist_created_at_desc_idx) with it; there are no foreign keys in
-- either direction, so nothing else is touched.
drop table if exists public.waitlist;

-- waitlist_request() was the anon-callable insert behind the public form — the only
-- SECURITY DEFINER function in the project deliberately granted to `anon`, allowlisted
-- as such in scripts/check-definer-anon-grants.mjs. With no form and no table it is a
-- privileged entry point with nothing on the other side of it.
drop function if exists public.waitlist_request(p_email text);

-- Service-side bookkeeping for the send, called only by the two edge functions.
drop function if exists public.waitlist_mark_emailed(p_id uuid, p_error text);

do $verify$
declare
  v_n integer;
begin
  select count(*) into v_n
    from information_schema.tables
   where table_schema = 'public' and table_name = 'waitlist';
  if v_n <> 0 then
    raise exception 'VERIFY: public.waitlist is still present';
  end if;

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'waitlist%';
  if v_n <> 0 then
    raise exception 'VERIFY: % waitlist function(s) survived the drop', v_n;
  end if;

  -- The ops gate must be untouched. If either of these is missing, the backstage is
  -- inaccessible to everyone and this migration is the reason.
  select count(*) into v_n
    from information_schema.tables
   where table_schema = 'public' and table_name = 'ops_users';
  if v_n <> 1 then
    raise exception 'VERIFY: public.ops_users was removed with the waitlist';
  end if;

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'is_ops';
  if v_n <> 1 then
    raise exception 'VERIFY: public.is_ops() was removed with the waitlist';
  end if;
end
$verify$;
