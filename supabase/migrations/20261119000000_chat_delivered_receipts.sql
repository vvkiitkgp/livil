-- ============================================================================
-- Chat: "Delivered" means it reached their phone
-- ============================================================================
--
-- Owner's report (2026-11-02): in a one-to-one chat, "Delivered" only ever meant "saved on
-- the server", and the status sat under my newest message only — so if they had read 3 of
-- my 5 messages I saw "Delivered" and nothing else. The app now puts "Seen" under my last
-- message they have read and "Delivered" under my last one that reached their phone. This
-- migration records the second fact.
--
--   conversation_members.last_delivered_at  — NEW, nullable. Up to when this member's app
--     has RECEIVED the chat's messages. Stamped by their app when messages arrive (the chat
--     loads or catches up, a message comes in live, the chat list loads).
--   conversation_members_delivered_forward  — a trigger: the stamp only moves FORWARD and
--     never past the server's clock, whoever writes it and however; and nobody can PRESET
--     it — an insert (a group admin adding a member, members_insert) always starts it null,
--     or an admin could pin a new member's stamp at 2099 for good (security review).
--   mark_conversation_delivered(conversation, up_to) / mark_conversations_delivered()
--     — the two writes the app makes. SECURITY INVOKER: they update only the caller's own
--     row, under members_update (`user_id = auth.uid()`), exactly as markAsRead does today;
--     nothing new is granted on the table.
--
-- Who may move it: only that member (members_update, unchanged). Who may read it: the
-- chat's members (members_select, unchanged) — the same people who already read
-- last_read_at, which says more.
--
-- ONE-TO-ONE CHATS ONLY. Receipts are shown only there, and in a group the stamp would tell
-- every member — strangers included — roughly when this person's app was last open. In a
-- DM it tells the friend what "Delivered" always tells: that the app received the message,
-- and so roughly when it was open after it was sent (security review; an owner decision
-- noted in the PR report). The functions below skip groups.
--
-- ── WHY THIS IS SAFE FOR APPS ALREADY INSTALLED ────────────────────────────
-- Additive. A nullable column with no default: every insert an installed app makes
-- (create_group, get_or_create_dm, addGroupMember's upsert) and its one update
-- (markAsRead: `last_read_at`) are untouched — the trigger acts only when last_delivered_at
-- itself changes. Installed apps select named columns (`user_id, last_read_at`, `user_id`,
-- `user_id, role`), never `*`, so they never see it. Two new functions no installed app
-- calls. Checked at the last release (2.1.6, 5207927) and at HEAD.
--
-- The new app reads the column with a fallback (a missing column → the old select) and
-- treats a missing function as "no delivery tracking": until this is applied it shows
-- today's "Delivered", never an error.
-- ============================================================================

alter table public.conversation_members
  add column if not exists last_delivered_at timestamptz;

comment on column public.conversation_members.last_delivered_at is
  'Up to when this member''s app has received the conversation''s messages (server clock). Only moves forward. Read by the other member''s app for "Delivered".';

-- ── Forward only, never in the future ───────────────────────────────────────
-- Silent clamp rather than an error: a phone that stamps an older time (two writes
-- crossing on a slow network) has done nothing wrong, and the write it shares an UPDATE
-- with (if any) must still land.
create or replace function public.conversation_members_delivered_forward()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.last_delivered_at := null;
    return new;
  end if;
  if new.last_delivered_at is distinct from old.last_delivered_at then
    if new.last_delivered_at is null then
      new.last_delivered_at := old.last_delivered_at;
    else
      new.last_delivered_at := least(new.last_delivered_at, now());
      if old.last_delivered_at is not null and new.last_delivered_at < old.last_delivered_at then
        new.last_delivered_at := old.last_delivered_at;
      end if;
    end if;
  end if;
  return new;
end $$;

-- A trigger function is not an API (same sweep as 20260923100000).
revoke all on function public.conversation_members_delivered_forward() from public, anon, authenticated;

drop trigger if exists trg_conversation_members_delivered_forward on public.conversation_members;
create trigger trg_conversation_members_delivered_forward
  before insert or update on public.conversation_members
  for each row execute function public.conversation_members_delivered_forward();

-- ── The app's two writes ────────────────────────────────────────────────────
-- One chat, up to the newest message the app received in it. A write that would not move
-- the stamp is skipped, so it raises no realtime event for anyone.
create or replace function public.mark_conversation_delivered(
  p_conversation_id uuid,
  p_up_to timestamptz
)
returns void
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  update public.conversation_members
     set last_delivered_at = least(p_up_to, now())
   where conversation_id = p_conversation_id
     and user_id = (select auth.uid())
     and p_up_to is not null
     and (last_delivered_at is null or last_delivered_at < least(p_up_to, now()))
     and exists (select 1 from public.conversations c where c.id = p_conversation_id and c.kind = 'dm');
$$;

-- Every one-to-one chat the caller is in, up to its newest message — called when the chat list loads,
-- which is the app receiving each chat's newest message (it shows it as the preview).
create or replace function public.mark_conversations_delivered()
returns void
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  update public.conversation_members cm
     set last_delivered_at = least(c.last_message_at, now())
    from public.conversations c
   where c.id = cm.conversation_id
     and cm.user_id = (select auth.uid())
     and c.kind = 'dm'
     and c.last_message_at is not null
     and (cm.last_delivered_at is null or cm.last_delivered_at < least(c.last_message_at, now()));
$$;

revoke all on function public.mark_conversation_delivered(uuid, timestamptz) from public, anon;
grant execute on function public.mark_conversation_delivered(uuid, timestamptz) to authenticated, service_role;
revoke all on function public.mark_conversations_delivered() from public, anon;
grant execute on function public.mark_conversations_delivered() to authenticated, service_role;

-- ── Self-check ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'conversation_members'
       and column_name = 'last_delivered_at' and is_nullable = 'YES'
  ) then
    raise exception 'chat_delivered_receipts: conversation_members.last_delivered_at missing or NOT NULL';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.conversation_members'::regclass
       and tgname = 'trg_conversation_members_delivered_forward'
       and not tgisinternal
  ) then
    raise exception 'chat_delivered_receipts: forward-only trigger not installed';
  end if;
end $$;
