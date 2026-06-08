-- Enforce one reaction per (user, message) at the DB level. The previous PK
-- (message_id, user_id, emoji) allowed the same user to stack multiple
-- emojis on a single message — the client tried to prevent this by
-- DELETE-then-INSERT inside addReaction(), but those two statements aren't
-- atomic and a fast double-tap could race past the delete.
--
-- This migration:
--   1. Dedupes existing rows, keeping only the newest reaction per
--      (message_id, user_id).
--   2. Drops the old PK and re-keys on (message_id, user_id), so a second
--      INSERT for the same pair now conflicts. The client switches to
--      UPSERT (ON CONFLICT DO UPDATE) so toggles overwrite atomically.

-- Step 1 — dedupe. Keep the row with the latest created_at; drop the rest.
delete from public.message_reactions
where ctid not in (
  select distinct on (message_id, user_id) ctid
  from public.message_reactions
  order by message_id, user_id, created_at desc
);

-- Step 2 — repoint the primary key. Drop the composite (m,u,e) and add (m,u).
alter table public.message_reactions
  drop constraint message_reactions_pkey;

alter table public.message_reactions
  add primary key (message_id, user_id);
