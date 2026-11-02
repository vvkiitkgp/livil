-- ============================================================================
-- Chat: delete a message for me / for everyone, clear a chat, delete a chat
-- ============================================================================
--
-- Owner's request (2026-11-02). messages.deleted_at (soft delete) has existed since the
-- chat shipped, and every installed app already reads only `deleted_at is null` — but no
-- screen ever set it. This adds the rest:
--
--   DELETE FOR EVERYONE  delete_message_for_everyone(message) — the SENDER only. Sets
--     deleted_at AND erases the words and attachment (body, metadata := null): "deleted"
--     must not mean "still readable by anyone who asks the API". The freeze trigger keeps
--     refusing every content change from a client; this function is the one named
--     exemption it was written to expect (20260729000000), and only for an erase.
--   The inbox line: a soft delete never touched conversations.last_message_preview, so the
--     deleted text stayed in BOTH people's chat list, on every app version. A trigger now
--     replaces it with "This message was deleted" when the newest message is deleted.
--   DELETE FOR ME        message_hides (user, message) — hides one message for one person.
--   CLEAR CHAT           conversation_clears.cleared_at — that person no longer sees
--     anything sent up to then. clear_conversation(chat, false).
--   DELETE CHAT          …plus conversation_clears.hidden_at — the chat leaves that
--     person's list until a new message arrives. clear_conversation(chat, true).
--   All three are PRIVATE: each lives in a table only its owner can read, never on
--   conversation_members (which every member reads, and realtime publishes). An earlier
--   draft put cleared_at/hidden_at there and also marked the chat read, which told the other
--   person both that you had cleared the chat and "Seen" on messages you never read
--   (security review). Clearing does not touch last_read_at.
--   list_my_conversations_v2() — the chat list for the new app: what v1 returns, minus
--     hidden chats, with each person's own preview and unread count (after their clear,
--     without their hidden messages, "This message was deleted" for a deleted one).
--
-- Chat photos/videos (PROP-0011): delete-for-everyone erases the message's metadata, so no
-- app can name the file any more, and the chat-media function already refuses a link for a
-- deleted message (410). The FILE itself is removed by the existing 20-minute sweep, never
-- later than 20 minutes after it was sent — not at once: clients may not delete storage
-- objects, and deleting storage.objects rows from SQL leaves the bytes behind (20260802).
-- The new app also drops its own downloaded copy when it sees the delete.
--
-- ── WHY THIS IS SAFE FOR APPS ALREADY INSTALLED ────────────────────────────
-- Checked at the last release (2.1.6, 5207927) and HEAD.
--   * Every message read in an installed app filters `deleted_at is null` (fetchMessages)
--     or fetches one row by id after an INSERT event (jamRealtime, JamRoomScreen). A
--     message deleted for everyone therefore disappears for them on the next load of the
--     chat (until then an open chat, or its saved copy, can still show it — they have no
--     update listener). Their chat list shows "This message was deleted" for it.
--   * message_hides, conversation_clears and list_my_conversations_v2 are new; installed
--     apps never read them, so on those apps a cleared/deleted/hidden chat still shows
--     everything — these are per-person views, kept by the new app only.
--   * No existing table gains a column. msg_update / the direct `deleted_at` update stay as
--     they are; installed apps never send it.
-- The new app checks that message_hides exists before offering any of this, and falls
-- back to list_my_conversations (v1) when v2 is missing.
-- ============================================================================

-- ── Clear chat / Delete chat: one private row per person per chat ──────────
create table if not exists public.conversation_clears (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  -- Clear chat: this person no longer sees messages created at or before this time.
  cleared_at      timestamptz not null default now(),
  -- Delete chat: left out of this person's chat list until a message newer than this.
  hidden_at       timestamptz,
  primary key (user_id, conversation_id)
);

create index if not exists conversation_clears_conversation_idx
  on public.conversation_clears (conversation_id);

alter table public.conversation_clears enable row level security;

-- Your own rows only. Written only by clear_conversation (SECURITY DEFINER, below), so
-- there is no insert/update/delete policy and no client write grant. Not added to the
-- realtime publication: nobody else is ever told.
drop policy if exists "conversation_clears_select" on public.conversation_clears;
create policy "conversation_clears_select" on public.conversation_clears for select
  using (user_id = auth.uid());

grant select on public.conversation_clears to authenticated;
grant select, insert, update, delete on public.conversation_clears to service_role;

-- ── Delete for me ───────────────────────────────────────────────────────────
create table if not exists public.message_hides (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

-- The cascade from messages looks rows up by message_id.
create index if not exists message_hides_message_idx on public.message_hides (message_id);

alter table public.message_hides enable row level security;

drop policy if exists "message_hides_select" on public.message_hides;
create policy "message_hides_select" on public.message_hides for select
  using (user_id = auth.uid());

-- Only your own, and only a message in a chat you are in. No update or delete: a hide is
-- not undone in the app.
drop policy if exists "message_hides_insert" on public.message_hides;
create policy "message_hides_insert" on public.message_hides for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1
        from public.messages m
        join public.conversation_members cm on cm.conversation_id = m.conversation_id
       where m.id = message_hides.message_id
         and cm.user_id = auth.uid()
    )
  );

-- New tables get no automatic grants (Supabase, 2026-10-30): exactly what the app does.
grant select, insert on public.message_hides to authenticated;
grant select, insert, delete on public.message_hides to service_role;

-- ── The freeze trigger's one exemption: an erase by the server ─────────────
-- Restated from 20261107000000 with ONE change, marked below. A client (current_user
-- `authenticated`/`anon`) still cannot change a sent message's content at all. The table
-- owner — i.e. delete_message_for_everyone, which is SECURITY DEFINER — may ERASE it: body
-- and metadata to null, together with deleted_at, kind and quote untouched. Nothing else.
create or replace function public.messages_freeze_identity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.conversation_id is distinct from old.conversation_id
     or new.created_at is distinct from old.created_at then
    raise exception 'message_identity_is_immutable'
      using errcode = '42501';
  end if;

  -- NEW (20261119010000): delete-for-everyone's erase.
  if current_user not in ('authenticated', 'anon')
     and new.deleted_at is not null
     and new.body is null
     and new.metadata is null
     and new.kind is not distinct from old.kind
     and new.reply_to_id is not distinct from old.reply_to_id then
    return new;
  end if;

  -- Content. reply_to_id may be cleared only by the database itself — the FK's ON DELETE
  -- SET NULL when the quoted message is deleted, which runs as the table owner — never by
  -- an API caller: removing the quote changes what a reply means (security review).
  if new.kind is distinct from old.kind
     or new.body is distinct from old.body
     or new.metadata is distinct from old.metadata
     or (new.reply_to_id is distinct from old.reply_to_id
         and (new.reply_to_id is not null or current_user in ('authenticated', 'anon'))) then
    raise exception 'message_content_is_immutable'
      using errcode = '42501';
  end if;

  return new;
end $$;

-- ── Delete for everyone ─────────────────────────────────────────────────────
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

  update public.messages
     set deleted_at = coalesce(deleted_at, now()),
         body = null,
         metadata = null
   where id = p_message_id;
end $$;

revoke all on function public.delete_message_for_everyone(uuid) from public, anon;
grant execute on function public.delete_message_for_everyone(uuid) to authenticated, service_role;

-- ── The chat list line must not keep a deleted message's words ─────────────
-- On a soft delete (by this function or the older direct update), when the deleted
-- message is the chat's newest. The time is kept, so the chat does not jump in the list.
create or replace function public.conversation_preview_on_message_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null
     and new.kind <> 'system'
     -- Newest of the messages the list line is made from: after_message_insert skips
     -- system lines, so a newer "The Jam Room has ended." does not stand in front of it.
     and not exists (
       select 1 from public.messages m
        where m.conversation_id = new.conversation_id
          and m.kind <> 'system'
          and (m.created_at > new.created_at or (m.created_at = new.created_at and m.id > new.id))
     ) then
    update public.conversations
       set last_message_preview = 'This message was deleted'
     where id = new.conversation_id;
  end if;
  return null;
end $$;

revoke all on function public.conversation_preview_on_message_delete() from public, anon, authenticated;

drop trigger if exists trg_conversation_preview_on_message_delete on public.messages;
create trigger trg_conversation_preview_on_message_delete
  after update of deleted_at on public.messages
  for each row execute function public.conversation_preview_on_message_delete();

-- A hard delete (account deletion) recomputes from what is left: restated from
-- 20260730000000 so a soft-deleted newest message reads as deleted, not as its old words.
create or replace function public.recompute_conversation_last_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.conversations c
     set last_message_at      = m.created_at,
         last_message_preview = case
                                  when m.deleted_at is not null then 'This message was deleted'
                                  else public.message_preview(m.kind, m.body)
                                end
    from (select distinct conversation_id from deleted) d
    left join lateral (
           select created_at, kind, body, deleted_at
             from public.messages
            where conversation_id = d.conversation_id
            order by created_at desc, id desc
            limit 1
         ) m on true
   where c.id = d.conversation_id;
  return null;
end $$;

-- ── Clear chat / delete chat ────────────────────────────────────────────────
-- SECURITY DEFINER so it can write the private table no client may write: always the
-- CALLER's own row, and only for a chat they are in. last_read_at is NOT touched — clearing
-- must not send "Seen" for messages nobody read.
create or replace function public.clear_conversation(p_conversation_id uuid, p_hide boolean default false)
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
  insert into public.conversation_clears (user_id, conversation_id, cleared_at, hidden_at)
  values (v_uid, p_conversation_id, now(), case when p_hide then now() end)
  on conflict (user_id, conversation_id) do update
     set cleared_at = excluded.cleared_at,
         hidden_at  = case when p_hide then excluded.cleared_at else public.conversation_clears.hidden_at end;
end $$;

revoke all on function public.clear_conversation(uuid, boolean) from public, anon;
grant execute on function public.clear_conversation(uuid, boolean) to authenticated, service_role;

-- ── The new app's chat list ────────────────────────────────────────────────
-- v1's columns (20260925000000), so the app reads it the same way. SECURITY DEFINER like
-- v1, scoped to auth.uid() throughout; other_user_online is v1's own expression.
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
    case when cc.cleared_at is null then c.last_message_at else lm.created_at end,
    case
      when lm.created_at is null then null
      when lm.deleted_at is not null then 'This message was deleted'
      else public.message_preview(lm.kind, lm.body)
    end,
    (
      select count(*) from messages m
      where m.conversation_id = c.id
        and m.created_at > cm_me.last_read_at
        and (cc.cleared_at is null or m.created_at > cc.cleared_at)
        and m.sender_id != auth.uid()
        and m.deleted_at is null
        and not exists (
          select 1 from message_hides h where h.user_id = auth.uid() and h.message_id = m.id
        )
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
  left join conversation_clears cc
    on cc.conversation_id = c.id and cc.user_id = auth.uid()
  -- The newest message this person still sees (system lines never make the list line,
  -- as in v1: after_message_insert skips them).
  left join lateral (
    select m.created_at, m.kind, m.body, m.deleted_at
      from messages m
     where m.conversation_id = c.id
       and m.kind <> 'system'
       and (cc.cleared_at is null or m.created_at > cc.cleared_at)
       and not exists (
         select 1 from message_hides h where h.user_id = auth.uid() and h.message_id = m.id
       )
     order by m.created_at desc, m.id desc
     limit 1
  ) lm on true
  -- A deleted chat stays out of the list until something newer than the delete arrives.
  where cc.hidden_at is null
     or coalesce(c.last_message_at, c.created_at) > cc.hidden_at
  order by coalesce(
             case when cc.cleared_at is null then c.last_message_at else lm.created_at end,
             c.created_at
           ) desc nulls last,
           c.created_at desc;
$$;

revoke all on function public.list_my_conversations_v2() from public, anon;
grant execute on function public.list_my_conversations_v2() to authenticated, service_role;

-- ── Self-check ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.messages'::regclass
       and tgname = 'trg_messages_freeze_identity' and not tgisinternal
  ) then
    raise exception 'chat_delete: trg_messages_freeze_identity is not installed';
  end if;
  if exists (
    select 1 from pg_class
     where oid in ('public.message_hides'::regclass, 'public.conversation_clears'::regclass)
       and not relrowsecurity
  ) then
    raise exception 'chat_delete: row-level security is off on a new table';
  end if;
end $$;
