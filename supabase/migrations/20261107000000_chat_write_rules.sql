-- ============================================================================
-- Chat write rules: a sent message's content is fixed; reactions are by members and
-- can be changed
-- ============================================================================
--
-- Three things, found by the chat-vibe security review and a follow-up (2026-10-18):
--
-- 1. A SENT MESSAGE'S CONTENT CANNOT BE REWRITTEN. msg_update lets a sender update their
--    own messages, and messages_freeze_identity (20260729000000) froze only id,
--    conversation_id and created_at — so kind, body, metadata and reply_to_id could be
--    rewritten through the API on any message ever sent, with its original time kept. No
--    app has an edit feature; the only update any build sends is `deleted_at` (soft
--    delete, messages.ts — checked at release 2.1.3, 1c56cd0, and HEAD). Now refused for
--    every caller, like the identity columns. One exception: reply_to_id may be CLEARED by
--    the database — `reply_to_id ... on delete set null` (20260730000000) clears it when
--    the quoted message is deleted, through an UPDATE run as the table owner — but not by
--    an API caller.
--    deleted_at stays as it was (ADR-0014: not a boundary).
--
-- 2. ONLY SOMEONE WHO MAY WRITE IN THE CHAT CAN REACT. rxn_insert checked only
--    `user_id = auth.uid()`, so anyone who knew a message id could react to it. Now the
--    reactor must be a member of the message's conversation AND pass
--    can_write_to_conversation() — the test msg_insert uses — so in a one-to-one chat a
--    blocked or unfriended person can no longer react (membership survives both).
--
-- 3. A REACTION CAN BE CHANGED. The app sets a reaction with an UPSERT on
--    (message_id, user_id) (messages.ts), and there was no UPDATE policy — so picking a
--    different emoji on a message you had already reacted to failed with an RLS error,
--    which the app ignores: the old emoji just stayed. rxn_update allows your own row,
--    under the same test as (2).
--
-- ADDITIVE for shipped apps: (1) refuses only writes no build sends; (2) refuses only
-- reactions from outside a chat (never offered) and in a one-to-one chat the reactor may
-- no longer write in (blocked / unfriended — sending there is already refused); (3) makes
-- a failing write work.
-- ============================================================================

-- ── 1. A sent message's content is fixed ─────────────────────────────────────
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

-- (trg_messages_freeze_identity, before update on public.messages, already calls it.)

-- ── 2 & 3. Reactions: members only, and changeable ──────────────────────────
drop policy if exists "rxn_insert" on public.message_reactions;
create policy "rxn_insert" on public.message_reactions for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1
        from public.messages m
        join public.conversation_members cm on cm.conversation_id = m.conversation_id
       where m.id = message_reactions.message_id
         and cm.user_id = auth.uid()
         and public.can_write_to_conversation(m.conversation_id)
    )
  );

drop policy if exists "rxn_update" on public.message_reactions;
create policy "rxn_update" on public.message_reactions for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1
        from public.messages m
        join public.conversation_members cm on cm.conversation_id = m.conversation_id
       where m.id = message_reactions.message_id
         and cm.user_id = auth.uid()
         and public.can_write_to_conversation(m.conversation_id)
    )
  );
