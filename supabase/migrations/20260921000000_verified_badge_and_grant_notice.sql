-- ============================================================================
-- The verified badge, and telling people when they get a badge
-- ============================================================================
--
-- Two additions, both riding the machinery 20260919000000/20260920000000 already built.
--
-- ── VERIFIED ────────────────────────────────────────────────────────────────
--
-- A row, not a schema change — which was the point of making the grant path generic. It is
-- the opposite corner from first_100 on every axis:
--
--     badge        slot_limit   reclaim_on_revoke   reclaim_on_delete
--     first_100          100    true                false
--     verified          NULL    n/a                 n/a
--
-- UNCAPPED, so no slots, no ordinals, and `badge_status` reports NULL remaining rather than
-- zero. The reclaim flags are meaningless without a cap and the CHECK constraint forces
-- them false, which is deliberate: a setting that reads as if it did something is worse
-- than no setting.
--
-- WHAT VERIFIED MEANS IS NOT DECIDED HERE, and the schema does not pretend otherwise. A
-- check mark asserts that somebody confirmed an identity; if Livil grants it without a
-- process, it is a decoration users will read as a guarantee. That is a product decision
-- and it belongs in a document, not a migration — this only makes the badge grantable.
--
-- ── TELLING THE HOLDER ──────────────────────────────────────────────────────
--
-- Written from inside grant_badge, with NO ACTOR — the same shape as play_milestone, so it
-- reads as coming from Livil rather than from whichever staff account pressed the button.
-- That is a privacy decision as much as a voice one: if a grant is ever disputed, which
-- operator made it is in awarded_by, where ops can see it, and nowhere the recipient can.
--
-- FAIL-SAFE, and that is the whole reason it is a nested block. A badge grant consumes a
-- capped slot and is the thing the operator actually asked for; a notification is news
-- about it. If the insert fails — a constraint we did not anticipate, a type not yet in the
-- check — the grant must still stand. Losing the notice is recoverable; silently rolling
-- back a grant that reported success is not.
--
-- PRECISELY: a notification ERROR cannot roll back the grant. A MISSING NOTIFIER will —
-- drop the function or revoke the definer's rights on it and grant_badge raises before it
-- commits. That failure is loud, which is the right trade: the operator sees an error
-- rather than a success that did nothing.
--
-- What `when others` does NOT swallow is a statement timeout: PL/pgSQL excludes
-- QUERY_CANCELED from OTHERS, so a cancelled grant surfaces instead of half-completing.
-- ============================================================================

insert into public.badge_kinds (badge, slot_limit, reclaim_on_revoke, reclaim_on_delete)
values ('verified', null, false, false)
on conflict (badge) do nothing;

-- ── the activity type ───────────────────────────────────────────────────────
alter table public.activity_notifications
  drop constraint if exists activity_notifications_type_check;

alter table public.activity_notifications
  add constraint activity_notifications_type_check check (type in (
    'like','comment','repost','play_milestone',
    'new_fan','friend_accepted','friend_rejected',
    'credited','credit_accepted','credit_declined',
    -- payload: {"badge": "first_100" | "verified"}. No actor, no post.
    'badge_granted'
  ));

-- ── granting, now with a notice ─────────────────────────────────────────────
--
-- Identical to 20260920000000 except for the notification block at the end of each success
-- path. Restated in full rather than patched because `create or replace` takes the whole
-- body, and a reader comparing the two should see one function, not a diff.
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

  -- Returns BEFORE notifying: re-granting to somebody who already holds it is an operator
  -- clicking twice, and telling them twice would be the notification equivalent of burning
  -- a second slot.
  if exists (
    select 1 from public.profile_badges pb
     where pb.user_id = p_user_id and pb.badge = p_badge and pb.revoked_at is null
  ) then
    return 'already';
  end if;

  if v_limit is null then
    insert into public.profile_badges (user_id, badge, ordinal, awarded_by)
    values (p_user_id, p_badge, null, me);
    perform public.notify_badge_granted(p_user_id, p_badge);
    return 'granted';
  end if;

  select count(*) into v_used
    from public.profile_badges pb
   where pb.badge = p_badge
     and public.badge_grant_occupies_slot(pb.revoked_at, pb.user_id, v_on_rev, v_on_del);

  if v_used >= v_limit then
    return 'full';
  end if;

  update public.profile_badges pb
     set ordinal = null
   where pb.badge = p_badge
     and pb.ordinal is not null
     and not public.badge_grant_occupies_slot(pb.revoked_at, pb.user_id, v_on_rev, v_on_del);

  select min(g) into v_ordinal
    from generate_series(1, v_limit) g
   where g not in (
     select pb.ordinal from public.profile_badges pb
      where pb.badge = p_badge and pb.ordinal is not null
   );

  insert into public.profile_badges (user_id, badge, ordinal, awarded_by)
  values (p_user_id, p_badge, v_ordinal, me);

  perform public.notify_badge_granted(p_user_id, p_badge);

  return 'granted';
end;
$$;

revoke all     on function public.grant_badge(uuid, text) from public;
revoke execute on function public.grant_badge(uuid, text) from anon;
grant  execute on function public.grant_badge(uuid, text) to authenticated;

comment on function public.grant_badge(uuid, text) is
  'Ops-only. Awards a badge, consuming a slot when capped, and tells the holder. Returns granted | already | full; raises not_authorized, no_such_badge or no_such_profile. Re-granting returns ''already'' and notifies nobody. A notification ERROR can never roll back the grant; a missing notifier will, loudly.';

-- ── the notice itself ───────────────────────────────────────────────────────
--
-- Its own function so the fail-safe wrapper exists in ONE place rather than at each of
-- grant_badge's two success paths, and so a future caller (a backfill, a second grant
-- route) cannot forget it.
--
-- NO ACTOR. `actor_id` stays NULL, like play_milestone, so the client renders it as Livil
-- speaking rather than a person — and the operator who granted it is not disclosed to the
-- recipient. `awarded_by` on the badge row is where that lives, ops-only.
--
-- NO agg_key. Badges are not aggregated: getting two is two pieces of news, and there is no
-- "and 3 others" reading of a badge.
--
-- EXCEPTION WHEN OTHERS is deliberate and narrow in effect: it swallows a failure to
-- NOTIFY, never a failure to grant, because the grant is already committed to this
-- transaction by the time this runs. The warning goes to the Postgres log where an operator
-- can find it; the alternative — letting it propagate — turns a missing notification into a
-- rolled-back badge that the dashboard reported as granted.
--
-- NO AUTHORIZATION DECISION IS INSIDE THIS HANDLER, which is what makes the broad catch
-- safe rather than lazy. The only such decision in the path is is_ops(), taken in
-- grant_badge long before this runs and outside the block. The insufficient_privilege this
-- can swallow is the DEFINER's own table grant, never the caller's.
--
-- One assumption worth carrying: serialization_failure is swallowed too, and cannot arise
-- because PostgREST runs READ COMMITTED. If RPC connections ever move to REPEATABLE READ
-- or SERIALIZABLE, revisit — the same assumption the advisory lock in grant_badge rests on.
create or replace function public.notify_badge_granted(p_user_id uuid, p_badge text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.activity_notifications (recipient_id, type, actor_id, payload, updated_at)
  values (p_user_id, 'badge_granted', null, jsonb_build_object('badge', p_badge), now());
exception
  when others then
    raise warning 'badge granted but notification failed for % / %: %', p_user_id, p_badge, sqlerrm;
end;
$$;

-- Not callable by any client: it is an internal of grant_badge, and a client that could
-- call it could post itself a notification claiming any badge. Revoked from authenticated
-- explicitly — declining to grant is inert against Supabase's default privilege.
revoke all     on function public.notify_badge_granted(uuid, text) from public;
revoke execute on function public.notify_badge_granted(uuid, text) from anon;
revoke execute on function public.notify_badge_granted(uuid, text) from authenticated;

comment on function public.notify_badge_granted(uuid, text) is
  'Internal to grant_badge: writes the actor-less activity notification telling somebody they were given a badge. Fail-safe — a notification failure never rolls back the grant. No client may execute it; it would let a caller fabricate a badge notice.';

-- ── Self-verification ───────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from public.badge_kinds
                  where badge = 'verified' and slot_limit is null
                    and reclaim_on_revoke = false and reclaim_on_delete = false) then
    raise exception 'verified must exist, uncapped, with both reclaim flags false';
  end if;

  -- first_100 must be untouched by this migration.
  if not exists (select 1 from public.badge_kinds
                  where badge = 'first_100' and slot_limit = 100
                    and reclaim_on_revoke = true and reclaim_on_delete = false) then
    raise exception 'first_100 changed — this migration must not touch it';
  end if;

  if has_function_privilege('anon', 'public.notify_badge_granted(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.notify_badge_granted(uuid, text)', 'execute') then
    raise exception 'a client can execute notify_badge_granted — it could fabricate a badge notice';
  end if;

  -- The notice must be reachable from the grant, or it silently never fires.
  if pg_get_functiondef('public.grant_badge(uuid, text)'::regprocedure) not ilike '%notify_badge_granted%' then
    raise exception 'grant_badge no longer notifies';
  end if;

  -- And the grant must keep the protections the earlier migrations established.
  if pg_get_functiondef('public.grant_badge(uuid, text)'::regprocedure) not ilike '%advisory_xact_lock%' then
    raise exception 'grant_badge lost its advisory lock';
  end if;
end $$;
