-- ============================================================================
-- profile_badges — badges on a profile, and the slots they consume
-- ============================================================================
--
-- Ships with one badge, First 100: a hand-picked mark for the first hundred creators,
-- granted from /studio/ops and shown beside the avatar. Three product rules drive it:
--
--   1. THE CAP IS REAL. At most 100 grants. Not "100 enforced by the dashboard remembering
--      to check" — the database refuses the 101st.
--   2. ALL HOLDERS ARE EQUAL. Nobody may learn who was 2nd and who was 99th. There is no
--      rank, no join-order, no "#023 of 100" anywhere a client can reach.
--   3. A SLOT IS SPENT, NOT LENT. Revoking, or the holder deleting their account, does NOT
--      hand the slot to somebody else. The count only goes up.
--
-- ── WHY THE GRANT PATH IS GENERIC WHEN THERE IS ONE BADGE ───────────────────
--
-- More badges are planned — "verified", "top 10 artist". The first draft of this migration
-- hardcoded First 100 into a CHECK constraint, a NOT NULL ordinal and three functions named
-- after it, which made badge number two a schema change plus three more functions, and
-- badge number three another three. That is the shape that ends in nine near-identical
-- functions nobody dares touch.
--
-- More importantly, rule 3 is NOT universal, and assuming it was would have been the real
-- defect. "Top 10 artist" rotates: this month's top ten is not next month's, so its slots
-- must return to the pool or the badge stops working after ten people. "Verified" has no
-- cap at all and no meaningful slot number.
--
-- So the two things that actually differ between badges get a row, not a rewrite:
--
--     badge        slot_limit   slots_reclaimable
--     first_100          100    false   -- spent forever, by design
--     verified          NULL    n/a     -- uncapped, if it is ever added
--     top_10              10    true    -- rotates
--
-- Adding a badge is then an INSERT plus a component on the client. Nothing here presumes
-- what "verified" will mean — only that it will not mean "100, burned permanently".
--
-- ── WHY A TABLE AND NOT `profiles.is_first_100 boolean` ─────────────────────
--
-- `profiles` is readable by every authenticated client (profiles_select_authenticated),
-- so anything stored there is published to the whole userbase. Fine for the FACT of a
-- badge; fatal for the bookkeeping beside it — see the next section. A boolean column
-- would also mean another column and another edit to the ~135 sites that select profile
-- fields, every time a badge is added.
--
-- ── WHY THE TABLES ARE DENY-ALL AND READS GO THROUGH A FUNCTION ─────────────
--
-- Rule 2 is a rule about COLUMNS, and RLS is row-level. A policy that lets a client read
-- its own badge row cannot stop that client reading `ordinal` and `awarded_at` off the
-- same row — which is precisely the ordering the product says nobody may see. Ordering a
-- readable table by a timestamp is not an attack, it is a query.
--
-- So both tables carry RLS with no policies at all — the `ops_users` pattern from
-- 20260805000000 — and the app reads through `badges_for_profiles()`, which returns
-- `(user_id, badge)` and nothing else. The ordinal is not hidden by convention or by a
-- client that declines to select it; it is unreachable.
--
-- `badge_kinds` is deny-all for the same reason one step removed: `slot_limit` with a live
-- `remaining` count is scarcity information, and a client that can poll it while watching
-- badges appear reconstructs the ordering rule 2 exists to prevent.
--
-- ── WHY `on delete set null` AND NOT `on delete cascade` ────────────────────
--
-- Rule 3, for badges that do not reclaim. Under CASCADE, deleting an account deletes its
-- badge row, the count drops to 99, and the next grant reuses the slot — so "one of the
-- first hundred" quietly becomes "one of the first hundred and six". Setting the holder to
-- NULL keeps the spent slot on the books with nobody attached to it. The row that remains
-- holds no personal data: a badge name, an integer, and two timestamps.
--
-- This is deliberately NOT symmetrical with the rest of account deletion (LIV-74), which
-- removes rows. The thing preserved is not the user's data, it is the integrity of a count
-- that other people's badges depend on.
-- ============================================================================

-- ── what badges exist, and how their slots behave ───────────────────────────

create table if not exists public.badge_kinds (
  badge             text primary key,
  -- NULL means uncapped. A number caps grants at that many slots.
  slot_limit        integer,
  -- false: a revoked or orphaned slot stays spent forever (First 100).
  -- true:  the slot returns to the pool, so the badge can rotate (a future Top 10).
  -- Meaningless when slot_limit is NULL, and pinned false there by the constraint below
  -- so an uncapped badge cannot carry a setting that reads as if it did something.
  slots_reclaimable boolean not null default false,
  created_at        timestamptz not null default now(),
  constraint badge_kinds_slot_limit_positive
    check (slot_limit is null or slot_limit >= 1),
  constraint badge_kinds_reclaim_needs_a_cap
    check (slot_limit is not null or slots_reclaimable = false)
);

alter table public.badge_kinds enable row level security;

insert into public.badge_kinds (badge, slot_limit, slots_reclaimable)
values ('first_100', 100, false)
on conflict (badge) do nothing;

comment on table public.badge_kinds is
  'The badges that exist and how their slots behave. Adding a badge is an INSERT here plus a renderer on the client — not a schema change. Deny-all: slot_limit alongside a live remaining count is scarcity information.';
comment on column public.badge_kinds.slots_reclaimable is
  'false = a revoked or orphaned slot is spent forever (First 100). true = it returns to the pool, for a badge that rotates.';

-- A badge's slot policy may LOOSEN (a permanent badge could become rotating only by
-- deliberate decision) but flipping it silently is destructive: the next grant would free
-- every spent slot of a badge whose whole promise is that they are never freed. No client
-- can write this table, so this guards migrations and the SQL editor — the two places it
-- would actually happen. Same posture as trg_terms_versions_immutable (20260907000000).
create or replace function public.badge_kinds_guard_reclaim()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.slots_reclaimable = false and new.slots_reclaimable = true then
    raise exception
      'refusing to make % reclaimable: its spent slots would be freed by the next grant, and that is not reversible', old.badge;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_badge_kinds_guard_reclaim on public.badge_kinds;
create trigger trg_badge_kinds_guard_reclaim
  before update on public.badge_kinds
  for each row execute function public.badge_kinds_guard_reclaim();

-- ── who holds what ──────────────────────────────────────────────────────────

create table if not exists public.profile_badges (
  id          uuid primary key default gen_random_uuid(),
  -- NULL once the holder deletes their account. The slot stays spent; see above.
  user_id     uuid references auth.users(id) on delete set null,
  -- FK rather than a CHECK list, so a new badge is a row and not an ALTER TABLE.
  badge       text not null references public.badge_kinds(badge),
  -- Which slot this grant consumed. NULL for an uncapped badge, which has no slots to
  -- number. Bookkeeping, never a rank, and deliberately unreachable from any client.
  ordinal     integer,
  awarded_at  timestamptz not null default now(),
  awarded_by  uuid references auth.users(id) on delete set null,
  revoked_at  timestamptz,
  revoked_by  uuid references auth.users(id) on delete set null,
  constraint profile_badges_ordinal_positive check (ordinal is null or ordinal >= 1)
);

-- Deny-all: RLS on, zero policies. No client reads, writes, or probes this table through
-- PostgREST. Only the DEFINER functions below see it.
alter table public.profile_badges enable row level security;

-- A slot is held by one grant at a time. Postgres treats NULLs as distinct in a unique
-- index, so uncapped badges (ordinal NULL) never collide here — which is what we want.
create unique index if not exists profile_badges_badge_ordinal_key
  on public.profile_badges (badge, ordinal);

-- One LIVE badge of a kind per person. Partial, so a revoked badge does not block a later
-- re-grant to the same person, and orphaned rows (user_id NULL) never collide.
create unique index if not exists profile_badges_live_holder_key
  on public.profile_badges (user_id, badge)
  where revoked_at is null and user_id is not null;

-- The read path: "which of these people have badges".
create index if not exists profile_badges_live_lookup_idx
  on public.profile_badges (badge, user_id)
  where revoked_at is null and user_id is not null;

comment on table public.profile_badges is
  'Badges held, and the slots they consume. Deny-all by design: reads go through badges_for_profiles(), which returns (user_id, badge) only, so no client can recover award order.';
comment on column public.profile_badges.ordinal is
  'Which slot this grant consumed; NULL for an uncapped badge. Bookkeeping for the cap, NOT a rank, and deliberately unreachable from any client.';
comment on column public.profile_badges.user_id is
  'NULL once the holder deletes their account. The row stays so a non-reclaimable slot stays spent.';

-- ── the read path ───────────────────────────────────────────────────────────
--
-- Returns the FACT of a badge and nothing else. No ordinal, no awarded_at — award order is
-- the one thing the product says nobody may recover, and the only way to guarantee that is
-- for the ordering columns never to leave the server.
--
-- DEFINER because `profile_badges` is deny-all. Returns empty rather than raising for a
-- signed-out caller, matching every other read here: a missing badge and an unauthorized
-- read look the same to the UI, which renders no badge either way.
--
-- THE ROW ORDER IS PART OF THE PAYLOAD. Withholding `ordinal` is not enough: with no ORDER
-- BY, Postgres plans this as a sequential scan and hands rows back in physical heap order,
-- which on an append-only table IS insertion order — so the ranking the column refuses to
-- return comes back as the order of the array. Shuffling the argument does not help,
-- because the scan drives the output. Ordering by `user_id` (a v4 uuid, independent of when
-- the badge was awarded) severs that. Do not remove this ORDER BY as a "pointless sort on
-- 100 rows" — it is the control.
--
-- WHAT THIS DOES NOT PROMISE: order is unrecoverable RETROACTIVELY, not absolutely. A
-- client that polls this daily learns who gained a badge when, going forward. Nothing
-- schema-side can prevent that once a badge is visible on a profile at all.
--
-- NOT block-aware, deliberately. The caller already has these user ids because it is
-- displaying these profiles. A badge carries no information about its holder beyond one
-- they chose to be public, so there is nothing here for a block to protect.
create or replace function public.badges_for_profiles(p_user_ids uuid[])
returns table (
  user_id uuid,
  badge   text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  return query
    select pb.user_id, pb.badge
      from public.profile_badges pb
     where pb.user_id = any(p_user_ids)
       and pb.revoked_at is null
       and pb.user_id is not null
     order by pb.user_id;
end;
$$;

revoke all     on function public.badges_for_profiles(uuid[]) from public;
revoke execute on function public.badges_for_profiles(uuid[]) from anon;
grant  execute on function public.badges_for_profiles(uuid[]) to authenticated;

comment on function public.badges_for_profiles(uuid[]) is
  'Live badges for the given profiles, as (user_id, badge) only. Deliberately returns no ordinal and no timestamp, and orders by user_id: award order must not be recoverable by any client, and unordered rows come back in it. Empty for a signed-out caller.';

-- ── granting ────────────────────────────────────────────────────────────────
--
-- WHAT THE LOCK PREVENTS, MEASURED — this comment has now been wrong twice from reasoning,
-- so it records only what two concurrent sessions actually did, five runs out of five:
--
--   lock where it is now   A granted, B 'full'                    2 live on a cap of 2  ✔
--   lock REMOVED           A granted, B duplicate-key error       2 live                ✔-ish
--   lock AFTER the count   A granted, B granted                   3 live on a cap of 2  ✘
--
-- So REMOVING the lock is loud, not silent: both racers compute the same ordinal and the
-- unique index on (badge, ordinal) rejects the loser — on both branches, not just the
-- permanent one. The operator sees a raw constraint error, which is ugly and not wrong.
--
-- The dangerous mutation is MISPLACING it. Taken after the count, both racers pass a stale
-- check and land on different ordinals, so the index never fires and the badge quietly ends
-- up over its cap — and on a rotating badge the third row gets a NULL ordinal, because
-- min() over an exhausted slot set is NULL. No test catches that: the self-verification
-- below only checks the lock is PRESENT, not that it precedes the count. Move it and you
-- have removed the only protection against a silent over-grant.
--
-- Transaction-scoped and keyed PER BADGE, following the LIV-25 pattern from 20260812000000
-- — `hashtextextended(..., 0)` rather than `hashtext`, so the key uses the whole 64-bit
-- advisory space `_dm_lock_key` already shares. Granting First 100 does not block a grant
-- of any other badge.
--
-- The count/insert is race-free because PostgREST runs READ COMMITTED: the count after the
-- lock takes a fresh snapshot and sees the winner's committed insert. Under REPEATABLE READ
-- it would silently stop working, so if a non-default isolation level is ever set for RPC
-- connections, revisit this.
--
-- Idempotent: granting to somebody who already holds a live badge returns 'already' and
-- consumes no slot. An operator clicking twice must not burn two of a hundred.
create or replace function public.grant_badge(p_user_id uuid, p_badge text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me          uuid := auth.uid();
  v_limit     integer;
  v_reclaim   boolean;
  v_used      integer;
  v_ordinal   integer;
begin
  if not public.is_ops() then
    raise exception 'not_authorized';
  end if;

  select bk.slot_limit, bk.slots_reclaimable into v_limit, v_reclaim
    from public.badge_kinds bk where bk.badge = p_badge;
  if not found then
    raise exception 'no_such_badge';
  end if;

  if p_user_id is null or not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'no_such_profile';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('profile_badges:' || p_badge, 0));

  if exists (
    select 1 from public.profile_badges pb
     where pb.user_id = p_user_id and pb.badge = p_badge and pb.revoked_at is null
  ) then
    return 'already';
  end if;

  -- Uncapped: no slots to count, no ordinal to assign.
  if v_limit is null then
    insert into public.profile_badges (user_id, badge, ordinal, awarded_by)
    values (p_user_id, p_badge, null, me);
    return 'granted';
  end if;

  if v_reclaim then
    -- A rotating badge counts only what is LIVE, so a revoked or departed holder frees
    -- their slot, and the freed ordinal is reused rather than left as a hole.
    select count(*) into v_used
      from public.profile_badges pb
     where pb.badge = p_badge and pb.revoked_at is null and pb.user_id is not null;

    if v_used >= v_limit then
      return 'full';
    end if;

    -- Free the dead rows' slot numbers WITHOUT deleting the rows. The unique index covers
    -- (badge, ordinal), so a dead row holding ordinal 2 would block its reuse; nulling the
    -- ordinal releases the number and keeps the grant on the books.
    --
    -- NOT a delete, deliberately. `awarded_by` / `revoked_by` / `revoked_at` are the only
    -- record that an operator acted on somebody's profile, and a rotating badge — "top 10
    -- artist" — is precisely the one whose grants get disputed. Deleting them also made
    -- `granted_ever` shrink, so the status lied about how many grants had been made.
    update public.profile_badges pb
       set ordinal = null
     where pb.badge = p_badge
       and pb.ordinal is not null
       and (pb.revoked_at is not null or pb.user_id is null);

    select min(g) into v_ordinal
      from generate_series(1, v_limit) g
     where g not in (
       select pb.ordinal from public.profile_badges pb
        where pb.badge = p_badge and pb.ordinal is not null
     );
  else
    -- Counts EVERY grant ever made, revoked and orphaned rows included. That is rule 3:
    -- a returned badge does not put the slot back in the pool.
    select count(*) into v_used
      from public.profile_badges pb where pb.badge = p_badge;

    if v_used >= v_limit then
      return 'full';
    end if;

    select coalesce(max(pb.ordinal), 0) + 1 into v_ordinal
      from public.profile_badges pb where pb.badge = p_badge;
  end if;

  insert into public.profile_badges (user_id, badge, ordinal, awarded_by)
  values (p_user_id, p_badge, v_ordinal, me);

  return 'granted';
end;
$$;

revoke all     on function public.grant_badge(uuid, text) from public;
revoke execute on function public.grant_badge(uuid, text) from anon;
grant  execute on function public.grant_badge(uuid, text) to authenticated;

comment on function public.grant_badge(uuid, text) is
  'Ops-only. Awards a badge, consuming a slot when the badge is capped. Returns granted | already | full; raises not_authorized, no_such_badge or no_such_profile. Whether a revoked slot returns to the pool is badge_kinds.slots_reclaimable — false for first_100, whose slots are spent permanently.';

-- ── revoking ────────────────────────────────────────────────────────────────
--
-- Marks the badge revoked; the row and its ordinal stay. For a non-reclaimable badge the
-- slot does not come back — if that is not what an operator wants, the answer is that
-- there is no such operation: 100 is a promise to the other 99. For a reclaimable badge the
-- next grant sweeps the dead row and reuses the number.
create or replace function public.revoke_badge(p_user_id uuid, p_badge text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me     uuid := auth.uid();
  v_rows integer;
begin
  if not public.is_ops() then
    raise exception 'not_authorized';
  end if;

  update public.profile_badges
     set revoked_at = now(),
         revoked_by = me
   where user_id = p_user_id
     and badge = p_badge
     and revoked_at is null;

  get diagnostics v_rows = row_count;
  return case when v_rows > 0 then 'revoked' else 'not_held' end;
end;
$$;

revoke all     on function public.revoke_badge(uuid, text) from public;
revoke execute on function public.revoke_badge(uuid, text) from anon;
grant  execute on function public.revoke_badge(uuid, text) to authenticated;

comment on function public.revoke_badge(uuid, text) is
  'Ops-only. Takes a badge away. For a badge whose slots are not reclaimable the consumed slot is NOT returned to the pool — see grant_badge.';

-- ── how many are left ───────────────────────────────────────────────────────
--
-- Ops-only on purpose: `slot_limit` and `granted_ever` are genuinely not obtainable
-- elsewhere — `badge_kinds` is deny-all and revoked or orphaned grants are invisible to the
-- reader — so this is the only way to learn how much scarcity is left.
--
-- `live` is NOT protected by this gate and it would be dishonest to imply otherwise: any
-- signed-in client can enumerate profiles and count what badges_for_profiles returns. That
-- is the same forward-looking leak already conceded for the reader, and rule 2 —
-- RETROACTIVE order — is unaffected by it.
create or replace function public.badge_status(p_badge text)
returns table (
  slot_limit   integer,
  granted_ever integer,
  live         integer,
  remaining    integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit   integer;
  v_reclaim boolean;
begin
  if not public.is_ops() then
    return;
  end if;

  select bk.slot_limit, bk.slots_reclaimable into v_limit, v_reclaim
    from public.badge_kinds bk where bk.badge = p_badge;
  if not found then
    return;
  end if;

  return query
    with counts as (
      select
        count(*)::integer as ever,
        count(*) filter (where pb.revoked_at is null and pb.user_id is not null)::integer as live_now
      from public.profile_badges pb
      where pb.badge = p_badge
    )
    select
      v_limit,
      c.ever,
      c.live_now,
      -- What is left depends on which number the cap is measured against: a rotating badge
      -- frees its slots, a permanent one does not.
      case when v_limit is null then null
           else v_limit - (case when v_reclaim then c.live_now else c.ever end)
      end
    from counts c;
end;
$$;

revoke all     on function public.badge_status(text) from public;
revoke execute on function public.badge_status(text) from anon;
grant  execute on function public.badge_status(text) to authenticated;

comment on function public.badge_status(text) is
  'Ops-only. A badge''s cap, grants ever made, badges currently live, and slots remaining (NULL when uncapped). Empty for a non-ops caller or an unknown badge. Never exposed to the app: the remaining count leaks award order in aggregate.';

-- ── Self-verification ───────────────────────────────────────────────────────
--
-- These assert the properties the header promises, so a later edit that breaks one fails
-- the migration rather than shipping quietly. NOTE they run when the migration runs — on a
-- fresh CI replay, and once against production. They are not a live invariant check:
-- something that changes the schema afterwards is caught by the RLS test, not by these.
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public'
              and tablename in ('profile_badges', 'badge_kinds')) then
    raise exception 'a policy exists on profile_badges or badge_kinds — both must stay deny-all so ordinal and slot_limit are unreachable';
  end if;

  if (select relrowsecurity from pg_class where oid = 'public.profile_badges'::regclass) is not true
     or (select relrowsecurity from pg_class where oid = 'public.badge_kinds'::regclass) is not true then
    raise exception 'RLS is not enabled on both badge tables';
  end if;

  if (select confdeltype from pg_constraint
       where conrelid = 'public.profile_badges'::regclass
         and confrelid = 'auth.users'::regclass
         and conkey = array[(select attnum from pg_attribute
                              where attrelid = 'public.profile_badges'::regclass
                                and attname = 'user_id')]) <> 'n' then
    raise exception 'profile_badges.user_id must be ON DELETE SET NULL — a cascade would return spent slots to the pool';
  end if;

  if not exists (select 1 from public.badge_kinds
                  where badge = 'first_100' and slot_limit = 100 and slots_reclaimable = false) then
    raise exception 'first_100 must be capped at 100 with non-reclaimable slots';
  end if;

  if has_function_privilege('anon', 'public.badges_for_profiles(uuid[])', 'execute')
     or has_function_privilege('anon', 'public.grant_badge(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.revoke_badge(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.badge_status(text)', 'execute') then
    raise exception 'anon can execute a badge function — a revoke did not take';
  end if;

  -- The ORDER BY is the only thing keeping award order out of the response, and it is the
  -- kind of line a later edit removes as redundant. ILIKE so a re-cased clause is not a
  -- false alarm. Same for the lock.
  if pg_get_functiondef('public.badges_for_profiles(uuid[])'::regprocedure) not ilike '%order by%' then
    raise exception 'badges_for_profiles lost its ORDER BY — unordered rows come back in award order';
  end if;
  if pg_get_functiondef('public.grant_badge(uuid, text)'::regprocedure) not ilike '%advisory_xact_lock%' then
    raise exception 'grant_badge lost its advisory lock — two operators can both pass a stale count';
  end if;
end $$;
