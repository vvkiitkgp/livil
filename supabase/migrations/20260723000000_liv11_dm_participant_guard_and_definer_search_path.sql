-- ============================================================================
-- LIV-11 — close two authorization findings left out of scope by LIV-10
-- ============================================================================
--
-- Both verified against production (`fqzrmqnlgjeuxzinbqvs`) on 2026-07-23, immediately
-- before writing this migration. See Jira LIV-11.
--
-- WHAT THIS FILE CHANGES, and why each is the smallest complete fix:
--
--   1. get_or_create_dm — authorize the CALLER, not just the pair (finding #1), and
--      pin its search_path.
--   2. set search_path = public on the 11 other SECURITY DEFINER functions in `public`
--      that had no config pinned (finding #2).
--
-- Forward-only. The CREATE OR REPLACE and the ALTERs are idempotent — re-applying is a
-- no-op that lands the same definition.
--
-- ── Finding #1: get_or_create_dm authorizes the pair, not the caller ────────
--
-- Production body (verified 2026-07-23) calls `assert_friendship(user_a, user_b)` and
-- nothing else. That proves the two NAMED users are friends; it says nothing about who
-- is calling. `auth.uid()` appears nowhere. So any authenticated user can call
-- rpc/get_or_create_dm with two arbitrary uuids that happen to be friends, and a `dm`
-- conversation is created writing membership rows into two OTHER users' inboxes, on a
-- caller-controlled trigger, unbounded (the amplification class ADR-0008 names — not
-- impersonation; the caller gets nothing, so this does not reopen the LIV-10 chain).
--
-- THE FIX: require the caller to be one of the two participants. This is the minimal
-- form of ADR-0008's principle ("the recipient is never a parameter"); the fuller
-- refactor — drop the parameters and derive one side from auth.uid() — is recorded as
-- a follow-up on LIV-11 because it needs a client change in src/services/conversations.ts,
-- which is propose-only. The guard below needs NO client change: conversations.ts
-- already passes auth.uid() as user_a.
--
-- Everything else in the body is reproduced byte-for-byte from production so this is a
-- pure authorization + search_path change with no behavioural drift.
-- ============================================================================

create or replace function public.get_or_create_dm(user_a uuid, user_b uuid)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $function$
declare
  v_id uuid;
begin
  -- Authorize the caller. assert_friendship proves the PAIR are friends; it does not
  -- prove the caller is one of them. Without this, a DM can be manufactured between two
  -- arbitrary friends by a third party (LIV-11 finding #1).
  if auth.uid() is null or auth.uid() not in (user_a, user_b) then
    raise exception 'not_a_participant' using errcode = '42501';
  end if;

  perform assert_friendship(user_a, user_b);

  select cm1.conversation_id into v_id
  from conversation_members cm1
  join conversation_members cm2 on cm1.conversation_id = cm2.conversation_id
  join conversations c on c.id = cm1.conversation_id
  where cm1.user_id = user_a
    and cm2.user_id = user_b
    and c.kind = 'dm'
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into conversations (kind, created_by)
  values ('dm', user_a)
  returning id into v_id;

  insert into conversation_members (conversation_id, user_id, role)
  values
    (v_id, user_a, 'admin'),
    (v_id, user_b, 'member');

  return v_id;
end;
$function$;

-- ── Finding #2: pin search_path on the remaining unpinned DEFINER functions ──
--
-- A SECURITY DEFINER function with no pinned search_path resolves unqualified names
-- using the CALLER's search_path — the standard Postgres privilege-escalation shape.
--
-- SEVERITY, settled before this migration (LIV-11 asked to settle it before ranking) —
-- and CORRECTED after security review, which caught that the first settlement checked
-- the wrong privilege:
--
--   * The SCHEMA-shadowing form (create a schema/object that precedes `public` on the
--     caller's path) is CLOSED: has_schema_privilege(...,'CREATE') is FALSE for both
--     `authenticated` and `anon` on every schema on this project. Pinning to `public`
--     fully closes this form.
--
--   * The pg_temp RELATION-shadowing form is NOT closed by `= public`. Postgres searches
--     pg_temp FIRST for table/type names unless pg_temp is listed later in the path, and
--     creating temp relations needs the database TEMPORARY privilege — which IS granted
--     to PUBLIC here (has_database_privilege('authenticated'/'anon', ..., 'TEMP') = true).
--     So a caller could in principle shadow an unqualified table these bodies read.
--
-- This migration therefore REDUCES exposure (unpinned -> `public`, closing the schema
-- form) but does not fully close pg_temp shadowing. That residual is REPO-WIDE — all 40
-- already-pinned DEFINER functions use `= public` too — so it is tracked as its own
-- hardening ticket (standardise DEFINER functions on `search_path = ''` with fully
-- qualified identifiers, and/or `revoke temporary ... from public`), not scope-crept
-- into LIV-11. Pinning here is still mechanical, behaviour-neutral, and the authorization
-- helpers below (assert_friendship, is_conversation_member) are the ones every other
-- guard depends on, so it is worth closing the schema form now and worth a lint (see
-- supabase/tests/rls) so the unpinned state cannot regress.
--
-- Exactly these 11 were unpinned as of 2026-07-23 (get_or_create_dm, the 12th, is
-- pinned by the CREATE OR REPLACE above). The count differs from the ticket's original
-- "16" because LIV-10 follow-ups already pinned accept_friend_request and
-- reject_friend_request, and get_new_fans_summary / mark_fans_seen are no longer in the
-- DEFINER set.

alter function public.add_star(uuid)                     set search_path = public;
alter function public.assert_friendship(uuid, uuid)      set search_path = public;
alter function public.broadcast_jam_state(uuid, jsonb)   set search_path = public;
alter function public.cancel_friend_request(uuid)        set search_path = public;
alter function public.is_conversation_member(uuid)       set search_path = public;
alter function public.list_incoming_friend_requests()    set search_path = public;
alter function public.list_my_conversations()            set search_path = public;
alter function public.remove_friend(uuid)                set search_path = public;
alter function public.remove_star(uuid)                  set search_path = public;
alter function public.send_friend_request(uuid)          set search_path = public;
alter function public.update_conversation_last_message() set search_path = public;
