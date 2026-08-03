-- Per-category push preferences, honoured by send-push before it sends.
--
-- WHY A TABLE AT ALL, given Android already has channels.
--
-- Android notification channels genuinely work, but they are on-device OS state and
-- an app cannot change them: once created, a channel's importance belongs to the
-- user, createChannel() on an existing id will not move it, and delete+recreate
-- restores the user's prior choice by design. So an in-app SWITCH cannot drive a
-- channel — which is why the settings screen deep-links out to Android instead.
--
-- Two things that does not solve:
--   1. iOS has no channels at all, so it is all-or-nothing there.
--   2. send-push sends regardless. A muted Android channel still costs an FCM call
--      and still wakes the device; the OS merely declines to draw the notification.
--
-- This table is the app-level answer: it decides whether we SEND. It is deliberately
-- NOT a mirror of the Android channel state — the user can change that from outside
-- the app at any time, so a copy would drift and then lie. The two answer different
-- questions and are shown separately in the UI: the switch is intent ("send me
-- these"), the Android readout is delivery ("this is what the OS will do with them").
--
-- SHAPE: one row per user, one boolean per category — not (user_id, category, enabled).
-- The categories are a fixed set of four, defined in NOTIFICATION_CHANNELS and mapped
-- from the 14 push kinds by channelFor(); a column keeps the edge function to one
-- lookup and makes "add a category" a reviewed schema change rather than silent data.
--
-- The column names ARE the channel ids ('social' | 'activity' | 'messages' | 'jam').
-- channelFor() returns exactly those four literals and nothing else, so the edge
-- function can index this row by its result. Renaming a channel means renaming a
-- column; that coupling is intentional and asserted by the tests on both sides.
--
-- NOT ON `profiles`: profiles_select_authenticated is `using (true)`, so every signed-in
-- user can read every column of every profile. Notification preferences would be
-- world-readable. This table is self-only.
--
-- ABSENT ROW = ALL ENABLED. Nothing backfills existing users, and nothing needs to:
-- send-push treats a missing row as "no objection" and only skips on an explicit
-- `false`. That makes the migration safe to apply ahead of any client that writes it —
-- behaviour is identical to today until a user actually turns something off.
create table if not exists public.notification_preferences (
  -- References auth.users, not profiles, matching device_tokens. Deletion of the auth
  -- user cascades here; the account-deletion RPC walks the transitive closure from
  -- auth.users and would fail loudly if this FK were NO ACTION / RESTRICT.
  user_id    uuid primary key references auth.users(id) on delete cascade,
  social     boolean not null default true,
  activity   boolean not null default true,
  messages   boolean not null default true,
  jam        boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

-- Owner-only on all three operations. No DELETE policy: a user removing their row
-- would silently re-enable every category, and cascade already handles account
-- deletion. The service-role client used by send-push bypasses RLS entirely.
drop policy if exists notification_preferences_select_self on public.notification_preferences;
create policy notification_preferences_select_self on public.notification_preferences
  for select to authenticated using (user_id = auth.uid());

drop policy if exists notification_preferences_insert_self on public.notification_preferences;
create policy notification_preferences_insert_self on public.notification_preferences
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists notification_preferences_update_self on public.notification_preferences;
create policy notification_preferences_update_self on public.notification_preferences
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

comment on table public.notification_preferences is
  'Per-category push preferences, one row per user. Read by send-push (service role) to skip sending a muted category. Absent row = all categories enabled. Column names are the notifee channel ids returned by channelFor(). Distinct from Android channel state, which is OS-owned and not mirrored here.';
