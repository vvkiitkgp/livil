-- ============================================================================
-- Badge slots: revoking gives one back, deleting your account does not
-- ============================================================================
--
-- 20260919000000 modelled slot reclaim as ONE boolean, `slots_reclaimable`, covering both
-- ways a badge stops being held. That conflated two events that are not alike:
--
--   * REVOKING is an operator's deliberate act. If ops takes a badge back — a mistaken
--     grant, a creator who turned out not to belong — the slot should return to the pool.
--     Refusing to give it back punishes Livil for its own correction.
--   * DELETING YOUR ACCOUNT is the holder's act, and the slot was genuinely spent on a real
--     person who held it. It does not come back.
--
-- first_100 needs revoke-frees + delete-does-not, which the single boolean could not
-- express in either position. So it becomes two flags.
--
-- ── WHAT THIS CHANGES ABOUT WHAT THE BADGE MEANS ────────────────────────────
--
-- "First 100" now means AT MOST 100 PEOPLE HOLD IT AT ONCE, not 100 grants ever made. A
-- revoked slot is reissued to somebody else, and because ordinals are never shown to
-- anyone (see the original migration's rule 2), that reuse is invisible and harmless.
--
-- The end state is worth stating plainly: slots consumed by deleted accounts are gone for
-- good, so if all 100 holders eventually delete their accounts the badge can never be
-- granted again. That is the deliberate consequence of "the slot was already assigned to
-- that user", not an oversight.
--
-- ── WHY NOT EDIT 20260919000000 ─────────────────────────────────────────────
--
-- It is already applied to production. Editing an applied migration is what produced the
-- schema-parity drift incident of 2026-08-07; the fingerprint is computed over the file.
-- ============================================================================

alter table public.badge_kinds
  add column if not exists reclaim_on_revoke boolean not null default false,
  add column if not exists reclaim_on_delete boolean not null default false;

-- Carry the old single flag across before it goes, so any badge defined under the previous
-- model keeps exactly the behaviour it had. Only first_100 exists today, but doing this by
-- data rather than by assuming the table's contents is the difference between a migration
-- and a guess.
-- Guarded because this file DROPS slots_reclaimable further down: unguarded, re-running
-- the migration after a partial apply dies here rather than completing, which strands the
-- operator in the half-migrated state with no way forward but hand-editing. Every other
-- statement in this file is already re-runnable; this one was the exception.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'badge_kinds'
       and column_name = 'slots_reclaimable'
  ) then
    execute $q$
      update public.badge_kinds
         set reclaim_on_revoke = slots_reclaimable,
             reclaim_on_delete = slots_reclaimable
    $q$;
  end if;
end $$;

-- Then the actual product decision, applied to first_100 alone.
update public.badge_kinds
   set reclaim_on_revoke = true,
       reclaim_on_delete = false
 where badge = 'first_100';

-- The guard trigger reads the old column, so it has to be replaced before the column can
-- go. What needs guarding has changed: `reclaim_on_delete` false -> true is the flip that
-- retroactively hands back slots spent by people who deleted their accounts, which is the
-- promise this migration exists to keep.
create or replace function public.badge_kinds_guard_reclaim()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_grants integer;
begin
  if old.reclaim_on_revoke = new.reclaim_on_revoke
     and old.reclaim_on_delete = new.reclaim_on_delete then
    return new;                                   -- not a policy change; nothing to guard
  end if;

  if old.reclaim_on_delete = false and new.reclaim_on_delete = true then
    raise exception
      'refusing to make % reclaim on delete: slots spent by deleted accounts would be handed back, and those holders cannot be consulted', old.badge;
  end if;

  -- EITHER DIRECTION IS UNSAFE ONCE GRANTS EXIST, which the first version of this trigger
  -- missed. Turning reclaim_on_revoke OFF re-promotes grants whose ordinals the sweep has
  -- already nulled: they become occupants holding no slot number, and `occupied` climbs
  -- past the cap — measured at 101 occupied and -1 remaining on a cap of 100. Changing the
  -- rules of a badge people already hold needs a migration that also renumbers, not an
  -- UPDATE.
  select count(*) into v_grants
    from public.profile_badges pb where pb.badge = old.badge;

  if v_grants > 0 then
    raise exception
      'refusing to change %''s reclaim rules: % grant(s) already exist and their slot numbers were assigned under the old rules', old.badge, v_grants;
  end if;

  return new;
end;
$$;

alter table public.badge_kinds drop constraint if exists badge_kinds_reclaim_needs_a_cap;
alter table public.badge_kinds drop column if exists slots_reclaimable;

-- Reclaim only means something when there are slots to reclaim.
alter table public.badge_kinds
  add constraint badge_kinds_reclaim_needs_a_cap
  check (slot_limit is not null or (reclaim_on_revoke = false and reclaim_on_delete = false));

comment on column public.badge_kinds.reclaim_on_revoke is
  'true = revoking returns the slot to the pool. true for first_100: an operator undoing their own grant should not cost Livil a slot.';
comment on column public.badge_kinds.reclaim_on_delete is
  'false = a holder deleting their account keeps the slot spent forever. false for first_100: it was genuinely assigned to a real person.';

-- ── who still occupies a slot ───────────────────────────────────────────────
--
-- One predicate, used by both the cap check and the sweep, so they cannot disagree — which
-- they could when each was written out longhand. A grant occupies its slot unless the
-- badge's rules have released it.
create or replace function public.badge_grant_occupies_slot(
  p_revoked_at timestamptz,
  p_user_id uuid,
  p_reclaim_on_revoke boolean,
  p_reclaim_on_delete boolean
)
returns boolean
language sql
immutable
-- EMPTY, not `pg_temp`. Listing pg_temp alone makes it the FIRST schema searched, which is
-- the relation-shadowing shape LIV-16 (20260724000000) exists to eliminate. The body
-- references no objects at all, so the strictest form costs nothing — and this function is
-- called from inside two SECURITY DEFINER bodies, where a later edit adding a table read
-- would land in definer context.
set search_path = ''
as $$
  -- coalesce, so the SAFE direction is the default. Without it a NULL flag yields NULL,
  -- the cap count's filter drops the row, and every grant looks free — the cap stops
  -- existing silently. `not null` on both badge_kinds columns is the real guarantee; this
  -- is the belt to that pair of braces.
  select coalesce(not (
       (p_revoked_at is not null and p_reclaim_on_revoke)
    or (p_user_id is null and p_reclaim_on_delete)
  ), true);
$$;

-- NOT callable by clients. Both callers are SECURITY DEFINER and invoke this with the
-- definer's privileges, so no caller needs it — exposing it would only publish another RPC
-- endpoint on the one perimeter that matters, for no gain.
--
-- REVOKED FROM authenticated EXPLICITLY, not merely left ungranted. Supabase ships
-- `alter default privileges in schema public grant execute on functions to anon,
-- authenticated, service_role`, so a newly created function is callable by both roles
-- before any grant is written. Declining to grant achieves nothing in production — which is
-- the whole reason every migration here issues explicit revokes, and why the definer-grants
-- job runs against a Postgres that does NOT carry those defaults.
revoke all on function public.badge_grant_occupies_slot(timestamptz, uuid, boolean, boolean) from public;
revoke execute on function public.badge_grant_occupies_slot(timestamptz, uuid, boolean, boolean) from anon;
revoke execute on function public.badge_grant_occupies_slot(timestamptz, uuid, boolean, boolean) from authenticated;

comment on function public.badge_grant_occupies_slot(timestamptz, uuid, boolean, boolean) is
  'Whether one grant still holds its slot, given the badge''s reclaim rules. Shared by grant_badge and badge_status so the cap check and the remaining count can never disagree.';

-- ── granting, against the two flags ─────────────────────────────────────────
--
-- The branch structure from 20260919000000 collapses: there is no longer a "permanent" and
-- a "rotating" path, because a badge can now be permanent in one direction and not the
-- other. Every capped badge counts occupied slots and reuses released numbers; which grants
-- count as released is the only thing that varies.
--
-- THE LOCK IS UNCHANGED AND STILL LOAD-BEARING. Removing it makes two racers pick the same
-- ordinal, and the unique index rejects the loser — loud. Taking it AFTER the count lets
-- both pass a stale check, land on different ordinals, and silently exceed the cap. The
-- self-verification below proves it is present, not that it precedes the count.
create or replace function public.grant_badge(p_user_id uuid, p_badge text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me         uuid := auth.uid();
  v_limit    integer;
  v_on_rev   boolean;
  v_on_del   boolean;
  v_used     integer;
  v_ordinal  integer;
begin
  if not public.is_ops() then
    raise exception 'not_authorized';
  end if;

  select bk.slot_limit, bk.reclaim_on_revoke, bk.reclaim_on_delete
    into v_limit, v_on_rev, v_on_del
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

  select count(*) into v_used
    from public.profile_badges pb
   where pb.badge = p_badge
     and public.badge_grant_occupies_slot(pb.revoked_at, pb.user_id, v_on_rev, v_on_del);

  if v_used >= v_limit then
    return 'full';
  end if;

  -- Release the slot NUMBERS of grants that no longer occupy one, without deleting the
  -- grants themselves: awarded_by / revoked_by / revoked_at are the only record that an
  -- operator acted on somebody's profile, and a revoked badge is exactly the kind that
  -- gets disputed. The unique index is on (badge, ordinal), so nulling the ordinal is what
  -- frees the number.
  update public.profile_badges pb
     set ordinal = null
   where pb.badge = p_badge
     and pb.ordinal is not null
     and not public.badge_grant_occupies_slot(pb.revoked_at, pb.user_id, v_on_rev, v_on_del);

  -- Lowest number nobody holds. `ordinal is not null` is load-bearing: a NULL inside NOT IN
  -- makes the whole predicate NULL, min() returns NULL, and the insert silently lands a
  -- capped badge with no slot number at all.
  select min(g) into v_ordinal
    from generate_series(1, v_limit) g
   where g not in (
     select pb.ordinal from public.profile_badges pb
      where pb.badge = p_badge and pb.ordinal is not null
   );

  insert into public.profile_badges (user_id, badge, ordinal, awarded_by)
  values (p_user_id, p_badge, v_ordinal, me);

  return 'granted';
end;
$$;

revoke all     on function public.grant_badge(uuid, text) from public;
revoke execute on function public.grant_badge(uuid, text) from anon;
grant  execute on function public.grant_badge(uuid, text) to authenticated;

comment on function public.grant_badge(uuid, text) is
  'Ops-only. Awards a badge, consuming a slot when capped. Returns granted | already | full; raises not_authorized, no_such_badge or no_such_profile. A revoked slot returns to the pool when badge_kinds.reclaim_on_revoke; a slot whose holder deleted their account does so only when reclaim_on_delete, which is false for first_100.';

-- ── revoking ────────────────────────────────────────────────────────────────
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

  -- Matches on user_id, so a grant whose holder deleted their account can never be revoked
  -- — its user_id is NULL. That is deliberate and it is what keeps their slot spent: there
  -- is no operator action that converts a departed holder's slot back into a free one.
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
  'Ops-only. Takes a badge away. For first_100 the slot returns to the pool; a slot whose holder deleted their account cannot be revoked at all, because the row no longer names a user — and trg_profile_badges_no_orphan_revoke stops that being done by hand.';

-- ── the promise, made structural ────────────────────────────────────────────
--
-- `revoke_badge` matches on user_id, so it can never revoke a departed holder's grant. That
-- is the mechanism, but until now it was the ONLY mechanism, and the comment above claimed
-- more than it delivered: a plain `update profile_badges set revoked_at = now() where
-- user_id is null` flips the predicate's first disjunct and hands the slot straight back.
-- Measured: occupied 1 -> 0, remaining 99 -> 100.
--
-- No client can run that — profile_badges is deny-all — so this guards migrations and the
-- SQL editor, which is exactly where it would happen. Same reasoning as the badge_kinds
-- trigger: the holders whose slots these are cannot be consulted.
create or replace function public.profile_badges_no_orphan_revoke()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- `old.revoked_at is null` IS LOAD-BEARING, not defensive. The sweep in grant_badge runs
  -- `update ... set ordinal = null` over non-occupying grants, and a revoked-then-orphaned
  -- grant is one of those. Without this clause that sweep trips the trigger and granting
  -- the badge becomes impossible.
  if old.user_id is null and old.revoked_at is null and new.revoked_at is not null then
    raise exception
      'refusing to revoke an orphaned % grant: its holder deleted their account, so the slot is spent and revoking it would hand it back', old.badge;
  end if;

  -- The other route to the same outcome: re-attach the orphan to a live account, then
  -- revoke it through the front door. Blocking the stamp alone left this wide open.
  if old.user_id is null and new.user_id is not null then
    raise exception
      'refusing to re-attach an orphaned % grant: its slot is spent, and a re-attached grant can simply be revoked to hand it back', old.badge;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profile_badges_no_orphan_revoke on public.profile_badges;
create trigger trg_profile_badges_no_orphan_revoke
  before update on public.profile_badges
  for each row execute function public.profile_badges_no_orphan_revoke();

-- And the third route: just delete the row. No amount of UPDATE guarding closes that one.
create or replace function public.profile_badges_no_orphan_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.user_id is null then
    raise exception
      'refusing to delete an orphaned % grant: the row IS the record that its slot is spent', old.badge;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_profile_badges_no_orphan_delete on public.profile_badges;
create trigger trg_profile_badges_no_orphan_delete
  before delete on public.profile_badges
  for each row execute function public.profile_badges_no_orphan_delete();

-- And the fourth: TRUNCATE, which walks straight past every row-level trigger above —
-- they simply do not fire on it. Owner-only and far from subtle (it destroys the table
-- rather than quietly freeing one slot), but it reaches the same outcome, and a guard that
-- covers three of four routes should not be described as closing the matter.
--
-- THIS ALSO BLOCKS `truncate auth.users cascade`, the usual way to reset a scratch or local
-- database — the cascade reaches this table and aborts here. Nothing in the repo or in CI
-- does that, but the error names a badge trigger and will not obviously explain itself to
-- whoever hits it. To reset a LOCAL database:
--
--     alter table public.profile_badges disable trigger trg_profile_badges_no_truncate;
--
-- Never in a migration, and never against production: the rows are the only record of which
-- slots are spent.
create or replace function public.profile_badges_no_truncate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception
    'refusing to truncate profile_badges: the rows ARE the record of which slots are spent, and truncate does not fire the row guards';
end;
$$;

drop trigger if exists trg_profile_badges_no_truncate on public.profile_badges;
create trigger trg_profile_badges_no_truncate
  before truncate on public.profile_badges
  for each statement execute function public.profile_badges_no_truncate();

-- ── how many are left ───────────────────────────────────────────────────────
-- DROP FIRST, NOT OPTIONAL. `occupied` is a new OUT parameter, which changes the row type,
-- and `create or replace` refuses that outright ("cannot change return type of existing
-- function"). Without this the migration aborts mid-file — and since psql autocommits per
-- statement, it aborts having already dropped slots_reclaimable, leaving badge_status
-- selecting a column that no longer exists.
--
-- The revoke/grant block after the body is what restores the posture: a freshly created
-- function inherits EXECUTE TO PUBLIC, so dropping without re-revoking would hand `anon`
-- execute back.
drop function if exists public.badge_status(text);

create or replace function public.badge_status(p_badge text)
returns table (
  slot_limit   integer,
  granted_ever integer,
  live         integer,
  occupied     integer,
  remaining    integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit  integer;
  v_on_rev boolean;
  v_on_del boolean;
begin
  if not public.is_ops() then
    return;
  end if;

  select bk.slot_limit, bk.reclaim_on_revoke, bk.reclaim_on_delete
    into v_limit, v_on_rev, v_on_del
    from public.badge_kinds bk where bk.badge = p_badge;
  if not found then
    return;
  end if;

  return query
    with counts as (
      select
        count(*)::integer as ever,
        count(*) filter (
          where pb.revoked_at is null and pb.user_id is not null
        )::integer as live_now,
        count(*) filter (
          where public.badge_grant_occupies_slot(pb.revoked_at, pb.user_id, v_on_rev, v_on_del)
        )::integer as occupied_now
      from public.profile_badges pb
      where pb.badge = p_badge
    )
    select
      v_limit,
      c.ever,
      c.live_now,
      c.occupied_now,
      case when v_limit is null then null else v_limit - c.occupied_now end
    from counts c;
end;
$$;

revoke all     on function public.badge_status(text) from public;
revoke execute on function public.badge_status(text) from anon;
grant  execute on function public.badge_status(text) to authenticated;

comment on function public.badge_status(text) is
  'Ops-only. A badge''s cap, grants ever made, badges currently live, slots currently occupied, and slots remaining (NULL when uncapped). OCCUPIED is the number the cap is measured against and is what "remaining" derives from: it counts live holders plus grants whose slot was not reclaimed — for first_100, the departed holders. Empty for a non-ops caller or an unknown badge.';

-- ── Self-verification ───────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public'
              and tablename in ('profile_badges', 'badge_kinds')) then
    raise exception 'a policy exists on a badge table — both must stay deny-all';
  end if;

  if not exists (select 1 from public.badge_kinds
                  where badge = 'first_100'
                    and slot_limit = 100
                    and reclaim_on_revoke = true
                    and reclaim_on_delete = false) then
    raise exception 'first_100 must be capped at 100, reclaim on revoke, and NOT reclaim on delete';
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'badge_kinds'
                and column_name = 'slots_reclaimable') then
    raise exception 'slots_reclaimable still exists — the two-flag model replaced it';
  end if;

  if has_function_privilege('anon', 'public.grant_badge(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.revoke_badge(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.badge_status(text)', 'execute')
     or has_function_privilege('anon', 'public.badge_grant_occupies_slot(timestamptz, uuid, boolean, boolean)', 'execute') then
    raise exception 'anon can execute a badge function — a revoke did not take';
  end if;

  -- The predicate is the one badge function no client should reach at all. Asserted
  -- separately because the revoke it depends on is fighting a DEFAULT privilege, not an
  -- absent one, and a silently-restored default looks identical to a correct file.
  if has_function_privilege('authenticated', 'public.badge_grant_occupies_slot(timestamptz, uuid, boolean, boolean)', 'execute') then
    raise exception 'authenticated can execute badge_grant_occupies_slot — the revoke did not take';
  end if;

  if pg_get_functiondef('public.grant_badge(uuid, text)'::regprocedure) not ilike '%advisory_xact_lock%' then
    raise exception 'grant_badge lost its advisory lock';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_profile_badges_no_orphan_revoke')
     or not exists (select 1 from pg_trigger where tgname = 'trg_profile_badges_no_orphan_delete')
     or not exists (select 1 from pg_trigger where tgname = 'trg_profile_badges_no_truncate')
     or not exists (select 1 from pg_trigger where tgname = 'trg_badge_kinds_guard_reclaim') then
    raise exception 'a badge guard trigger is missing — the spent-slot promise rests on all four';
  end if;
end $$;
