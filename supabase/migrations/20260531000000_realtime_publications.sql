-- ─────────────────────────────────────────────────────────────────────────────
-- Enable Supabase Realtime (postgres_changes) for chat tables
-- Without this, INSERT/UPDATE/DELETE on these tables never emits CDC events
-- to subscribed clients, so live chat appears broken.
-- REPLICA IDENTITY FULL is needed so UPDATE/DELETE payloads contain enough
-- info (full old row) to identify rows reacted-to / edited.
-- ─────────────────────────────────────────────────────────────────────────────

alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table message_reactions;

alter table messages          replica identity full;
alter table message_reactions replica identity full;
