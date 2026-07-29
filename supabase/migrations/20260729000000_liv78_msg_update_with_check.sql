-- ─────────────────────────────────────────────────────────────────────────────
-- LIV-78 — Restore the `messages` UPDATE boundary
--
-- THE DEFECT (verified against production 2026-07-29, PostgreSQL 17.6, and
-- reproduced on a scratch PostgreSQL 15.18 replay of this migration tree)
--
--   msg_update  (20260528000000_chat_jam.sql:277-278)
--     for update using (sender_id = auth.uid())      -- and NOTHING else
--
-- No `WITH CHECK`. PostgreSQL then applies the `USING` expression to the NEW row
-- as the write-side check, and that expression constrains exactly one column.
-- Every other column of the row is freely writable by its author — including
-- `conversation_id`. The author of a message can therefore MOVE it out of the
-- conversation it was sent to. The row disappears from the recipient's thread
-- and reappears elsewhere carrying its original timestamp, so it reads as
-- authentic history in a place it was never sent.
--
-- That is a live breach of the boundary 20260722200000_account_deletion.sql:153
-- was written to defend — "do not alter other people's records to tidy up your
-- own departure" — and of the scope boundary ratified in PROP-0003.
--
-- Contrast msg_insert (chat_jam.sql:268-275), which gets it right: authorship
-- AND an EXISTS over conversation_members. This migration gives UPDATE the same
-- perimeter INSERT already has, plus the OLD-vs-NEW comparison that RLS alone
-- cannot express.
--
-- CONSISTENT WITH ADR-0014, NOT IN TENSION WITH IT. That ADR prohibits GRANTING
-- an `authenticated` principal write access to a `messages` row they did not
-- author. This change only REMOVES access; it grants nothing to anyone. ADR-0014
-- names the fix explicitly and calls it a tightening.
--
-- ── THE OPEN QUESTION ON THE TICKET, ANSWERED BY EXECUTION ───────────────────
--
-- It was thought that relocation into a conversation the caller is NOT a member
-- of is already blocked, because `msg_select` is applied to the new row. It was
-- further supposed that this happens only when the statement carries a
-- `RETURNING` clause — and since PostgREST defaults to `Prefer: return=minimal`,
-- that the block would not hold for a real client.
--
-- Both halves of that are wrong, and the truth is worse than either.
--
-- PostgreSQL applies the SELECT policy to the new row of an UPDATE when the
-- statement REQUIRES SELECT PRIVILEGE on the relation — i.e. when it references
-- any column of the target table anywhere (a WHERE term, a RETURNING item, a SET
-- expression). `RETURNING` is one way to trigger that condition, not the
-- condition itself. Measured on PostgreSQL 15.18 against this migration tree,
-- as the author, relocating into a conversation the author is NOT in:
--
--   update ... where id = '<uuid>'                          -> DENIED  (42501)
--   update ... where id = '<uuid>' returning id             -> DENIED  (42501)
--   update ... returning id            (no WHERE)           -> DENIED  (42501)
--   update ... returning 1             (no WHERE)           -> ALLOWED
--   update ... where true              (no column ref)      -> ALLOWED
--   update ...                         (no WHERE at all)    -> ALLOWED
--
-- The last three reference no column of `messages`, so no SELECT privilege is
-- required, so no SELECT policy is applied to the new row, so nothing stops the
-- relocation. PostgREST emits exactly that shape for an UNFILTERED `PATCH` with
-- `Prefer: return=minimal`: no WHERE clause and `RETURNING 1`. Replaying that
-- literal statement shape moved every one of the caller's messages into a
-- conversation they are not a member of — `UPDATE 5`, five rows landed. PostgREST
-- permits unfiltered PATCH by default; its own documentation flags it as a
-- footgun and offers a `pre-request` guard, which we do not deploy.
--
-- So the accidental protection is not merely undocumented and fragile (it breaks
-- the moment anyone loosens `msg_select`). It does not hold today, through the
-- one path every real client uses. That is why the `WITH CHECK` below spells the
-- membership term out instead of inheriting it, and why the perimeter must not
-- depend on `msg_select` or on statement shape.
--
-- Requires security-reviewer sign-off (autonomy-config.yml: MANDATORY).
-- ─────────────────────────────────────────────────────────────────────────────


-- ── Step 1: msg_update gets an explicit WITH CHECK ───────────────────────────
-- `drop policy if exists` before create: permissive policies OR together, so a
-- leftover definition would defeat the scoped one that replaced it. Same reason
-- as 20260724120000_prop0004_harden_stories.sql:58 and
-- 20260722000000_liv10_authorization_guards.sql:191.
--
-- The WITH CHECK looks redundant with the USING and is not. Without it the
-- write-side check is INHERITED from USING, the membership term is absent from
-- it entirely, and the only thing standing between a client and another person's
-- thread is whether the statement happened to reference a column. Stated once,
-- here, because the next reader will otherwise "simplify" it back out.
--
-- Membership is resolved from the ROW'S OWN conversation_id, never from a
-- parameter. SECURITY INVOKER (policy default), so the subquery is evaluated as
-- the caller and inherits conversation_members' own RLS.
--
-- NOTE ON QUALIFICATION — load-bearing, mirroring the trap documented at
-- prop0004_harden_stories.sql:63. `conversation_members` has its OWN
-- `conversation_id` column, so the inner reference MUST be qualified
-- `messages.conversation_id`; unqualified it binds to the inner relation (inner
-- scope wins) and the predicate degenerates to `cm.conversation_id =
-- cm.conversation_id`, which is true for any row the caller is a member of
-- anywhere — i.e. no constraint at all. This is copied verbatim in shape from
-- msg_insert, which is already correct.
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


-- ── Step 2: freeze the row's identity across an UPDATE ───────────────────────
-- WHY A TRIGGER IS REQUIRED AND THE POLICY IS NOT SUFFICIENT.
--
-- RLS cannot compare OLD to NEW. It sees one row at a time. So the WITH CHECK
-- above rejects a move into a conversation the caller is not in — but it happily
-- accepts a move BETWEEN two conversations the caller IS in, because the new row
-- satisfies authorship and membership perfectly well. That is the primary form
-- of the defect: the message still vanishes from the recipient's thread, and it
-- still materialises in a second thread bearing its original timestamp. A fix
-- that stops only the harder case and leaves the easy one is the "guarded the
-- RPC and left the table open" mistake this repository has already made once.
--
-- Same reasoning and same shape as conversation_members_freeze_identity
-- (20260722000000_liv10_authorization_guards.sql:199) and
-- posts_freeze_counter_identity (20260722140000_freeze_counter_identity_columns).
-- A trigger, NOT a column-level GRANT: ADR-0014 rejected column grants as a
-- control because .github/workflows/ci.yml:180 runs
-- `grant all on all tables in schema public to authenticated` after migrations,
-- which evaporates them. Already recorded at
-- 20260722000000_liv10_authorization_guards.sql:186-190.
--
-- Triggers are fingerprinted by scripts/schema-fingerprint.sql:129-132
-- (pg_get_triggerdef, so timing and event list are covered too), and
-- schema-parity is a required check — so this cannot be silently consolidated
-- away without main going red.
--
-- WHAT IS FROZEN, AND WHAT DELIBERATELY IS NOT:
--
--   id              — the primary key. Rewriting it re-parents every reply_to_id
--                     reference and every message_reactions row.
--   conversation_id — the defect. Where the message lives is decided once, at
--                     insert, by msg_insert's membership check.
--   created_at      — where the message sits in the thread. Unconstrained today
--                     on insert as well; that is a separate finding and a
--                     separate ticket, but an EXISTING message must not be
--                     re-dated, which is what makes a relocated message read as
--                     authentic history.
--
--   sender_id       — NOT frozen, and this is deliberate. `delete_my_account()`
--                     relies on `messages_sender_id_fkey ... on delete set null`
--                     (20260722200000_account_deletion.sql:80). A referential
--                     SET NULL action performs a real UPDATE and DOES fire row
--                     triggers, so freezing sender_id here would break account
--                     deletion — the one thing on this table with an external
--                     Play Store deadline. It needs no freeze regardless: USING
--                     requires the OLD row's sender to be the caller and WITH
--                     CHECK requires the NEW row's sender to be the caller, so a
--                     client cannot hand the row to anyone else, and cannot null
--                     it (`null = auth.uid()` is NULL, not true → rejected).
--                     A test asserts the cascade still works.
--
--   deleted_at      — NOT frozen. ADR-0014 decided deliberately that `deleted_at`
--                     is not a boundary today (msg_select does not filter it) and
--                     that making it one needs a DEFINER actor. Constraining it
--                     here would pre-empt a decision that has been made the other
--                     way. Out of scope.
--
-- IF YOU ARE HERE BECAUSE AN EDIT- OR MOVE-MESSAGE FEATURE HIT THIS EXCEPTION:
-- this fires for EVERY caller, including a future SECURITY DEFINER RPC, because
-- triggers run regardless of who executes them. Give that RPC a named exemption
-- (a session GUC it sets, or an explicit condition here) rather than dropping the
-- trigger — dropping it re-opens cross-conversation relocation for every user.
--
-- SECURITY INVOKER (the default): the body touches only NEW and OLD and calls
-- nothing, so it needs no privilege and has no search_path exposure. search_path
-- is pinned anyway, matching conversation_members_freeze_identity, so a future
-- edit that does reference an object cannot be captured.
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


-- ── Drift check: a leftover permissive policy defeats the scoped one ─────────
-- Mirrors 20260724120000_prop0004_harden_stories.sql:140-179 and
-- 20260722000000_liv10_authorization_guards.sql:806-822. A half-applied
-- perimeter that looks applied is worse than a failed apply.
--
-- polcmd: 'a' = insert, 'w' = update, '*' = all (grants both). 'r' (select) and
-- 'd' (delete) are not the write perimeter and are excluded — there is no DELETE
-- policy on messages at all, which ADR-0014 decided to leave as it is.
do $$
declare
  v_extra text;
  v_norls text;
  v_nocheck text;
begin
  -- FIRST: a policy on a table with RLS disabled is inert, so everything above
  -- would be decoration and the scans below would find nothing to complain
  -- about. Checked first because it invalidates their meaning.
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

  -- And assert the thing this migration exists to install actually installed.
  -- polwithcheck IS NULL is precisely the defect being fixed; if it is still
  -- null afterwards, the apply silently did nothing.
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
