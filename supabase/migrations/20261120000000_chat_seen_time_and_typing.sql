-- ============================================================================
-- Chat: "Seen 2m ago" and the typing indicator
-- ============================================================================
--
-- Owner's request (2026-11-08): Instagram's "Seen just now / 2m ago / 5d ago" under a DM
-- message, and a typing indicator in the chat list and in the chat.
--
-- ── 1. THE SEEN TIME ───────────────────────────────────────────────────────
--
--   conversation_members.read_receipt_at — NEW, nullable. When this member last read
--     something NEW from the other person (server clock).
--   conversation_members_read_receipt   — a trigger, and the column's only writer.
--
-- Why last_read_at cannot be the time: every open of a chat re-stamps it (markAsRead), new
-- messages or not. "Seen 2m ago" on a message read five days ago would be wrong, and would
-- also tell the sender each time the reader merely reopened the chat.
--
-- A chat from before this migration has last_read_at but no read_receipt_at. The app shows
-- last_read_at until the first update here, which freezes that value as the seen time, so
-- no bulk rewrite of the table (and no realtime event per row) is needed.
--
-- One-to-one chats only, like every other receipt (see 20261119000000): groups stay null.
--
-- ── 2. TYPING ──────────────────────────────────────────────────────────────
--
--   send_typing(conversation, typing) — the app calls it at most every few seconds while
--     someone types. It decides who may signal and who hears it, then sends one broadcast
--     per recipient, each on that recipient's own topic: `typing:<their user id>`.
--   a SELECT policy on realtime.messages — only you can join your own topic.
--
-- Broadcast rather than a table: nothing has to be kept, and postgres_changes would re-check
-- row-level security for every online subscriber on the app's most frequent event.
--
-- One topic per RECIPIENT rather than per chat, because the chat list needs every chat at
-- once, and one channel beats one per row.
--
-- PRIVATE, unlike broadcast_jam_state's public topic. User ids are not secret (profiles are
-- public), so on a public topic anyone could listen to `typing:<riya's id>` and learn who is
-- writing to Riya, and when. Private channels are checked against realtime.messages when
-- they join. There is deliberately NO insert policy: a client cannot send on this topic
-- itself, so it cannot forge a signal; everything goes through send_typing.
--
-- realtime.send stores each signal as a row in realtime.messages, which Supabase clears on
-- its own. The row holds who is typing and in which chat, never the text.
--
-- This is the one place the app shows that someone has it open (realtime.md's product rule),
-- and only to the people that person is typing to, as they type.
--
-- ── WHY THIS IS SAFE FOR APPS ALREADY INSTALLED ────────────────────────────
-- Additive. Installed apps select named columns from conversation_members (checked at the
-- last release, 2.1.6, 5207927, and at HEAD), so they never see the new one. Their one
-- update (markAsRead: `last_read_at`) still lands: the trigger never rejects. It does cap that
-- time at the server's clock, which only corrects what they already do with it: "Seen" and
-- unread counts compare it with messages' created_at, and a time in the future was wrong for
-- both. They never call send_typing or join a typing topic. The policy applies only to
-- private channels, and no installed app uses one; the jam's public topic is untouched.
--
-- The new app treats a missing column or function as "no time" / "no typing", never an error.
-- ============================================================================

-- ── 1. The seen time ────────────────────────────────────────────────────────
alter table public.conversation_members
  add column if not exists read_receipt_at timestamptz;

comment on column public.conversation_members.read_receipt_at is
  'When this member last read something new from the other person in a DM (server clock). Written only by the conversation_members_read_receipt trigger. Read by the other member''s app for "Seen 2m ago".';

-- SECURITY DEFINER so the check reads messages directly, not through their row-level
-- security, on a write every chat open makes. It only ever sets this one timestamp.
create or replace function public.conversation_members_read_receipt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.read_receipt_at := null;
    return new;
  end if;

  -- Only this trigger sets it. It derives from last_read_at, which the member's own app
  -- writes, so a member can still misreport their OWN reading, as they always could with
  -- last_read_at itself; never anyone else's.
  new.read_receipt_at := old.read_receipt_at;

  if new.last_read_at is null or new.last_read_at is not distinct from old.last_read_at then
    return new;
  end if;

  -- markAsRead sends the phone's clock. One running fast would mark messages that do not
  -- exist yet as read: they would say "Seen" the moment they were sent, with an old time.
  new.last_read_at := least(new.last_read_at, now());

  if not exists (
    select 1 from public.conversations c
     where c.id = new.conversation_id and c.kind = 'dm'
  ) then
    return new;
  end if;

  -- Same test as the app's "Seen" (utils/chatReceipts.ts): someone else's message, not a
  -- system line and not deleted, now covered by last_read_at.
  if exists (
    select 1 from public.messages m
     where m.conversation_id = new.conversation_id
       and m.sender_id <> new.user_id
       and m.kind is distinct from 'system'
       and m.deleted_at is null
       and m.created_at <= new.last_read_at
       and (old.last_read_at is null or m.created_at > least(old.last_read_at, now()))
       -- Already counted: last_read_at moving back (two writes crossing on a slow network)
       -- and forward again is not a new read.
       and (old.read_receipt_at is null or m.created_at > old.read_receipt_at)
  ) then
    new.read_receipt_at := now();
  elsif old.read_receipt_at is null and old.last_read_at is not null then
    new.read_receipt_at := least(old.last_read_at, now());
  end if;
  return new;
end $$;

-- A trigger function is not an API (same sweep as 20260923100000).
revoke all on function public.conversation_members_read_receipt() from public, anon, authenticated;

drop trigger if exists trg_conversation_members_read_receipt on public.conversation_members;
create trigger trg_conversation_members_read_receipt
  before insert or update on public.conversation_members
  for each row execute function public.conversation_members_read_receipt();

-- ── 2. Typing ───────────────────────────────────────────────────────────────
-- The app's 3-second limit is only the app's: a client can call send_typing directly, and each
-- call costs a row per recipient. So at most one signal a second per person, counted apart for
-- "typing" and "stopped" so a quick stop is not swallowed.
--
-- SERVER-ONLY, on purpose: no grant to authenticated, RLS on with no policies. Only the
-- definer below touches it. Unlogged because it is a rate limit, not a record: it writes no
-- WAL on the path it exists to protect, and losing it in a crash costs nothing.
create unlogged table if not exists public.typing_signal_limits (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  typing       boolean not null,
  last_sent_at timestamptz not null,
  primary key (user_id, typing)
);

alter table public.typing_signal_limits enable row level security;
revoke all on table public.typing_signal_limits from public, anon, authenticated;

comment on table public.typing_signal_limits is
  'When each person last sent a typing signal, for send_typing''s rate limit. Server-only.';

-- Whoever may write to the chat may signal in it (can_write_to_conversation: in a DM, an
-- unblocked friend). A block silences it per recipient too, as it does a push. Groups over 50
-- get no signal: each one costs a row per member, and nobody reads "37 people are typing".
-- Returns nothing either way, so it cannot be used to probe which chats exist.
create or replace function public.send_typing(p_conversation_id uuid, p_typing boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_name text;
  v_avatar_url text;
  v_recipient uuid;
begin
  if v_me is null
     or not exists (
       select 1 from public.conversation_members
        where conversation_id = p_conversation_id and user_id = v_me
     )
     or not public.can_write_to_conversation(p_conversation_id)
     or (select count(*) from public.conversation_members
          where conversation_id = p_conversation_id) > 50
  then
    return;
  end if;

  insert into public.typing_signal_limits (user_id, typing, last_sent_at)
  values (v_me, p_typing is true, now())
  on conflict (user_id, typing) do update
    set last_sent_at = excluded.last_sent_at
    where public.typing_signal_limits.last_sent_at < now() - interval '1 second';
  if not found then
    return;
  end if;

  select coalesce(nullif(display_name, ''), username), avatar_url
    into v_name, v_avatar_url
    from public.profiles
   where id = v_me;

  for v_recipient in
    select cm.user_id
      from public.conversation_members cm
     where cm.conversation_id = p_conversation_id
       and cm.user_id <> v_me
       and not public.is_blocked_between(v_me, cm.user_id)
  loop
    perform realtime.send(
      jsonb_build_object(
        'conversation_id', p_conversation_id,
        'user_id', v_me,
        'typing', p_typing is true,
        'name', v_name,
        'avatar_url', v_avatar_url
      ),
      'typing',
      'typing:' || v_recipient::text,
      true  -- private: checked against the policy below
    );
  end loop;
end $$;

revoke all on function public.send_typing(uuid, boolean) from public, anon;
grant execute on function public.send_typing(uuid, boolean) to authenticated, service_role;

drop policy if exists "typing_own_topic_select" on realtime.messages;
create policy "typing_own_topic_select" on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and topic = (select realtime.topic())
    and (select realtime.topic()) = 'typing:' || (select auth.uid())::text
  );

-- ── Self-check ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'conversation_members'
       and column_name = 'read_receipt_at' and is_nullable = 'YES'
  ) then
    raise exception 'chat_seen_time_and_typing: conversation_members.read_receipt_at missing or NOT NULL';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.conversation_members'::regclass
       and tgname = 'trg_conversation_members_read_receipt'
       and not tgisinternal
  ) then
    raise exception 'chat_seen_time_and_typing: read receipt trigger not installed';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'realtime' and tablename = 'messages'
       and policyname = 'typing_own_topic_select'
  ) then
    raise exception 'chat_seen_time_and_typing: typing topic policy not installed';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'realtime' and tablename = 'messages' and cmd in ('INSERT', 'ALL')
  ) then
    raise exception 'chat_seen_time_and_typing: a client could send on realtime topics itself';
  end if;
  -- Policies add up: another SELECT policy here could let anyone join someone else's topic.
  if exists (
    select 1 from pg_policies
     where schemaname = 'realtime' and tablename = 'messages' and cmd = 'SELECT'
       and policyname <> 'typing_own_topic_select'
  ) then
    raise exception 'chat_seen_time_and_typing: another SELECT policy exists on realtime.messages';
  end if;
end $$;
