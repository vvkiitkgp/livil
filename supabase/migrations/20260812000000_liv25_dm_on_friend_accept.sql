-- ============================================================================
-- LIV-25 — a DM exists the moment two people become friends
-- ============================================================================
--
-- Companion to LIV-20. Accepting a friend request should leave the pair with a
-- conversation already in both inboxes, so neither has to find a "start a chat"
-- affordance before saying anything.
--
-- Almost all of this already existed. `get_or_create_dm` creates the conversation
-- and both membership rows; `list_my_conversations` already returns message-less
-- conversations (`order by c.last_message_at desc nulls last`); the inbox already
-- renders `lastMessagePreview ?? 'No messages yet'`. The only missing piece was
-- that nothing called it on the accept path.
--
-- ── WHY A TRIGGER, NOT A LINE IN accept_friend_request ──────────────────────
--
-- The obvious implementation is to fold the creation into `accept_friend_request`,
-- which already runs in the transaction that proved the request was pending. It was
-- rejected for a specific reason: `accept_friend_request` is one of the EIGHT
-- SECURITY DEFINER bodies whose production definition is known to differ from this
-- repository (LIV-87, `schema-parity` RED on main since ~2026-07-26). Nobody has yet
-- established which side is authoritative. A `create or replace` here would resolve
-- that question by accident, in the direction of "whatever the repo happens to say",
-- as a side effect of a chat feature. That is not a decision this migration is
-- entitled to make, so it does not make it. LIV-87 still owns it.
--
-- A trigger reaches the same transaction without touching the drifted body. It also
-- covers every accept path — mobile, the web surface, and any operator tooling —
-- rather than only the caller that remembers to make a second RPC.
--
-- ── WHY NOT DO IT CLIENT-SIDE ───────────────────────────────────────────────
--
-- `acceptFriendRequest()` could simply call `getOrCreateDm()` after the RPC returns.
-- It is not atomic: the process can die between the two calls and leave an accepted
-- friendship with no conversation, which is exactly the state this ticket exists to
-- prevent, now reachable only intermittently and therefore harder to notice.
--
-- ── THE RACE, WHICH WAS ALREADY THERE ───────────────────────────────────────
--
-- `get_or_create_dm` is select-then-insert with no unique constraint on the DM pair,
-- so two concurrent calls can both miss and both insert. LIV-25 asks for
-- "concurrent/duplicate accepts do not create duplicate conversations", which is not
-- true today and would not become true just by adding a second caller — it would get
-- worse, since the trigger and a client tap can now overlap.
--
-- Closed with a transaction-scoped advisory lock keyed on the NORMALIZED pair, taken
-- before the existence check. Both writers take the same key, so the loser blocks
-- until the winner commits and then sees the row. Preferred over adding dm_lo/dm_hi
-- columns + a partial unique index because it needs no schema change and no backfill
-- over existing DMs; the constraint remains available later if the pair ever needs to
-- be queryable rather than merely unique.
-- ============================================================================

-- ── The shared lock key ─────────────────────────────────────────────────────
--
-- Factored out rather than inlined at both sites for one reason: the two writers MUST
-- hash identically or the lock protects nothing, and two copies of a `least()/
-- greatest()` expression is precisely the kind of thing that drifts silently. Callers
-- pass their arguments in whatever order they have them; normalization happens here.
create or replace function public._dm_lock_key(a uuid, b uuid)
returns bigint
language sql
immutable
set search_path = public, pg_temp
as $$
  select hashtextextended(
    least(a::text, b::text) || greatest(a::text, b::text),
    0
  );
$$;

comment on function public._dm_lock_key(uuid, uuid) is
  'Advisory-lock key for a DM pair, order-independent. Serializes get_or_create_dm '
  'against the friend-accept trigger (LIV-25).';

-- ── get_or_create_dm: unchanged behaviour, plus the lock ────────────────────
--
-- Body is otherwise byte-for-byte the LIV-11 version (the caller-authorization fix in
-- the header comment is load-bearing — assert_friendship proves the PAIR are friends,
-- not that the caller is one of them). Only the advisory lock is new. This function is
-- NOT among the eight drifted bodies in LIV-87, so replacing it is safe.
create or replace function public.get_or_create_dm(user_a uuid, user_b uuid)
  returns uuid
  language plpgsql
  security definer
  set search_path = public, pg_temp
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

  -- LIV-25: serialize against a concurrent create for the same pair — another tab, a
  -- double tap, or the friend-accept trigger. Must precede the existence check, or
  -- both callers read "absent" before either writes. Released at commit/rollback.
  perform pg_advisory_xact_lock(public._dm_lock_key(user_a, user_b));

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

-- ── The trigger function ────────────────────────────────────────────────────
--
-- Deliberately does NOT call get_or_create_dm. That function authorizes on auth.uid(),
-- which is correct for a client RPC and wrong here: the trigger must also fire for an
-- accept performed by operator tooling or a service role, where auth.uid() is null. It
-- would raise 'not_a_participant' and abort the accept itself. The friendship row being
-- updated to 'accepted' IS the authorization — assert_friendship would be checking the
-- very fact that caused this trigger to run.
create or replace function public.friendships_create_dm_on_accept()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_accepter uuid;
  v_other uuid;
begin
  -- The accepter is whoever did not send the request. Derived from the row rather than
  -- from auth.uid() so the attribution is identical no matter which path did the accept
  -- (ADR-0008 decision #1 applies the same reasoning to notification recipients).
  if new.requested_by = new.user_a_id then
    v_accepter := new.user_b_id;
    v_other    := new.user_a_id;
  else
    v_accepter := new.user_a_id;
    v_other    := new.user_b_id;
  end if;

  perform pg_advisory_xact_lock(public._dm_lock_key(new.user_a_id, new.user_b_id));

  select cm1.conversation_id into v_id
  from conversation_members cm1
  join conversation_members cm2 on cm1.conversation_id = cm2.conversation_id
  join conversations c on c.id = cm1.conversation_id
  where cm1.user_id = new.user_a_id
    and cm2.user_id = new.user_b_id
    and c.kind = 'dm'
  limit 1;

  if v_id is not null then
    -- Already friends once before, unfriended, now re-accepted: the old DM and its
    -- history are still there. Reuse it. LIV-21/LIV-26 own hide-on-unfriend; nothing
    -- here should resurrect or re-hide anything, only decline to duplicate.
    return new;
  end if;

  insert into conversations (kind, created_by)
  values ('dm', v_accepter)
  returning id into v_id;

  insert into conversation_members (conversation_id, user_id, role)
  values
    (v_id, v_accepter, 'admin'),
    (v_id, v_other,    'member');

  return new;
end;
$$;

comment on function public.friendships_create_dm_on_accept() is
  'LIV-25: ensures a DM exists for the pair the moment a friendship becomes accepted. '
  'Idempotent; serialized against get_or_create_dm by _dm_lock_key.';

-- AFTER, not BEFORE: the conversation should only exist if the accept commits. The WHEN
-- clause keeps this off every other friendships UPDATE, and makes re-accepting an
-- already-accepted row (which accept_friend_request rejects anyway) a no-op rather than
-- a second existence check.
drop trigger if exists trg_friendships_create_dm_on_accept on public.friendships;
create trigger trg_friendships_create_dm_on_accept
after update on public.friendships
for each row
when (new.status = 'accepted' and old.status is distinct from 'accepted')
execute function public.friendships_create_dm_on_accept();

-- ── list_my_conversations: a brand-new conversation must not sort to the bottom ──
--
-- The inbox ordered by `last_message_at desc nulls last`, which was correct while every
-- conversation was created BY a message. It stops being correct the moment one can exist
-- without any: `last_message_at` is null until the first message, so the conversation
-- this migration just created for a new friend sorts BELOW every stale thread on the
-- account. The one row the user has a reason to look at is the least visible one on the
-- screen, and the inbox footer directly under it reads "New messages will tune in at the
-- top". LIV-20 AC 3 asks for the conversation to show in both chat lists; landing last
-- satisfies that literally and not usefully.
--
-- `coalesce(last_message_at, created_at)` sorts an empty conversation by when it was
-- made, which for a fresh friendship is now. Behaviour is UNCHANGED for every
-- conversation that has a message — coalesce returns last_message_at exactly as before.
-- Only the previously-unsortable null case moves.
--
-- CREATE OR REPLACE drops any attribute not restated, so `security definer` and the
-- LIV-16 `set search_path = public, pg_temp` are repeated here deliberately. Omitting the
-- search_path would silently un-pin a DEFINER function and reopen the pg_temp
-- relation-shadowing hole; supabase/tests/rls/definer-search-path.test.sql is the backstop.
--
-- Not one of the eight drifted bodies in LIV-87, so replacing it is safe.
create or replace function public.list_my_conversations()
returns table (
  id                   uuid,
  kind                 text,
  name                 text,
  avatar_url           text,
  last_message_at      timestamptz,
  last_message_preview text,
  unread_count         bigint,
  other_user_id        uuid,
  other_user_username  text,
  other_user_name      text,
  other_user_avatar    text,
  other_user_online    boolean
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    c.id,
    c.kind,
    c.name,
    c.avatar_url,
    c.last_message_at,
    c.last_message_preview,
    (
      select count(*) from messages m
      where m.conversation_id = c.id
        and m.created_at > cm_me.last_read_at
        and m.sender_id != auth.uid()
        and m.deleted_at is null
    ) as unread_count,
    case when c.kind = 'dm' then p.id          end as other_user_id,
    case when c.kind = 'dm' then p.username    end as other_user_username,
    case when c.kind = 'dm' then p.display_name end as other_user_name,
    case when c.kind = 'dm' then p.avatar_url  end as other_user_avatar,
    case when c.kind = 'dm' then
      (p.show_activity = true and p.last_seen_at > now() - interval '3 minutes')
    end as other_user_online
  from conversations c
  join conversation_members cm_me
    on cm_me.conversation_id = c.id and cm_me.user_id = auth.uid()
  left join conversation_members cm_other
    on cm_other.conversation_id = c.id and cm_other.user_id != auth.uid() and c.kind = 'dm'
  left join profiles p on p.id = cm_other.user_id
  order by coalesce(c.last_message_at, c.created_at) desc nulls last, c.created_at desc;
$$;

-- ── Backfill: existing friends ──────────────────────────────────────────────
--
-- Without this the feature is visibly inconsistent — friendships accepted after today
-- get a conversation, everyone's existing friends do not, and there is nothing in the
-- UI to explain the difference. Idempotent (skips any pair that already has a DM) and
-- bounded by the current friendship count, which is small pre-launch.
--
-- created_by follows the same rule as the trigger: the accepter.
do $$
declare
  r record;
  v_id uuid;
  v_accepter uuid;
  v_other uuid;
  v_made int := 0;
begin
  for r in
    select f.user_a_id, f.user_b_id, f.requested_by
      from public.friendships f
     where f.status = 'accepted'
       and not exists (
         select 1
           from public.conversation_members cm1
           join public.conversation_members cm2
             on cm2.conversation_id = cm1.conversation_id
           join public.conversations c
             on c.id = cm1.conversation_id
          where cm1.user_id = f.user_a_id
            and cm2.user_id = f.user_b_id
            and c.kind = 'dm'
       )
  loop
    if r.requested_by = r.user_a_id then
      v_accepter := r.user_b_id;
      v_other    := r.user_a_id;
    else
      v_accepter := r.user_a_id;
      v_other    := r.user_b_id;
    end if;

    insert into public.conversations (kind, created_by)
    values ('dm', v_accepter)
    returning id into v_id;

    insert into public.conversation_members (conversation_id, user_id, role)
    values
      (v_id, v_accepter, 'admin'),
      (v_id, v_other,    'member');

    v_made := v_made + 1;
  end loop;

  raise notice 'LIV-25 backfill: created % DM conversation(s) for existing friends', v_made;
end$$;
