-- ============================================================================
-- Waitlist ops dashboard — readable list, tracked outreach
-- ============================================================================
--
-- 20260718000000_waitlist_table.sql created `waitlist` as a write-only drop box:
-- anon INSERT, and no SELECT policy for anyone. That was deliberate anti-scraping
-- and it worked, but it also meant nobody could see a signup without opening the
-- Supabase dashboard. Four people joined between 2026-07-22 and 2026-07-23 and
-- went unnoticed for thirteen days. This migration makes the list legible to ops
-- WITHOUT making it legible to anyone else, and gives outreach a place to record
-- itself so "did we email them?" stops being a question nobody can answer.
--
-- ── WHY AN ALLOWLIST TABLE AND NOT A FLAG ON `profiles` ─────────────────────
--
-- `profiles` is readable by every authenticated client. An `is_ops boolean` there
-- would publish the operator roster to the whole userbase — a targeting list. So
-- membership lives in its own relation with NO policies at all: RLS is enabled and
-- nothing grants access, which under Postgres RLS means no client can read, write,
-- or probe it through PostgREST. Only the DEFINER function below can see it.
--
-- ── WHY NOT service_role ────────────────────────────────────────────────────
--
-- ADR-0008 §4: nothing may hold a service_role key — it is a bearer JWT that
-- bypasses RLS on every table and cannot be revoked in isolation. So the ops
-- dashboard authenticates as an ordinary user and reads the waitlist through the
-- policies below. The database is the boundary; the UI is not hiding anything.
-- This also means shipping the /ops route publicly is safe by construction — a
-- non-ops visitor who loads it sees an empty list, not a permission error.

-- ── ops roster ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ops_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enabled with zero policies: deny-all to anon and authenticated alike.
ALTER TABLE public.ops_users ENABLE ROW LEVEL SECURITY;

-- ── the guard ───────────────────────────────────────────────────────────────
--
-- DEFINER because `ops_users` is deny-all — a caller cannot check their own
-- membership directly, which is the point.
--
-- `search_path = public, pg_temp` per LIV-16 (20260724000000): pg_temp is searched
-- FIRST for relation names when it is not listed explicitly, so any caller could
-- otherwise `create temp table ops_users(user_id uuid)` and shadow the real table
-- inside this body. Pinning pg_temp LAST closes that. Do not drop the pg_temp entry.

CREATE OR REPLACE FUNCTION public.is_ops()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ops_users WHERE user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_ops() FROM public;
GRANT EXECUTE ON FUNCTION public.is_ops() TO authenticated;

-- ── outreach state ──────────────────────────────────────────────────────────
--
-- Only columns whose values we can actually observe. Deliberately ABSENT:
--
--   * joined_group / accepted_tester — the Play Developer API's Testers resource
--     exposes only googleGroups[] and has no read of individual opt-in state
--     (developers.google.com/android-publisher/api-ref/rest/v3/edits.testers).
--     Google Groups membership for a consumer account has no API either. A column
--     here would be a field nothing can ever fill.
--   * signed_up — derivable by matching auth.users, but that needs a privileged
--     read across the auth schema. Deferred rather than faked.

ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_error   text,
  ADD COLUMN IF NOT EXISTS email_attempts integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.waitlist.email_sent_at IS
  'Set when Resend accepted the invite email. NULL = never successfully sent.';
COMMENT ON COLUMN public.waitlist.email_error IS
  'Last send failure, for the ops dashboard. Cleared on a subsequent success.';

-- Newest-first is the only ordering the dashboard uses.
CREATE INDEX IF NOT EXISTS waitlist_created_at_desc_idx
  ON public.waitlist (created_at DESC);

-- ── policies ────────────────────────────────────────────────────────────────
--
-- The anon INSERT policy from the original migration is left EXACTLY as it was.
-- Nothing here widens the public surface: anon still cannot read the list back.

CREATE POLICY waitlist_select_ops ON public.waitlist
  FOR SELECT
  TO authenticated
  USING (public.is_ops());

-- UPDATE is how the dashboard records a send. Scoped to ops on both sides of the
-- policy: USING gates which rows are visible to update, WITH CHECK gates the row
-- as it would exist afterwards. Omitting WITH CHECK would let an ops user rewrite
-- a row into a shape they could not have selected.
CREATE POLICY waitlist_update_ops ON public.waitlist
  FOR UPDATE
  TO authenticated
  USING (public.is_ops())
  WITH CHECK (public.is_ops());

-- No DELETE policy. Removing a signup is a dashboard-level action, not an app one.
