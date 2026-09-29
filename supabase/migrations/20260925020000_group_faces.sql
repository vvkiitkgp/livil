-- ============================================================================
-- Group faces — the group picture is its members, sized by who spoke last
-- ============================================================================
-- There is no way to set a group picture (conversations.avatar_url is never written),
-- so every group rendered as initials. Product decision 2026-09-25: instead of a
-- picture, show up to SIX members' profile photos packed into a circle, the most recent
-- sender largest, shrinking by recency. The viewer is included like anyone else.
--
-- This migration adds only the READ: which members, in what order. Layout, sizes and
-- the per-visit shuffle are client-side (src/utils/groupFaces.ts). Live reordering on a
-- new message is also client-side — the realtime `messages` INSERT already carries
-- `sender_id`, so the client moves that member to the front without calling this again.
--
-- SECURITY INVOKER, deliberately. Every table it touches already admits exactly the
-- right caller: conversations/conversation_members/messages only to members
-- (conv_select, members_select, msg_select), profiles to anyone not blocked OR who
-- shares a conversation (profiles_select_authenticated). So a non-member gets zero
-- rows, and a member sees only faces they can already see in Group Info. No DEFINER
-- body to audit.
--
-- Nothing is stored or rewritten. Forward-only and idempotent.
-- ============================================================================

-- "When did this member last speak in this conversation" is one index probe per
-- member with this, instead of a scan of the conversation's whole history. The
-- existing (conversation_id, created_at desc) index cannot answer it by sender.
create index if not exists messages_conversation_sender_created_idx
  on public.messages (conversation_id, sender_id, created_at desc);

create or replace function public.list_group_faces(p_conversation_ids uuid[])
returns table (
  conversation_id uuid,
  user_id         uuid,
  username        text,
  display_name    text,
  avatar_url      text,
  last_sent_at    timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select r.conversation_id, r.user_id, r.username, r.display_name, r.avatar_url, r.last_sent_at
  from (
    select
      cm.conversation_id,
      cm.user_id,
      p.username,
      p.display_name,
      p.avatar_url,
      ls.last_sent_at,
      row_number() over (
        partition by cm.conversation_id
        -- Most recent speaker first; members who never spoke fill the rest by join
        -- order, so a brand-new group still shows its people. user_id breaks ties so
        -- the order is total and the picture does not flicker between refetches.
        order by ls.last_sent_at desc nulls last, cm.joined_at asc nulls last, cm.user_id
      ) as rn
    from conversation_members cm
    join conversations c
      on c.id = cm.conversation_id and c.kind = 'group'
    left join profiles p
      on p.id = cm.user_id
    left join lateral (
      -- Same exclusions as the inbox preview: system rows and deleted messages do not
      -- count as speaking.
      select max(m.created_at) as last_sent_at
      from messages m
      where m.conversation_id = cm.conversation_id
        and m.sender_id = cm.user_id
        and m.deleted_at is null
        and m.kind <> 'system'
    ) ls on true
    -- Bounded input: the inbox passes its visible groups, never more than this.
    where cm.conversation_id = any (p_conversation_ids[1:100])
  ) r
  where r.rn <= 6
  order by r.conversation_id, r.rn;
$$;

revoke all on function public.list_group_faces(uuid[]) from public, anon;
grant execute on function public.list_group_faces(uuid[]) to authenticated;
