-- LIV-78 — Restore the `messages` UPDATE boundary.
--
-- `msg_update` (20260528000000_chat_jam.sql:277) had no WITH CHECK, so Postgres applied
-- the USING expression to the new row. That constrains only `sender_id`, leaving
-- `conversation_id` writable: an author could move their message into another thread,
-- where it reads as authentic history. Verified live on production 2026-07-29.
--
-- Tightening only — grants nothing to anyone, so consistent with ADR-0014, which names
-- this fix. Full reasoning and reproduction: ADR-0014 and PROP-0005 §1 (private).
-- Requires security-reviewer sign-off (autonomy-config.yml: MANDATORY).


-- Step 1: explicit WITH CHECK.
--
-- Not redundant with USING — do not "simplify" it out. Inherited, the write-side check
-- has no membership term, and whether another person's thread is reachable then depends
-- on whether the statement happens to reference a column of `messages`. The perimeter
-- must not depend on `msg_select` or on statement shape.
--
-- `drop policy if exists` first: permissive policies OR together, so a leftover
-- definition would defeat this one.
drop policy if exists "msg_update" on public.messages;

create policy "msg_update" on public.messages for update
  using (sender_id = auth.uid())
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversation_members
      where conversation_members.conversation_id = messages.conversation_id
        and conversation_members.user_id = auth.uid()
    )
  );


-- Step 2: freeze the row's identity across an UPDATE.
--
-- The policy alone is insufficient: RLS cannot compare OLD to NEW, so it accepts a move
-- between two conversations the caller is in — the primary form of the defect.
--
-- A trigger, not a column-level GRANT: ci.yml:180 runs `grant all ... to authenticated`
-- after migrations, which evaporates column grants (ADR-0014).
--
-- `sender_id` is deliberately NOT frozen. `delete_my_account()` relies on
-- `messages_sender_id_fkey ... on delete set null`, and a referential SET NULL fires row
-- triggers — freezing it breaks account deletion. It needs no freeze: USING and WITH
-- CHECK both pin the sender to the caller. A test asserts the cascade still works.
--
-- `deleted_at` is out of scope: ADR-0014 decided it is not a boundary today.
--
-- If an edit- or move-message feature hits this exception: it fires for every caller,
-- including a future SECURITY DEFINER RPC. Give that RPC a named exemption rather than
-- dropping the trigger, which would re-open relocation for everyone.
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
  return new;
end $$;

drop trigger if exists trg_messages_freeze_identity on public.messages;

create trigger trg_messages_freeze_identity
  before update on public.messages
  for each row
  execute function public.messages_freeze_identity();


-- Drift check: a half-applied perimeter that looks applied is worse than a failed apply.
-- polcmd 'a' = insert, 'w' = update, '*' = both; select and delete are not the write
-- perimeter. Pattern from prop0004_harden_stories.sql:140.
do $$
declare
  v_extra text;
  v_norls text;
  v_nocheck text;
begin
  -- Checked first: a policy on a table with RLS disabled is inert, which would make
  -- every scan below meaningless rather than merely failing.
  select string_agg(relname, ', ') into v_norls
    from pg_class
   where oid = 'public.messages'::regclass
     and not relrowsecurity;

  if v_norls is not null then
    raise exception
      'LIV-78 aborted: row-level security is DISABLED on %, so msg_update is inert',
      v_norls;
  end if;

  select string_agg(format('%s (%s on %s)', polname, polcmd, polrelid::regclass), ', ')
    into v_extra
  from pg_policy
  where polcmd in ('a', 'w', '*')
    and polrelid = 'public.messages'::regclass
    and polname not in ('msg_insert', 'msg_update');

  if v_extra is not null then
    raise exception
      'LIV-78 aborted: unrecognised write policies survive on messages and will OR with msg_update: %',
      v_extra;
  end if;

  -- A still-null polwithcheck is precisely the defect, so this catches a silent no-op apply.
  select string_agg(polname, ', ') into v_nocheck
  from pg_policy
  where polrelid = 'public.messages'::regclass
    and polcmd in ('w', '*')
    and polwithcheck is null;

  if v_nocheck is not null then
    raise exception
      'LIV-78 aborted: update policy on messages still has no WITH CHECK: %',
      v_nocheck;
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.messages'::regclass
      and tgname = 'trg_messages_freeze_identity'
      and not tgisinternal
  ) then
    raise exception
      'LIV-78 aborted: trg_messages_freeze_identity is not installed on messages';
  end if;
end $$;
