-- ============================================================================
-- Chat: deleting or clearing never lowers the vibe (owner, 2026-11-07)
-- ============================================================================
--
-- The vibe is worked out live from what is between two people, so a message that went took its
-- points with it: deleting a shared song cost 3, and Clear chat took a vibe of 25 down to 13.
-- The owner's rule: the vibe never resets or drops, whatever is deleted or cleared.
--
--   chat_vibe_kept(conversation, points) — the points of messages that no longer count live.
--     Server-only: no app reads or writes it. No policy and no client grant, on purpose.
--   keep_chat_vibe_points(chat, message) — adds up what a message (or the whole chat) is worth
--     right now and keeps it. Called by the two functions below, BEFORE they delete anything:
--     a deleted message has lost the words that show it was a shared song.
--   delete_message_for_everyone() — restated from 20261119010000 with ONE change, marked below.
--   clear_chat_for_both() — restated from 20261119020000 with ONE change, marked below.
--   my_chat_vibes() — restated from 20261106000000 with TWO changes, marked below: it adds the
--     kept points, and what a message is worth now lives in chat_vibe_message_points, so the
--     live count and the kept points can never disagree.
--
-- A message already deleted (deleted_at set) is not counted live, so it is never kept twice.
-- Taking back a reaction, a like or a comment still takes its point off: those are undoing the
-- thing itself, not clearing a chat.
--
-- ── WHY THIS IS SAFE FOR APPS ALREADY INSTALLED ────────────────────────────
-- Installed apps call my_chat_vibes (src/services/chatVibes.ts at 5207927): same arguments and
-- columns, and the same number for every chat, because nothing is kept until someone deletes or
-- clears. Only the new app can do either: no installed app calls delete_message_for_everyone or
-- clear_chat_for_both. chat_vibe_kept and the two helpers are new.
-- ============================================================================

create table if not exists public.chat_vibe_kept (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  points          bigint not null default 0 check (points >= 0)
);

alter table public.chat_vibe_kept enable row level security;

-- Server-only, on purpose: no policy and no authenticated or anon grant. The revoke is needed
-- as well as leaving the grant out, because this project's default privileges can add one.
revoke all on public.chat_vibe_kept from public, anon, authenticated;
grant select, insert, update, delete on public.chat_vibe_kept to service_role;

-- ── What a message is worth ─────────────────────────────────────────────────
-- Every message 1, a shared song 3. message_preview decides what a shared song is; the LIKE
-- only spares it the text messages that cannot be one.
create or replace function public.chat_vibe_message_points(p_kind text, p_body text)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select case when p_kind = 'track_share'
                or (p_kind = 'text' and p_body like '%spotify%'
                    and public.message_preview(p_kind, p_body) = '🎵 Shared a song')
              then 3 else 1 end;
$$;

revoke all on function public.chat_vibe_message_points(text, text) from public, anon, authenticated;

-- ── Keeping points ──────────────────────────────────────────────────────────
-- One message, or every message in the chat when p_message_id is null. One-to-one chats only:
-- a group has no vibe.
create or replace function public.keep_chat_vibe_points(p_conversation_id uuid, p_message_id uuid default null)
returns void
language sql
volatile
set search_path = public, pg_temp
as $$
  with gone as (
    select m.id, m.kind, m.body, m.sender_id
      from public.messages m
     where m.conversation_id = p_conversation_id
       and m.deleted_at is null
       and m.kind <> 'system'
       and (p_message_id is null or m.id = p_message_id)
  ),
  pts as (
    select public.chat_vibe_message_points(g.kind, g.body) as p
      from gone g
    union all
    -- a reaction by one of the two to the other's message
    select 1
      from gone g
      join public.message_reactions r on r.message_id = g.id
     where r.user_id <> g.sender_id
       and exists (
         select 1 from public.conversation_members cm
          where cm.conversation_id = p_conversation_id and cm.user_id = r.user_id
       )
  )
  insert into public.chat_vibe_kept (conversation_id, points)
  select p_conversation_id, sum(pts.p)
    from pts
   where exists (select 1 from public.conversations c where c.id = p_conversation_id and c.kind = 'dm')
  having sum(pts.p) > 0
  on conflict (conversation_id) do update
     set points = public.chat_vibe_kept.points + excluded.points;
$$;

revoke all on function public.keep_chat_vibe_points(uuid, uuid) from public, anon, authenticated;

-- ── Delete a message ────────────────────────────────────────────────────────
create or replace function public.delete_message_for_everyone(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_msg public.messages;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_msg from public.messages where id = p_message_id for update;
  -- Not found and not yours read the same, so the function cannot be used to probe ids.
  if not found or v_msg.sender_id is distinct from v_uid then
    raise exception 'not_your_message' using errcode = '42501';
  end if;
  if v_msg.kind = 'system' then
    raise exception 'system_message' using errcode = '42501';
  end if;
  -- Still in the chat (msg_update's rule): after leaving a group you cannot reach into it.
  if not exists (
    select 1 from public.conversation_members
     where conversation_id = v_msg.conversation_id and user_id = v_uid
  ) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if v_msg.deleted_at is not null and v_msg.body is null and v_msg.metadata is null then
    return; -- already gone
  end if;

  -- NEW (20261119030000): the vibe keeps this message's points.
  perform public.keep_chat_vibe_points(v_msg.conversation_id, p_message_id);

  update public.messages
     set deleted_at = coalesce(deleted_at, now()),
         body = null,
         metadata = null
   where id = p_message_id;
end $$;

revoke all on function public.delete_message_for_everyone(uuid) from public, anon;
grant execute on function public.delete_message_for_everyone(uuid) to authenticated, service_role;

-- ── Clear chat ──────────────────────────────────────────────────────────────
create or replace function public.clear_chat_for_both(p_conversation_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.conversation_members cm
      join public.conversations c on c.id = cm.conversation_id
     where cm.conversation_id = p_conversation_id
       and cm.user_id = v_uid
       and c.kind = 'dm'
  ) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  -- Nothing to clear: no second line for a chat that is already empty.
  if not exists (
    select 1 from public.messages
     where conversation_id = p_conversation_id and kind <> 'system'
  ) then
    return;
  end if;

  -- NEW (20261119030000): the vibe keeps the points of everything about to go.
  perform public.keep_chat_vibe_points(p_conversation_id);

  delete from public.messages where conversation_id = p_conversation_id;

  select coalesce(nullif(display_name, ''), username) into v_name
    from public.profiles where id = v_uid;
  insert into public.messages (conversation_id, sender_id, kind, body, metadata)
  values (
    p_conversation_id,
    null,
    'system',
    coalesce(v_name, 'Someone') || ' cleared this chat',
    jsonb_build_object('chat_cleared', true)
  );
end $$;

revoke all on function public.clear_chat_for_both(uuid) from public, anon;
grant execute on function public.clear_chat_for_both(uuid) to authenticated, service_role;

-- ── The vibe ────────────────────────────────────────────────────────────────
create or replace function public.my_chat_vibes()
returns table (conversation_id uuid, vibe bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with mine as (
    select c.id as conversation_id, them.user_id as friend_id
      from conversations c
      join conversation_members me
        on me.conversation_id = c.id and me.user_id = (select auth.uid())
      join conversation_members them
        on them.conversation_id = c.id and them.user_id <> (select auth.uid())
     where c.kind = 'dm'
       and (select count(*) from conversation_members x where x.conversation_id = c.id) = 2
       and not public.is_blocked_between((select auth.uid()), them.user_id)
  ),
  pts as (
    -- every message (CHANGED, 20261119030000: its worth now lives in one place)
    select m.conversation_id, public.chat_vibe_message_points(m.kind, m.body)::bigint as p
      from messages m
      join mine on mine.conversation_id = m.conversation_id
     where m.deleted_at is null
       and m.kind <> 'system'

    union all
    -- a reaction by one of the two to the other's message
    select m.conversation_id, 1
      from messages m
      join mine on mine.conversation_id = m.conversation_id
      join message_reactions r on r.message_id = m.id
     where m.deleted_at is null
       and m.kind <> 'system'
       and r.user_id in ((select auth.uid()), mine.friend_id)
       and r.user_id <> m.sender_id

    union all
    -- a Jam in this chat that played 5+ minutes
    select j.conversation_id, 10
      from jam_rooms j
      join mine on mine.conversation_id = j.conversation_id
     where coalesce(j.last_played_at, j.host_clock_at) - j.started_at >= interval '5 minutes'

    union all
    -- a like on the other's post, either way round
    select mine.conversation_id, 1
      from mine
      join post_likes l on l.user_id in ((select auth.uid()), mine.friend_id)
      join posts p on p.id = l.post_id
     where p.author_id in ((select auth.uid()), mine.friend_id)
       and p.author_id <> l.user_id

    union all
    -- a comment on the other's post, either way round
    select mine.conversation_id, 1
      from mine
      join post_comments c on c.author_id in ((select auth.uid()), mine.friend_id)
      join posts p on p.id = c.post_id
     where p.author_id in ((select auth.uid()), mine.friend_id)
       and p.author_id <> c.author_id

    union all
    -- NEW (20261119030000): what deleted and cleared messages were worth
    select k.conversation_id, k.points
      from chat_vibe_kept k
      join mine on mine.conversation_id = k.conversation_id
  )
  select pts.conversation_id, sum(pts.p)::bigint
    from pts
   group by pts.conversation_id
$$;

revoke execute on function public.my_chat_vibes() from public, anon;
grant execute on function public.my_chat_vibes() to authenticated;

comment on function public.my_chat_vibes() is
  'The caller''s one-to-one chats and the vibe of each: messages, shared songs, reactions, '
  'Jams, likes/comments on each other''s posts, and the points of messages since deleted or '
  'cleared. Reads no one''s listening. Nothing across a block, nothing for groups.';

-- ── Self-check ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_class
     where oid = 'public.chat_vibe_kept'::regclass and relrowsecurity
  ) then
    raise exception 'chat_vibe_keeps_points: row-level security is off on chat_vibe_kept';
  end if;
  if has_table_privilege('anon', 'public.chat_vibe_kept', 'select')
     or has_table_privilege('authenticated', 'public.chat_vibe_kept', 'select') then
    raise exception 'chat_vibe_keeps_points: a client can read chat_vibe_kept';
  end if;
end $$;
