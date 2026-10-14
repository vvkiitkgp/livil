-- ============================================================================
-- push_like_alerts — when send-push last made a sound about likes on one post
-- ============================================================================
-- Likes on one post now arrive as ONE notification card that updates in place ("Riya"
-- → "Priya and 4 others"), and only the first like in a 15-minute window alerts; later
-- ones replace the card silently. send-push decides which like is the loud one by
-- claiming this row (claimLikeAlert): it inserts it, or moves last_alert_at forward only
-- when the previous alert is older than the window. Each step is a single statement, so
-- two likes racing for the same window cannot both be loud.
--
-- One row per (recipient, post) that has ever been pushed about. Written only by
-- send-push with the service role; deny-all to clients (RLS on, no policies, privileges
-- revoked) — nothing in any app reads or writes it. Rows go with the recipient's profile
-- (account deletion) and with the post, like activity_notifications'.
--
-- PRODUCTION: additive — a new table no shipped app knows about. send-push treats a
-- missing table or any error as "loud", which is the behaviour before this change, so
-- the function may be deployed before or after this migration.
-- ============================================================================

create table if not exists public.push_like_alerts (
  recipient_id  uuid not null references public.profiles(id) on delete cascade,
  post_id       uuid not null references public.posts(id) on delete cascade,
  last_alert_at timestamptz not null default now(),
  primary key (recipient_id, post_id)
);
alter table public.push_like_alerts enable row level security;
revoke all on public.push_like_alerts from anon, authenticated;

-- The post's own deletion cascades through this index rather than a sequential scan.
create index if not exists push_like_alerts_post_idx on public.push_like_alerts (post_id);
