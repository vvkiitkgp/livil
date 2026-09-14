-- ============================================================================
-- Blocking — sever all contact, keep all content visible
-- ============================================================================
--
-- WHY THIS EXISTS. Google Play's User Generated Content policy requires three
-- things together: in-app reporting, in-app BLOCKING, and a moderation process
-- that acts on reports. Livil had reporting only. This file is the blocking leg;
-- story reporting and the ops report queue are the other two.
--
-- ── WHAT A BLOCK DOES, AND DELIBERATELY DOES NOT DO ─────────────────────────
--
-- DOES:  severs any friendship (accepted OR pending), drops stars in BOTH
--        directions, and refuses — from either side — friend requests, stars,
--        comments, and direct messages.
--
-- DOES NOT: hide the blocked user's uploads, reposts, playlists or albums. This
--        is a product decision, made explicitly. Livil is a music platform first;
--        a catalogue that develops holes based on who fell out with whom is a
--        worse product, and hiding content is not what the policy asks for. The
--        policy asks that a user be able to stop unwanted CONTACT.
--
-- The block is one-way and invisible to the person blocked: the select policy
-- below admits the blocker only. Someone who is blocked sees no banner and no
-- error that names blocking — their friend request simply cannot be created.
-- Telling them would hand a harasser a signal to act on.
--
-- ── THE HOLE THIS ALSO CLOSES ───────────────────────────────────────────────
--
-- Unfriending was believed to stop messaging. It does not, and this is worth
-- stating plainly because the product has been reasoned about on the assumption
-- that it did.
--
--   * get_or_create_dm calls assert_friendship, so NEW dm creation is gated.
--   * msg_insert (20260528000000_chat_jam.sql) checks `sender_id = auth.uid()`
--     and conversation MEMBERSHIP. Nothing re-checks friendship.
--
-- Membership rows are never deleted when a friendship ends. So for any two people
-- who had ever opened a DM — which is everyone who has actually talked — removing
-- the friend left the thread fully writable by both sides. Unfriending stopped
-- nothing at all in the case that matters. msg_insert is replaced below.
--
-- ── WHY GUARDS LAND ON POLICIES, NOT ONLY ON RPCs ───────────────────────────
--
-- friendships_insert and follows_insert both admit a direct client INSERT
-- (`requested_by = auth.uid()` / `follower_id = auth.uid()`). Guarding only
-- send_friend_request() and add_star() would leave PostgREST as an open bypass:
-- any client can POST to /rest/v1/friendships directly. The RPC guards below are
-- for the error message; the POLICY guards are the boundary.
--
-- Forward-only and idempotent — every statement is create-or-replace / if-exists.
-- ============================================================================

-- ── The table ───────────────────────────────────────────────────────────────
create table if not exists public.blocked_users (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocked_users_no_self check (blocker_id <> blocked_id)
);

-- The PK covers (blocker_id, blocked_id). The reverse lookup — "has anyone
-- blocked me" — is what every guard below actually runs, and it has no index
-- without this one.
create index if not exists blocked_users_blocked_idx
  on public.blocked_users (blocked_id);

alter table public.blocked_users enable row level security;

-- SELECT: the blocker, and ONLY the blocker. Admitting `blocked_id = auth.uid()`
-- would let a blocked user enumerate who has blocked them, which is exactly the
-- signal a harasser would use to open a second account.
drop policy if exists blocked_users_select_own on public.blocked_users;
create policy blocked_users_select_own on public.blocked_users
  for select to authenticated
  using (blocker_id = auth.uid());

-- No INSERT or DELETE policy, on purpose. Blocking has side effects that must be
-- atomic with it — severing the friendship, dropping stars both ways — and a
-- direct insert would record the block while leaving the friendship intact. The
-- only way in is block_user() / unblock_user() below.

-- ── The predicate every guard shares ────────────────────────────────────────
-- Direction-agnostic: a block stops contact whoever initiates it. DEFINER because
-- the caller cannot see rows where they are the blocked party (by design, above),
-- so a caller-rights check would silently return false for the case that matters
-- most — someone reaching a person who blocked them.
--
-- search_path pins pg_temp per LIV-16: unlisted, Postgres searches the session
-- temp schema first and an attacker-created pg_temp.blocked_users would shadow
-- the real table inside this DEFINER body.
create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.blocked_users
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$;

revoke all on function public.is_blocked_between(uuid, uuid) from public;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;

comment on function public.is_blocked_between(uuid, uuid) is
  'Whether a block exists between two users in EITHER direction. Direction-agnostic by design: a block severs contact regardless of who initiates. Used by the friendships/follows/messages insert policies and by can_comment_on_post.';

-- ── block_user ──────────────────────────────────────────────────────────────
-- Idempotent. Severing is part of the same statement-set as the insert so a
-- block can never be recorded while the friendship survives.
create or replace function public.block_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  v_lo uuid;
  v_hi uuid;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if target_user_id = me then raise exception 'cannot_block_self'; end if;

  insert into public.blocked_users (blocker_id, blocked_id)
  values (me, target_user_id)
  on conflict do nothing;

  -- Any status, not just 'accepted': a pending request in either direction must
  -- go too, or unblocking would resurrect a request the blocker never accepted.
  select lo, hi into v_lo, v_hi from public._friendship_pair(me, target_user_id);
  delete from public.friendships
   where user_a_id = v_lo and user_b_id = v_hi;

  -- Stars are one-way, so both directions must be cleared explicitly.
  delete from public.follows
   where (follower_id = me and following_id = target_user_id)
      or (follower_id = target_user_id and following_id = me);
end;
$$;

revoke all on function public.block_user(uuid) from public;
grant execute on function public.block_user(uuid) to authenticated;

-- ── unblock_user ────────────────────────────────────────────────────────────
-- Deliberately does NOT restore the friendship or the stars. Unblocking returns
-- the pair to strangers, not to friends — restoring a relationship the blocker
-- ended would be a surprise, and the other side never consented to it either.
create or replace function public.unblock_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated'; end if;
  delete from public.blocked_users
   where blocker_id = me and blocked_id = target_user_id;
end;
$$;

revoke all on function public.unblock_user(uuid) from public;
grant execute on function public.unblock_user(uuid) to authenticated;

-- ── Policy guard: friendships ───────────────────────────────────────────────
--
-- POLICY NAMES HERE WERE TAKEN FROM PRODUCTION, NOT FROM THE MIGRATION FILES.
-- 20260530000000_relationships.sql created `friendships_insert`, but production
-- carries `friendships_insert_pending_participant` — a later hardening pass
-- renamed it and added the `status`/`accepted_at` clauses below. Guarding the
-- name in the migration file would have created a SECOND permissive policy, and
-- permissive policies are OR'd: every insert the old one allowed would still be
-- allowed and the block guard would enforce nothing at all. Verified against
-- fqzrmqnlgjeuxzinbqvs immediately before writing this.
--
-- Replaced in place under the production name, reproducing every existing clause
-- so this is purely an added guard.
drop policy if exists "friendships_insert_pending_participant" on public.friendships;
create policy "friendships_insert_pending_participant" on public.friendships
  for insert to authenticated
  with check (
    requested_by = auth.uid()
    and (user_a_id = auth.uid() or user_b_id = auth.uid())
    and user_a_id <> user_b_id
    and status = 'pending'::text
    and accepted_at is null
    and not public.is_blocked_between(user_a_id, user_b_id)
  );

-- ── Policy guard: follows (stars) ───────────────────────────────────────────
--
-- Production had TWO permissive INSERT policies here, which is worth stating
-- because their combination was already weaker than either looked:
--
--   follows_insert       (public)        follower_id = auth.uid() AND follower_id <> following_id
--   follows_insert_self  (authenticated) follower_id = auth.uid()
--
-- OR'd together, the self-follow check in the first is neutered by the second —
-- an authenticated user could follow themselves. Collapsing to ONE policy both
-- restores that check and leaves no second branch for a block to leak through.
-- Scoped to `authenticated`: anon has no business inserting a follow, and the
-- old `public` role grant was the broader of the two.
drop policy if exists "follows_insert" on public.follows;
drop policy if exists "follows_insert_self" on public.follows;
create policy "follows_insert_self" on public.follows
  for insert to authenticated
  with check (
    follower_id = auth.uid()
    and follower_id <> following_id
    and not public.is_blocked_between(follower_id, following_id)
  );

-- ── Policy guard: messages ──────────────────────────────────────────────────
-- Scoped to DMs. Blocking one member of a group conversation does not silence
-- the group: that would let one person degrade a shared space for everyone, and
-- the blocker's remedy there is to leave. A DM has exactly one other party, so
-- the block is unambiguous.
create or replace function public.dm_blocked_for_sender(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.conversations c
    join public.conversation_members cm
      on cm.conversation_id = c.id and cm.user_id <> auth.uid()
    where c.id = p_conversation_id
      and c.kind = 'dm'
      and public.is_blocked_between(auth.uid(), cm.user_id)
  );
$$;

revoke all on function public.dm_blocked_for_sender(uuid) from public;
grant execute on function public.dm_blocked_for_sender(uuid) to authenticated;

comment on function public.dm_blocked_for_sender(uuid) is
  'Whether auth.uid() is barred from writing to this conversation by a block. DMs only — a block never silences a group conversation. Used by msg_insert.';

drop policy if exists "msg_insert" on public.messages;
create policy "msg_insert" on public.messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversation_members
      where conversation_id = messages.conversation_id and user_id = auth.uid()
    )
    and not public.dm_blocked_for_sender(conversation_id)
  );

-- ── Guard: comments ─────────────────────────────────────────────────────────
-- Body reproduced from 20260803180000_enforce_comments_friends_only.sql with one
-- clause added, so the friends-only semantics it enforces are unchanged. The
-- block clause is AND-ed OUTSIDE the existing OR: a block must override every
-- permissive branch, including "it's an open post" and "we are friends" (which
-- block_user makes unreachable anyway, but the predicate should not depend on
-- that to be correct).
create or replace function public.can_comment_on_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.posts po
    join public.profiles pr on pr.id = po.author_id
    where po.id = p_post_id
      and not public.is_blocked_between(auth.uid(), po.author_id)
      and (
        po.author_id = auth.uid()
        or coalesce(pr.comments_friends_only, false) = false
        or exists (
          select 1
          from public.friendships f
          where f.status = 'accepted'
            and (
              (f.user_a_id = auth.uid() and f.user_b_id = po.author_id)
              or (f.user_b_id = auth.uid() and f.user_a_id = po.author_id)
            )
        )
      )
  );
$$;

comment on function public.can_comment_on_post(uuid) is
  'Whether auth.uid() may comment on this post: not blocked either way, AND (own post, or the post author allows everyone (comments_friends_only = false), or an accepted friendship exists). Used by post_comments_insert_self.';

-- ── RPC guards ──────────────────────────────────────────────────────────────
-- These exist for the ERROR MESSAGE, not for the boundary — the policies above
-- are the boundary. A client calling the RPC should get 'blocked' rather than a
-- policy violation it cannot interpret.
--
-- accept_friend_request and get_or_create_dm are deliberately NOT replaced here.
-- block_user deletes the friendship row outright, so accept finds no pending row
-- ('no_pending_request') and get_or_create_dm's assert_friendship raises
-- ('not_friends'). Both already fail closed, and reproducing their bodies — one
-- of which carries the LIV-11 caller-authorization fix — would risk transcription
-- drift for no behavioural gain.
create or replace function public.send_friend_request(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  v_lo uuid;
  v_hi uuid;
  v_existing record;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if target_user_id = me then raise exception 'cannot_befriend_self'; end if;
  if public.is_blocked_between(me, target_user_id) then
    raise exception 'blocked';
  end if;

  select lo, hi into v_lo, v_hi from public._friendship_pair(me, target_user_id);

  select * into v_existing from public.friendships
   where user_a_id = v_lo and user_b_id = v_hi;

  if found then
    if v_existing.status = 'accepted' then
      raise exception 'already_friends';
    end if;
    -- pending row already exists; idempotent no-op
    return;
  end if;

  insert into public.friendships (user_a_id, user_b_id, requested_by, status)
  values (v_lo, v_hi, me, 'pending');
end;
$$;

create or replace function public.add_star(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  v_lo uuid;
  v_hi uuid;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if target_user_id = me then raise exception 'cannot_star_self'; end if;
  if public.is_blocked_between(me, target_user_id) then
    raise exception 'blocked';
  end if;

  select lo, hi into v_lo, v_hi from public._friendship_pair(me, target_user_id);

  if exists (
    select 1 from public.friendships
     where user_a_id = v_lo and user_b_id = v_hi and status = 'accepted'
  ) then
    raise exception 'already_friends';
  end if;

  if exists (
    select 1 from public.follows
     where follower_id = me and following_id = target_user_id and kind = 'star'
  ) then return; end if;

  insert into public.follows (follower_id, following_id, kind)
  values (me, target_user_id, 'star');
end;
$$;

-- ── Self-verification ───────────────────────────────────────────────────────
-- Asserts the PROPERTIES, not that the statements ran. Each of these has a
-- plausible silent-failure mode: a second permissive policy re-opening a guarded
-- insert, or a later edit dropping the block clause out of a replaced body.
do $$
declare
  v_check text;
  v_count int;
begin
  if not exists (
    select 1 from pg_tables
     where schemaname = 'public' and tablename = 'blocked_users' and rowsecurity
  ) then
    raise exception 'blocked_users is missing or has RLS disabled';
  end if;

  -- Exactly one INSERT policy per guarded table, and it consults the predicate.
  for v_check, v_count in
    select 'friendships'::text, count(*)::int from pg_policies
     where schemaname = 'public' and tablename = 'friendships' and cmd = 'INSERT'
    union all
    select 'follows'::text, count(*)::int from pg_policies
     where schemaname = 'public' and tablename = 'follows' and cmd = 'INSERT'
    union all
    select 'messages'::text, count(*)::int from pg_policies
     where schemaname = 'public' and tablename = 'messages' and cmd = 'INSERT'
  loop
    if v_count <> 1 then
      raise exception
        'expected exactly 1 INSERT policy on %, found % — a second permissive policy would OR the guard away',
        v_check, v_count;
    end if;
  end loop;

  select with_check into v_check from pg_policies
   where schemaname = 'public' and tablename = 'friendships' and cmd = 'INSERT';
  if v_check not like '%is_blocked_between%' then
    raise exception 'friendships insert policy does not consult is_blocked_between: %', v_check;
  end if;
  -- The clauses the production policy already had. Reproducing a policy by hand
  -- is exactly where a clause goes quietly missing, so assert them back.
  if v_check not like '%pending%' or v_check not like '%accepted_at%' then
    raise exception 'friendships insert policy lost its pending/accepted_at clauses: %', v_check;
  end if;

  select with_check into v_check from pg_policies
   where schemaname = 'public' and tablename = 'follows' and cmd = 'INSERT';
  if v_check not like '%is_blocked_between%' then
    raise exception 'follows insert policy does not consult is_blocked_between: %', v_check;
  end if;

  select with_check into v_check from pg_policies
   where schemaname = 'public' and tablename = 'messages' and cmd = 'INSERT';
  if v_check not like '%dm_blocked_for_sender%' then
    raise exception 'msg_insert does not consult dm_blocked_for_sender: %', v_check;
  end if;

  select prosrc into v_check from pg_proc
   where oid = 'public.can_comment_on_post(uuid)'::regprocedure;
  if v_check not like '%is_blocked_between%' then
    raise exception 'can_comment_on_post lost its block clause';
  end if;
end $$;
