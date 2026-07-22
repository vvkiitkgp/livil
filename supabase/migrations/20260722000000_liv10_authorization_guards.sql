-- ============================================================================
-- LIV-10 — close the six live authorization defects recorded in ADR-0008
-- ============================================================================
--
-- ADR-0008's central finding: deriving a notification's recipient server-side makes
-- the notification FAITHFUL to the row. It does not make the row LEGITIMATE. Six
-- places let an authenticated user manufacture the originating row, and every one of
-- them has the same shape as D-02/D-53 — the code proves the caller is SIGNED IN and
-- then acts on a resource named in the parameters without checking whether they may
-- touch it.
--
-- Authentication is not authorization. `if v_me is null then return; end if` is an
-- authentication check. Nothing below relies on one.
--
-- WHAT THIS FILE CHANGES, and why each is the smallest complete fix:
--
--   1. conversation_members.members_insert — the self-admin chain (D-53's exact shape)
--   2. friendships write policies — status was unconstrained on insert and update
--   3. activity_notify_post (BOTH overloads) — no proof the caller acted on the post
--   4. activity_notify_new_fan — no proof the caller starred the target
--   5. activity_notify_friend_outcome — no proof a request existed; emission moved
--      into accept/reject_friend_request, the transactions that can actually prove it
--   6. activity_record_play / post_views — the RPC guard AND the direct-table path
--   7. revoke execute from public + anon on the four surviving notification
--      entry points (a fifth, a dead activity_notify_post overload, is dropped)
--
-- Forward-only. Every statement is `if not exists` / `drop ... if exists` guarded and
-- is a no-op when re-applied. Policies are OR'd, so every replacement DROPS the old
-- name first — a leftover permissive policy defeats the scoped one that replaced it,
-- which is exactly how `follows_select` survived until 20260720192324.
-- ============================================================================


-- ============================================================================
-- 1. conversation_members — the self-admin chain
-- ============================================================================
--
-- THE DEFECT (20260528000000_chat_jam.sql:238, verified live 2026-07-22)
--
--   members_insert WITH CHECK:
--     (user_id = auth.uid())                       -- clause 1
--     OR (caller is an admin of that conversation) -- clause 2
--
-- Clause 1 constrains neither `role` nor `conversation_id`. So:
--   conv_insert only checks created_by = auth.uid() -> create a conversation;
--   insert yourself into it with role = 'admin'     -> passes clause 1;
--   insert ANY victim                               -> passes clause 2.
-- msg_insert then passes, and list_my_conversations() filters on membership with no
-- friendship join. get_or_create_dm's assert_friendship is bypassed by never calling
-- the RPC. This is the jam_room_members bug of 20260721120000, on a different table;
-- that migration fixed one instance and left this one open.
--
-- THE FIX — corrected after a BLOCKING security review of the first attempt.
--
-- The first version of this policy deleted clause 1 and constrained clause 2 to
-- role = 'member', on the stated rationale that admin membership could only be
-- obtained through a DEFINER path gated by assert_friendship. THAT RATIONALE WAS
-- FALSE, and the chain survived intact:
--
--   create_group (20260720192310:119-130) validates members inside
--     `foreach v_uid in array p_member_ids loop`
--   An EMPTY array iterates zero times, so assert_friendship never runs — and the
--   caller is then inserted as 'admin' unconditionally, by a DEFINER function that
--   bypasses RLS.
--
--   So: rpc/create_group with p_member_ids = [] mints an admin membership for an
--   attacker with zero friends and zero memberships; the role='member' constraint is
--   then satisfied trivially and any victim can be inserted. Constraining WHAT ROLE an
--   admin may grant, while leaving WHO may be granted it unconstrained, closed nothing.
--
-- The lesson is the one 20260721120000 already recorded and this file failed to copy:
-- constrain the RELATIONSHIP, not the shape of the row. That migration required the
-- inserted member to belong to the jam's parent conversation. The equivalent here is
-- the rule create_group already means to enforce per member — you may only pull your
-- own accepted friends into a conversation.
--
-- VERIFIED not to deny any legitimate caller. The only direct-table insert the client
-- makes is addGroupMember() (src/services/conversations.ts:124-131), reached solely
-- from GroupInfoScreen's picker, whose loadFriends() (:192-199) selects from
-- friendships with status = 'accepted' and the caller as a participant. The picker
-- cannot offer a non-friend, so this policy cannot refuse one.
--
-- Both halves are kept — friendship AND role = 'member' — because they answer
-- different questions, and the review showed what happens when only one is asked.

drop policy if exists "members_insert" on public.conversation_members;

create policy "members_insert" on public.conversation_members
  for insert to authenticated
  with check (
    -- An existing ADMIN of this exact conversation…
    -- Note the correlated reference to conversation_members.conversation_id: the row
    -- being inserted must land in a conversation the caller already administers.
    exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = conversation_members.conversation_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
    )
    -- …may add one of their own accepted friends…
    -- This is the clause whose absence made the whole policy inert: without it, an
    -- admin membership minted by create_group([]) admits ANY user in the product.
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.user_a_id = auth.uid() and f.user_b_id = conversation_members.user_id)
          or (f.user_b_id = auth.uid() and f.user_a_id = conversation_members.user_id))
    )
    -- …as an ordinary member. No client path grants admin; an admin minting further
    -- admins is a durability escalation with no feature behind it.
    and coalesce(conversation_members.role, 'member') = 'member'
  );

-- Defence in depth, and the root of the bypass above: refuse to mint an admin
-- membership for a group that has no members to be friends with. The loop that
-- validates p_member_ids is the ONLY authorization in create_group, so an empty array
-- makes the function unauthorized by construction.
--
-- NOTE the check is "at least one member OTHER THAN the caller", not "the array is
-- non-empty". The review proposed rejecting an empty array; that is one character
-- short of the hole, because the loop body is guarded by `if v_uid <> v_me`, so
-- p_member_ids = [caller] also iterates without ever calling assert_friendship and
-- mints exactly the same memberless admin row.
--
-- VERIFIED not to deny any legitimate caller. create_group has exactly one caller —
-- createGroup() (src/services/conversations.ts:66-73), reached only from
-- NewConversationScreen:182, which already refuses an empty selection twice: a guard
-- at :176 ("Select at least one friend") and a disabled submit button at :363.
--
-- Body otherwise VERBATIM from 20260720192310.
create or replace function public.create_group(p_name text, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id   uuid;
  v_me   uuid := auth.uid();
  v_uid  uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  -- AUTHORIZATION: a member list containing nobody but the caller means the loop
  -- below checks nothing, and the caller would still be written in as admin.
  if (select count(*) from unnest(coalesce(p_member_ids, '{}'::uuid[])) u
       where u <> v_me) < 1 then
    raise exception 'group_requires_members';
  end if;

  -- AUTHORIZATION: validate every member BEFORE creating anything, so a rejected
  -- member cannot leave a half-built group behind.
  foreach v_uid in array p_member_ids loop
    if v_uid <> v_me then
      perform assert_friendship(v_me, v_uid);
    end if;
  end loop;

  insert into conversations (kind, name, created_by)
  values ('group', p_name, v_me)
  returning id into v_id;

  insert into conversation_members (conversation_id, user_id, role)
  values (v_id, v_me, 'admin');

  foreach v_uid in array p_member_ids loop
    if v_uid <> v_me then
      insert into conversation_members (conversation_id, user_id, role)
      values (v_id, v_uid, 'member')
      on conflict (conversation_id, user_id) do nothing;
    end if;
  end loop;

  return v_id;
end;
$function$;

-- The same chain is reachable one step later through UPDATE. members_update was
-- `using (user_id = auth.uid())` with NO WITH CHECK, so any member of any conversation
-- could rewrite their own row to role = 'admin' and then satisfy the insert policy
-- above. Fixing the insert without this leaves the escalation intact for anyone
-- already inside a group.
--
-- RLS cannot compare OLD to NEW, so the WITH CHECK below pins the row's identity to
-- the caller and a trigger freezes the privilege column. A trigger — not a
-- column-level GRANT — because the CI harness re-runs
-- `grant all on all tables in schema public to authenticated` after migrations, which
-- would silently undo a column grant and leave this test passing for the wrong reason.

drop policy if exists "members_update" on public.conversation_members;

create policy "members_update" on public.conversation_members
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.conversation_members_freeze_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- last_read_at is the only column the client updates (markAsRead). Membership
  -- identity and role are granted by an admin or by a SECURITY DEFINER RPC; they are
  -- never self-service. Raising insufficient_privilege rather than silently ignoring
  -- the change: a rejected privilege escalation should be visible.
  --
  -- IF YOU ARE HERE BECAUSE A PROMOTE-TO-ADMIN FEATURE HIT THIS EXCEPTION: this fires
  -- for EVERY caller, including a future SECURITY DEFINER RPC, because triggers run
  -- regardless of who is executing. Nothing does that today. When something does, give
  -- it a named exemption (a session GUC set by that RPC, or an explicit condition
  -- here) rather than deleting the trigger — deleting it reopens self-promotion for
  -- every member of every conversation.
  if new.role is distinct from old.role
     or new.user_id is distinct from old.user_id
     or new.conversation_id is distinct from old.conversation_id then
    raise exception 'conversation_member_identity_is_immutable'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_conversation_members_freeze_identity
  on public.conversation_members;

create trigger trg_conversation_members_freeze_identity
  before update on public.conversation_members
  for each row
  execute function public.conversation_members_freeze_identity();


-- ============================================================================
-- 2. friendships — status was unconstrained on both insert and update
-- ============================================================================
--
-- THE DEFECT (verified live 2026-07-22)
--
--   friendships_update             (20260530000000:28) — bare USING, NO WITH CHECK
--   friendships_update_participant (baseline:376)      — WITH CHECK on participation
--                                                        only, not on status
--   friendships_insert             (20260530000000:20) — constrains requested_by,
--                                                        participation, self-edge —
--                                                        NOT status
--   friendships_insert_participant (baseline:372)      — same, and weaker still
--
-- friendships_status_check permits 'accepted'. One POST therefore manufactures a
-- mutual friendship, defeating accept_friend_request's guard by never calling it, and
-- unlocking assert_friendship -> DMs, groups, jams, stories_select, playlists_select,
-- playlist_posts_select, listen_sessions_select_circle.
--
-- BOTH policies on each command matter. Permissive policies OR together: constraining
-- friendships_update while friendships_update_participant still permits the write
-- changes nothing at all.
--
-- THE FIX
--
--   UPDATE: dropped outright, both policies. Every legitimate status transition runs
--   in a SECURITY DEFINER RPC (accept_friend_request, and nothing else writes status)
--   which bypasses RLS as the table owner. Grep of src/ finds no direct
--   .from('friendships').update() — reads only. A policy that exists for no caller is
--   pure attack surface.
--
--   INSERT: retained, because a pending request is a legitimate row shape, but pinned
--   to status = 'pending' with accepted_at null. That is exactly what
--   send_friend_request writes.
--
--   DELETE and SELECT are untouched: deleting a friendship you are part of is
--   equivalent to remove_friend/cancel_friend_request, and select is already
--   participant-scoped.

drop policy if exists "friendships_update"             on public.friendships;
drop policy if exists "friendships_update_participant" on public.friendships;

drop policy if exists "friendships_insert"             on public.friendships;
drop policy if exists "friendships_insert_participant" on public.friendships;

drop policy if exists "friendships_insert_pending_participant" on public.friendships;
create policy "friendships_insert_pending_participant" on public.friendships
  for insert to authenticated
  with check (
    requested_by = auth.uid()
    and (user_a_id = auth.uid() or user_b_id = auth.uid())
    and user_a_id <> user_b_id
    -- The clause whose absence was the defect.
    and status = 'pending'
    and accepted_at is null
  );


-- ============================================================================
-- 3. activity_notify_post — BOTH overloads
-- ============================================================================
--
-- THE DEFECT: guards were (a) actor authenticated, (b) p_type in the enum, (c) author
-- exists and is not the actor. Nothing checked that the caller liked, commented on, or
-- reposted the post. p_comment_text was attacker-supplied, truncated to 280 chars,
-- stored to payload.comment_text and rendered inline in the victim's activity center
-- (src/services/activity.ts:157-160) — a message with NO post_comments row behind it,
-- so the recipient cannot report, delete or attribute it. That is the moderation-
-- evasion harm ADR-0008 named.
--
-- THE FIX
--   like    -> a post_likes row by the actor on this post must exist
--   comment -> a post_comments row by the actor on this post must exist, AND the
--              snippet is READ FROM that row instead of being trusted from the
--              parameter. p_comment_text becomes advisory and is ignored; there is no
--              longer any attacker-chosen text in the payload.
--   repost  -> a posts row (kind='repost') by the actor pointing at this post
--
-- Every one of those rows is committed by the client BEFORE the RPC is called
-- (posts.ts:601-607, comments.ts:159-179, posts.ts:477-496), so no legitimate call
-- loses its notification.
--
-- On failure the function returns an empty set rather than raising — identical to the
-- existing self-action path, so notifyPostActivity()'s `if (!row) return` handles it
-- and no user-visible error appears for a benign race (like-then-immediately-unlike).
-- The security property is "no row is written", and that holds either way.
--
-- THE TWO OVERLOADS — and a finding that changes what "fix both" means.
--
-- 20260608000000 created activity_notify_post(uuid, text) and 20260608000002 created
-- activity_notify_post(uuid, text, text default null, uuid default null). Both are
-- live. The ticket's concern is that a fix to one silently misses the other, and that
-- is right in principle. In fact the 2-arg overload is UNREACHABLE:
--
--   livil=# select activity_notify_post('…'::uuid, 'like'::text);
--   ERROR:  function activity_notify_post(uuid, text) is not unique
--
-- Verified against a full replay of the migration set WITHOUT this file. Two
-- candidates match a 2-argument call — the exact 2-arg signature, and the 4-arg one
-- through its defaults — and PostgreSQL cannot choose. PostgREST calls by named
-- argument, which does not disambiguate either. So since 2026-06-08 any 2-argument
-- caller has received an error, and the current client is unaffected only because it
-- always sends all four named arguments.
--
-- Therefore the 2-arg form is DROPPED rather than patched. Dropping it: removes an
-- unguardable entry point, removes the ambiguity, and makes a 2-argument call resolve
-- to the guarded 4-arg function through its defaults — i.e. an old client that gets
-- an error today would start working, on the checked path. Keeping it and rewriting
-- it as a delegator would leave the ambiguity error in place and leave a function no
-- test could invoke.

drop function if exists public.activity_notify_post(uuid, text);

create or replace function public.activity_notify_post(
  p_post_id      uuid,
  p_type         text,                 -- 'like' | 'comment' | 'repost'
  p_comment_text text default null,    -- IGNORED; retained for wire compatibility
  p_comment_id   uuid default null
) returns table (
  recipient_id          uuid,
  notification_id       uuid,
  agg_count             int,
  actor_display_name    text,
  recipient_should_push boolean
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_actor   uuid := auth.uid();
  v_author  uuid;
  v_agg_key text;
  v_id      uuid;
  v_count   int;
  v_name    text;
  v_payload jsonb := '{}'::jsonb;
  v_body    text;
begin
  if v_actor is null then return; end if;
  if p_type not in ('like','comment','repost') then return; end if;

  select author_id into v_author from posts where id = p_post_id;
  if v_author is null or v_author = v_actor then return; end if;

  -- ── AUTHORIZATION: the caller must have actually performed the action ──────
  -- Authentication got us this far and proves nothing about this post.
  if p_type = 'like' then
    if not exists (
      select 1 from post_likes
      where post_id = p_post_id and user_id = v_actor
    ) then return; end if;

  elsif p_type = 'comment' then
    if not exists (
      select 1 from post_comments
      where post_id = p_post_id and author_id = v_actor
    ) then return; end if;

  else -- repost
    if not exists (
      select 1 from posts
      where original_post_id = p_post_id
        and author_id = v_actor
        and kind = 'repost'
    ) then return; end if;
  end if;

  select coalesce(display_name, '@' || username) into v_name
    from profiles where id = v_actor;

  if p_type = 'comment' and p_comment_id is not null then
    -- Snippet is read from the stored comment, never from the parameter. If the id
    -- does not name a comment the actor wrote on this post, v_body is null and the
    -- notification simply carries no snippet.
    select body into v_body
      from post_comments
     where id = p_comment_id
       and post_id = p_post_id
       and author_id = v_actor;

    if v_body is not null then
      v_payload := v_payload || jsonb_build_object(
        'comment_text', substring(v_body from 1 for 280),
        'comment_id',   p_comment_id
      );
    end if;
  end if;

  if p_type = 'like' then
    v_agg_key := 'like:' || p_post_id::text;
    insert into activity_notifications
      (recipient_id, type, actor_id, post_id, agg_key, agg_count, updated_at)
    values
      (v_author, 'like', v_actor, p_post_id, v_agg_key, 1, now())
    on conflict (recipient_id, agg_key) where agg_key is not null do update
      set agg_count  = activity_notifications.agg_count + 1,
          actor_id   = excluded.actor_id,
          is_read    = false,
          updated_at = now()
    returning id, agg_count into v_id, v_count;
  else
    insert into activity_notifications
      (recipient_id, type, actor_id, post_id, payload, updated_at)
    values
      (v_author, p_type, v_actor, p_post_id, v_payload, now())
    returning id, 1 into v_id, v_count;
  end if;

  return query select v_author, v_id, v_count, v_name, true;
end;
$$;


-- ============================================================================
-- 4. activity_notify_new_fan — no proof the caller starred the target
-- ============================================================================
--
-- THE DEFECT: the entire guard was
--   `if v_me is null or p_target = v_me then return null; end if;`
-- Authentication, plus a self-notify filter. Any authenticated user could write
-- unlimited "X started listening to you" rows into any other user's row space —
-- agg_key is null for new_fan so the partial unique index does not apply.
--
-- THE FIX: require the star edge. add_star() commits it before
-- notifyNewFan() is called (src/services/relationships.ts:109-113), and the edge
-- persists, so the legitimate path is unaffected.
--
-- NOT FIXED HERE, deliberately: a caller who genuinely holds a star edge can still
-- call this in a loop and write unbounded rows, because new_fan has no agg_key. That
-- is write amplification, not forgery; adding an agg_key would suppress a genuine
-- second notification after an unstar/restar, which is a product decision. Recorded
-- in the PR as a follow-up rather than decided here.

create or replace function public.activity_notify_new_fan(p_target uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_id uuid;
begin
  if v_me is null or p_target = v_me then return null; end if;

  -- AUTHORIZATION: you may only announce a star you actually placed.
  if not exists (
    select 1 from follows
    where follower_id = v_me and following_id = p_target and kind = 'star'
  ) then
    return null;
  end if;

  insert into activity_notifications (recipient_id, type, actor_id, updated_at)
  values (p_target, 'new_fan', v_me, now())
  returning id into v_id;
  return v_id;
end;
$$;


-- ============================================================================
-- 5. activity_notify_friend_outcome — emission moved to where proof exists
-- ============================================================================
--
-- THE DEFECT: same shape as new_fan. No check that a request existed, so
-- "X accepted your friend request" / "X declined your friend request" could be forged
-- at any user.
--
-- WHY THE OBVIOUS FIX DOES NOT WORK, and this is the part worth reading:
--
--   The ticket's suggested guard is "a pending request exists". By the time this RPC
--   is called there is no pending request, in EITHER outcome:
--     accept -> accept_friend_request has already set status = 'accepted'
--     reject -> reject_friend_request has already DELETED the row
--   src/services/relationships.ts:85-97 calls the RPC after the outcome RPC returns.
--   A pending-request guard would have denied 100% of legitimate notifications. That
--   is precisely the over-restrictive fix the positive tests exist to catch.
--
--   For reject there is no post-hoc evidence AT ALL — the row is gone. No guard
--   written inside this function can distinguish a real rejection from a forged one.
--
-- THE FIX: emit the row from the transaction that performs the action, which is the
-- only place the proof exists. This is ADR-0008 decision #2 applied to these two
-- kinds ("notification emission is server-side, in the database, in the same
-- transaction as the write that causes it"). accept_friend_request and
-- reject_friend_request already hold the pending row (accept takes it FOR UPDATE) and
-- already reject a non-participant, a non-pending row, and one's own request.
--
-- activity_notify_friend_outcome is then kept as a no-op for wire compatibility:
-- the client still calls it (src/ is propose-only for this agent) and a 404 would be
-- swallowed into a console.warn, but leaving a forgeable emitter in place to avoid a
-- log line is not a trade worth making. It returns null and writes nothing.
--
-- Bodies below are otherwise VERBATIM from 20260530000000_relationships.sql.

create or replace function public.accept_friend_request(other_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  v_lo uuid;
  v_hi uuid;
  v_existing record;
begin
  if me is null then raise exception 'not_authenticated'; end if;

  select lo, hi into v_lo, v_hi from _friendship_pair(me, other_user_id);

  select * into v_existing from friendships
   where user_a_id = v_lo and user_b_id = v_hi
   for update;

  if not found then raise exception 'no_pending_request'; end if;
  if v_existing.status <> 'pending' then raise exception 'not_pending'; end if;
  if v_existing.requested_by = me then raise exception 'cannot_accept_own_request'; end if;

  update friendships
     set status = 'accepted', accepted_at = now()
   where user_a_id = v_lo and user_b_id = v_hi;

  delete from follows
   where kind = 'star'
     and ((follower_id = me and following_id = other_user_id)
       or (follower_id = other_user_id and following_id = me));

  -- Emission, in the transaction that proved the request existed and was pending and
  -- was not the caller's own. The recipient is the requester, derived here rather
  -- than taken from a parameter (ADR-0008 decision #1).
  insert into activity_notifications (recipient_id, type, actor_id, updated_at)
  values (other_user_id, 'friend_accepted', me, now());
end;
$$;

create or replace function public.reject_friend_request(other_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  v_lo uuid;
  v_hi uuid;
  v_existing record;
begin
  if me is null then raise exception 'not_authenticated'; end if;

  select lo, hi into v_lo, v_hi from _friendship_pair(me, other_user_id);

  select * into v_existing from friendships
   where user_a_id = v_lo and user_b_id = v_hi;

  if not found then return; end if;
  if v_existing.status <> 'pending' then raise exception 'not_pending'; end if;
  if v_existing.requested_by = me then raise exception 'cannot_reject_own_request'; end if;

  delete from friendships where user_a_id = v_lo and user_b_id = v_hi;

  -- Emitted immediately after the delete, in the same transaction that proved the
  -- request was pending and was not the caller's own. Same reasoning as accept: this
  -- is the last point at which the proof existed.
  insert into activity_notifications (recipient_id, type, actor_id, updated_at)
  values (other_user_id, 'friend_rejected', me, now());
end;
$$;

-- Retained, inert. See the block comment above.
create or replace function public.activity_notify_friend_outcome(
  p_other_user uuid, p_accepted boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  -- DELIBERATELY EMPTY. friend_accepted / friend_rejected rows are emitted by
  -- accept_friend_request / reject_friend_request, which are the only contexts that
  -- can prove the outcome happened. This function cannot prove it and therefore must
  -- not write. Do not "restore" the insert.
  return null;
end;
$$;


-- ============================================================================
-- 6. activity_record_play + post_views — the RPC AND the table
-- ============================================================================
--
-- THE DEFECT: a SECURITY DEFINER insert into post_views guarded only by
-- `auth.uid() is not null`, with deliberately no dedup. posts.views_count is a term in
-- the feed ranking score (20260707000000_home_feed_single_call.sql:92).
--
-- WHAT IS ACTUALLY WRONG HERE, stated honestly, because it is not the same defect as
-- the other five:
--
--   There is no resource-authorization check to add. posts_select_authenticated is
--   `using (true)` — every authenticated user may see and therefore play every post.
--   "Did the caller perform the action" is unanswerable: the post_views row IS the
--   only record of the action. So the defect is not forgery of someone else's action;
--   it is that a ranking signal is unboundedly self-service.
--
--   And guarding the RPC alone would repeat D-53 exactly. post_views carried
--   `post_views_insert_self ... with check (user_id = auth.uid())`, so a direct POST
--   to /rest/v1/post_views inflates views_count through trg_post_views_count without
--   the RPC being involved at all. Any guard placed only in the function is decoration.
--
-- THE FIX, two halves:
--
--   (a) Close the direct-table path. No client code inserts post_views directly —
--       `git log -S "from('post_views')"` shows the last such caller removed in
--       f3812b2 when the RPC was introduced, and grep of src/ finds none today. The
--       RPC is SECURITY DEFINER and owned by the table owner, so it is unaffected.
--       With the policy gone, post_views has no insert policy and direct inserts are
--       denied by default.
--
--   (b) Bound the funnel. A per-(user, post) cooldown, NOT dedup: looping a track
--       must keep counting (20260607000005 made that deliberate). One second is
--       derived from the client, not guessed — playTracker.ts requires
--       THRESHOLD_SEC = 3 seconds of forward playback per recorded play, and the
--       fastest rate the app can produce is RATE_FORWARD = 2x
--       (FloatingPlayer.tsx:593), so the shortest legitimate gap between two recorded
--       plays of one post by one user is ~1.5s wall clock. A 1s window is strictly
--       below that floor and drops no legitimate play.
--
--   The cooldown SKIPS the insert silently and still returns the current count, so
--   recordPlay() sees a normal response and no toast fires.
--
-- WHAT THIS DOES NOT SOLVE, and belongs in its own ticket: one account can still add
-- 1 view/second/post, and nothing here resists a distributed or multi-account attack.
-- Making the ranking term robust (distinct viewers, or a windowed count) is a feed
-- design change, not an authorization fix.

drop policy if exists "post_views_insert_self" on public.post_views;

create or replace function public.activity_record_play(p_post_id uuid)
returns table (
  views_count         int,
  milestone_recipient uuid,
  milestone_threshold int
)
language plpgsql security definer set search_path = public as $$
declare
  v_actor      uuid := auth.uid();
  v_author     uuid;
  v_kind       text;
  v_count      int;
  v_threshold  int;
  v_thresholds int[] := array[5,25,100,500,1000,5000,10000];
  v_inserted   uuid;
  v_recent     boolean;
begin
  if v_actor is null then return; end if;

  -- RATE LIMIT (see block comment): 1s per (user, post). Supported by
  -- post_views_user_id_played_at_idx (user_id, played_at desc).
  select exists (
    select 1 from post_views
    where post_id = p_post_id
      and user_id = v_actor
      and played_at > now() - interval '1 second'
  ) into v_recent;

  if not v_recent then
    insert into post_views (post_id, user_id) values (p_post_id, v_actor);
  end if;

  select author_id, kind, posts.views_count
    into v_author, v_kind, v_count
    from posts where id = p_post_id;

  if v_author is null then
    return query select coalesce(v_count, 0), null::uuid, null::int;
    return;
  end if;

  if v_kind = 'upload' and v_author <> v_actor then
    select t into v_threshold from unnest(v_thresholds) t where t = v_count limit 1;
    if v_threshold is not null then
      insert into activity_notifications
        (recipient_id, type, actor_id, post_id, agg_key, payload, updated_at)
      values
        (v_author, 'play_milestone', null, p_post_id,
         'milestone:' || p_post_id::text || ':' || v_threshold::text,
         jsonb_build_object('threshold', v_threshold), now())
      on conflict (recipient_id, agg_key) where agg_key is not null do nothing
      returning id into v_inserted;

      if v_inserted is not null then
        return query select v_count, v_author, v_threshold;
        return;
      end if;
    end if;
  end if;

  return query select v_count, null::uuid, null::int;
end;
$$;


-- ============================================================================
-- 7. EXECUTE privileges — the first revoke in 38 migrations
-- ============================================================================
--
-- `grep -rn "revoke" supabase/migrations/` returned zero hits before this file, so
-- every function above ran on the PostgreSQL default EXECUTE TO PUBLIC, and proacl
-- confirmed an explicit `anon=X` on top of it. anon is the key compiled into the
-- mobile app and published on the marketing site.
--
-- None of these five is reachable before sign-in: each is a notification emitted after
-- an action, and each already returns early when auth.uid() is null. Revoking is
-- defence in depth, and it removes the class of bug where a future edit forgets that
-- early return.
--
-- Scoped to exactly the four surviving entry points this ticket touches (the fifth,
-- activity_notify_post(uuid, text), was dropped above). A project-wide audit of
-- the other ~35 functions is a separate ticket — a blanket revoke across the schema
-- would be a change nobody in this PR verified.
--
-- The explicit grant to `authenticated` is NOT redundant: revoking from PUBLIC removes
-- the privilege the signed-in client may have been relying on, if its access came from
-- PUBLIC rather than from an explicit grant. Granting it back by name makes the intent
-- readable and the outcome independent of which it was.

-- Four signatures, not five: activity_notify_post(uuid, text) was dropped above.
revoke execute on function public.activity_notify_post(uuid, text, text, uuid)  from public, anon;
revoke execute on function public.activity_notify_new_fan(uuid)                 from public, anon;
revoke execute on function public.activity_notify_friend_outcome(uuid, boolean) from public, anon;
revoke execute on function public.activity_record_play(uuid)                    from public, anon;

grant execute on function public.activity_notify_post(uuid, text, text, uuid)  to authenticated;
grant execute on function public.activity_notify_new_fan(uuid)                 to authenticated;
grant execute on function public.activity_notify_friend_outcome(uuid, boolean) to authenticated;
grant execute on function public.activity_record_play(uuid)                    to authenticated;


-- ============================================================================
-- 8. Apply-time drift check — the part this file cannot verify by reading source
-- ============================================================================
--
-- Policies are PERMISSIVE and therefore OR together. Every drop above names the
-- policies recorded in this repository's migrations, but the baseline (which was
-- reflected from production on 2026-07-21) documents at :353 and :366 that production
-- ALSO carried unscoped duplicates of several policies under different names. This
-- migration was written without live database access, so it cannot enumerate them.
--
-- A permissive duplicate left in place defeats the scoped policy that replaced it —
-- that is precisely how `follows_select` survived until 20260720192324, and it is the
-- single most likely way this fix fails silently.
--
-- So the migration refuses to report success while an unrecognised write policy
-- survives on any of the three tables it just repaired. This ABORTS the apply, by
-- design: a half-applied perimeter that looks applied is worse than a failed apply.
-- If it fires, the exception names the offending policies; drop them and re-run.
--
-- polcmd: 'a' = insert, 'w' = update, '*' = all (which grants both).
do $$
declare
  v_extra text;
  v_norls text;
begin
  -- FIRST: a policy on a table with RLS disabled is inert. Every `create policy` above
  -- would be decoration, the policy scan below would find nothing to complain about,
  -- and this migration would report success on a perimeter that does not exist.
  -- Checked before the policy scan because it invalidates the policy scan's meaning.
  select string_agg(relname, ', ') into v_norls
    from pg_class
   where oid in ('public.conversation_members'::regclass,
                 'public.friendships'::regclass,
                 'public.post_views'::regclass)
     and not relrowsecurity;

  if v_norls is not null then
    raise exception
      'LIV-10 aborted: row-level security is DISABLED on %, so every policy in this migration is inert',
      v_norls;
  end if;

  select string_agg(format('%s (%s on %s)', polname, polcmd, polrelid::regclass), ', ')
    into v_extra
  from pg_policy
  where polcmd in ('a', 'w', '*')
    and (
      (polrelid = 'public.conversation_members'::regclass
        and polname not in ('members_insert', 'members_update'))
      or (polrelid = 'public.friendships'::regclass
        and polname not in ('friendships_insert_pending_participant'))
      or (polrelid = 'public.post_views'::regclass)
    );

  if v_extra is not null then
    raise exception
      'LIV-10 aborted: unrecognised write policies survive and will OR with the new ones: %',
      v_extra;
  end if;
end $$;
