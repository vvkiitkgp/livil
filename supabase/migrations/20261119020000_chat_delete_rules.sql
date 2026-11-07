-- ============================================================================
-- Chat: the owner's rules for deleting (2026-11-07)
-- ============================================================================
--
-- Replaces the per-person parts of 20261119010000, which went live the same day and which no
-- shipped app has ever used:
--
--   DELETE A MESSAGE  Always for both people, and only your own: delete_message_for_everyone,
--     unchanged. "Delete for me" is gone, so message_hides is dropped.
--   CLEAR CHAT        One-to-one chats only, and for BOTH people: clear_chat_for_both(chat)
--     permanently deletes every message in the chat, then leaves one system line, "Riya cleared
--     this chat". The line is what tells the other person why their chat is empty, it is the
--     realtime signal that empties an open chat (metadata.chat_cleared), and it means nobody
--     wipes a chat unseen. THIS CANNOT BE UNDONE.
--   DELETE CHAT       Only for the person doing it, and no message is touched:
--     hide_conversation(chat) records when they hid it, and the chat stays out of THEIR list
--     until a message newer than that arrives. Everything is still there when it comes back.
--     Private: last_read_at does not move, so it sends no "Seen", and only they can read the row.
--
-- A real DELETE rather than the soft delete a single message gets: installed apps already drop
-- deleted rows, nothing needs the rows, and the new app would otherwise draw a placeholder for
-- every one of them. recompute_conversation_last_message empties the chat-list line. Reactions
-- and media saves cascade. A chat photo's file is not orphaned: the sweep deletes by age from
-- the bucket, with no join to messages (20261118000000).
--
-- ── WHY THIS IS SAFE FOR APPS ALREADY INSTALLED ────────────────────────────
-- Checked at the last release (2.1.6, 5207927) and HEAD.
--   * clear_chat_for_both and hide_conversation are new; no installed app calls them.
--   * message_hides, conversation_clears, clear_conversation and list_my_conversations_v2 are
--     from 20261119010000 and no installed app reads them. Dropping the two tables loses no
--     real data: nothing but a test build could have written to them.
--   * unread_badge_count_for is called only by send-push, with the same arguments and return
--     type. Its answer changes only for someone who has hidden a chat, which only the new app
--     can do.
--   * Once the new app ships and someone clears a chat, an installed app shows the system line
--     as it shows every system line. An open chat keeps its old messages until the next load,
--     since it has no delete listener, then fetchMessages returns only the line. The chat-list
--     line goes empty, the state of a DM nobody has written in yet.
-- The new app checks that conversation_hides exists before offering any of this.
-- ============================================================================

-- ── Delete chat: one private row per person per chat ───────────────────────
create table if not exists public.conversation_hides (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  -- Out of this person's chat list until a message newer than this.
  hidden_at       timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

create index if not exists conversation_hides_conversation_idx
  on public.conversation_hides (conversation_id);

alter table public.conversation_hides enable row level security;

-- Your own rows only. Written only by hide_conversation (SECURITY DEFINER), so there is no
-- insert/update/delete policy and no client write grant. Not added to the realtime publication:
-- nobody else is ever told.
drop policy if exists "conversation_hides_select" on public.conversation_hides;
create policy "conversation_hides_select" on public.conversation_hides for select
  using (user_id = auth.uid());

-- New tables get no automatic grants (Supabase, 2026-10-30). The app reads this one only to
-- check the feature exists.
grant select on public.conversation_hides to authenticated;
grant select, insert, update, delete on public.conversation_hides to service_role;

create or replace function public.hide_conversation(p_conversation_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.conversation_members
     where conversation_id = p_conversation_id and user_id = v_uid
  ) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  insert into public.conversation_hides (user_id, conversation_id, hidden_at)
  values (v_uid, p_conversation_id, now())
  on conflict (user_id, conversation_id) do update set hidden_at = excluded.hidden_at;
end $$;

revoke all on function public.hide_conversation(uuid) from public, anon;
grant execute on function public.hide_conversation(uuid) to authenticated, service_role;

-- ── Clear chat: for both people ─────────────────────────────────────────────
-- Not found, not yours and not a one-to-one chat read the same, so this cannot probe chats.
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

-- ── The new app's chat list ────────────────────────────────────────────────
-- Now what v1 returns (20260925000000), minus chats this person hid. No per-person preview any
-- more: everyone sees the same messages, so the stored line is right for everyone.
create or replace function public.list_my_conversations_v2()
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
stable
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
    ),
    case when c.kind = 'dm' then p.id           end,
    case when c.kind = 'dm' then p.username     end,
    case when c.kind = 'dm' then p.display_name end,
    case when c.kind = 'dm' then p.avatar_url   end,
    case when c.kind = 'dm' then
      exists (
        select 1 from listen_sessions ls
        where ls.user_id = p.id
          and ls.playing
          and ls.updated_at > now() - interval '150 seconds'
          and public.can_see_listening(p.id)
      )
    end
  from conversations c
  join conversation_members cm_me
    on cm_me.conversation_id = c.id and cm_me.user_id = auth.uid()
  left join conversation_members cm_other
    on cm_other.conversation_id = c.id and cm_other.user_id != auth.uid() and c.kind = 'dm'
  left join profiles p on p.id = cm_other.user_id
  left join conversation_hides ch
    on ch.conversation_id = c.id and ch.user_id = auth.uid()
  -- A deleted chat stays out of the list until something newer than the delete arrives.
  where ch.hidden_at is null
     or coalesce(c.last_message_at, c.created_at) > ch.hidden_at
  order by coalesce(c.last_message_at, c.created_at) desc nulls last, c.created_at desc;
$$;

revoke all on function public.list_my_conversations_v2() from public, anon;
grant execute on function public.list_my_conversations_v2() to authenticated, service_role;

-- ── The number on the app's icon must agree with the chat list ─────────────
-- Restated from 20261119010000 with ONE change, in the messages count: a chat out of the list
-- counts nothing, as in v2, or the icon would keep a number nothing in the app can clear. When
-- the chat comes back, its unread messages count again, in both places.
create or replace function public.unread_badge_count_for(p_user_id uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (
    coalesce((
      select count(*)
      from conversation_members cm
      join conversations c on c.id = cm.conversation_id
      join messages m on m.conversation_id = cm.conversation_id
      left join conversation_hides ch
        on ch.conversation_id = cm.conversation_id and ch.user_id = p_user_id
      where cm.user_id = p_user_id
        and m.created_at > cm.last_read_at
        and m.sender_id <> p_user_id
        and m.deleted_at is null
        and (ch.hidden_at is null or coalesce(c.last_message_at, c.created_at) > ch.hidden_at)
    ), 0)
    + coalesce((
      select count(*)
      from friendships f
      where f.status = 'pending'
        and f.requested_by <> p_user_id
        and (f.user_a_id = p_user_id or f.user_b_id = p_user_id)
    ), 0)
    + coalesce((
      select count(*)
      from activity_notifications an
      where an.recipient_id = p_user_id
        and an.is_read = false
    ), 0)
  )::int;
$$;

-- Load-bearing, as in 20260914000000: any signed-in user could otherwise read anyone's count.
revoke all on function public.unread_badge_count_for(uuid) from public;
revoke all on function public.unread_badge_count_for(uuid) from anon;
revoke all on function public.unread_badge_count_for(uuid) from authenticated;
grant execute on function public.unread_badge_count_for(uuid) to service_role;

-- ── What these rules replace ───────────────────────────────────────────────
-- Last, so nothing above ever points at a table that is gone.
drop function if exists public.clear_conversation(uuid, boolean);
drop table if exists public.message_hides;
drop table if exists public.conversation_clears;

-- ── Self-check ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_class
     where oid = 'public.conversation_hides'::regclass and relrowsecurity
  ) then
    raise exception 'chat_delete_rules: row-level security is off on conversation_hides';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.messages'::regclass
       and tgfoid = 'public.recompute_conversation_last_message'::regproc
       and not tgisinternal
  ) then
    raise exception 'chat_delete_rules: the chat-list line would not follow a clear';
  end if;
end $$;
