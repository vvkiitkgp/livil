-- ============================================================================
-- A DM may only be written by friends
-- ============================================================================
--
-- Found while making the composer explain itself. The app was about to hide the
-- text field for a non-friend on the grounds that "you cannot message someone
-- you are not friends with" — and that turned out not to be true.
--
-- `msg_insert` checks sender identity, conversation MEMBERSHIP, and (since
-- 20260808100000) blocking. Never friendship. `get_or_create_dm` calls
-- assert_friendship, so a DM cannot be CREATED between non-friends — but
-- membership rows are never removed when a friendship ends, so two people who
-- were friends, talked, and then unfriended could carry on messaging forever.
-- Verified against production before writing this: `are_friends=false`,
-- `non-friend send = ALLOWED`.
--
-- This is the same shape as the hole 20260808100000 closed for blocking, one
-- predicate over: the guard was placed on the DOOR (get_or_create_dm) and not on
-- the ROOM (msg_insert), so anyone already inside kept their privileges.
--
-- Hiding the composer without this would have been a lie of the comfortable
-- kind — the UI would say you cannot, while the API said you can.
--
-- ── GROUPS ARE DELIBERATELY EXEMPT ──────────────────────────────────────────
--
-- Only `kind = 'dm'` requires friendship. A group is a room you were invited
-- into, and requiring every member to be friends with every other would break
-- every group that contains two strangers — which is most of them. Membership
-- is the authorization for a group; friendship is the authorization for a DM.
--
-- ── REPLACES dm_blocked_for_sender ──────────────────────────────────────────
--
-- That function answered half of this question. Rather than have two helpers
-- disagreeing about who may write, it is dropped and `can_write_to_conversation`
-- answers the whole question in one place. Nothing else referenced it.
-- ============================================================================

create or replace function public.can_write_to_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    -- Groups: membership is the authorization, checked by the policy itself.
    when not exists (
      select 1 from public.conversations c
      where c.id = p_conversation_id and c.kind = 'dm'
    ) then true
    -- DMs: every other member must be an unblocked friend. "every other member"
    -- rather than "the other member" because nothing in the schema guarantees a
    -- dm has exactly two — and if one ever had three, failing closed is right.
    else not exists (
      select 1
      from public.conversation_members cm
      where cm.conversation_id = p_conversation_id
        and cm.user_id <> auth.uid()
        and (
          public.is_blocked_between(auth.uid(), cm.user_id)
          or not public.are_friends(auth.uid(), cm.user_id)
        )
    )
  end;
$$;

revoke all on function public.can_write_to_conversation(uuid) from public;
revoke execute on function public.can_write_to_conversation(uuid) from anon;
grant execute on function public.can_write_to_conversation(uuid) to authenticated;

comment on function public.can_write_to_conversation(uuid) is
  'Whether auth.uid() may post to this conversation. Groups: always true, membership is checked by the policy. DMs: every other member must be an unblocked friend. Replaces dm_blocked_for_sender, which answered only the blocking half.';

drop policy if exists "msg_insert" on public.messages;
create policy "msg_insert" on public.messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversation_members
      where conversation_id = messages.conversation_id and user_id = auth.uid()
    )
    and public.can_write_to_conversation(conversation_id)
  );

drop function if exists public.dm_blocked_for_sender(uuid);

-- ── Self-verification ───────────────────────────────────────────────────────
do $$
declare
  v_check text;
  n int;
begin
  select count(*) into n from pg_policies
   where schemaname='public' and tablename='messages' and cmd='INSERT';
  if n <> 1 then
    raise exception 'expected exactly 1 INSERT policy on messages, found %', n;
  end if;

  select with_check into v_check from pg_policies
   where schemaname='public' and tablename='messages' and cmd='INSERT';
  if v_check not like '%can_write_to_conversation%' then
    raise exception 'msg_insert does not consult can_write_to_conversation: %', v_check;
  end if;
  -- Membership must survive: the friendship rule is IN ADDITION to it, never
  -- instead of it, or a friend could post into a room they never joined.
  if v_check not like '%conversation_members%' then
    raise exception 'msg_insert lost its membership check: %', v_check;
  end if;

  if has_function_privilege('anon', 'public.can_write_to_conversation(uuid)', 'execute') then
    raise exception 'anon can execute can_write_to_conversation — revoke did not take';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
    where n2.nspname='public' and p.proname='dm_blocked_for_sender'
  ) then
    raise exception 'dm_blocked_for_sender still exists — two helpers can disagree about who may write';
  end if;
end $$;
