-- Messages to the Livil team, sent from the creator studio and read in /studio/ops.
--
-- WHY A TABLE RATHER THAN THE EXISTING mailto:. Mobile's Settings → Contact support opens
-- `mailto:` (SettingsScreen.tsx). That loses everything the moment it hands off: no username,
-- no account age, no record that anyone tried — and a mail client opening mid-task is where
-- most people give up. A row costs nothing and is observable.
--
-- STUDIO ONLY, and authenticated only. Deliberately NOT the anon-writable shape `waitlist`
-- uses: an unauthenticated write endpoint on a public marketing page is a spam target that
-- would need rate limiting and probably a captcha before it could ship. Every sender here is
-- already a signed-in artist, so `sender_id` is trustworthy and abuse is attributable.

CREATE TABLE IF NOT EXISTS public.team_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Bounded in the database, not only in the form. The client check is a courtesy; this is
  -- the one that holds when someone posts directly to PostgREST.
  body       text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.team_messages IS
  'Free-text messages from artists to the Livil team. Read-only in /studio/ops; there is no reply path in the product — replies happen by email.';

-- ON DELETE CASCADE is the deliberate choice, matching post_reports. An artist who deletes
-- their account is promised their data goes (DeleteAccountScreen + the deleted_accounts
-- ledger); keeping their correspondence would break that promise for the sake of an inbox.

-- Newest-first is the only ordering the dashboard uses.
CREATE INDEX IF NOT EXISTS team_messages_created_at_desc_idx
  ON public.team_messages (created_at DESC);

ALTER TABLE public.team_messages ENABLE ROW LEVEL SECURITY;

-- ── policies ────────────────────────────────────────────────────────────────

-- Anyone signed in may write, but only as themselves. WITH CHECK on sender_id is what stops
-- a message being attributed to someone else — RLS constrains which ROWS, so without this a
-- client could set any sender_id it liked.
CREATE POLICY team_messages_insert_own ON public.team_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (sender_id = auth.uid());

-- Reading is ops-only, on the same `is_ops()` gate the waitlist dashboard uses
-- (20260805000000). Note the sender CANNOT read their own message back: there is no
-- "your messages" view in the product, and a SELECT policy for senders would exist only to
-- serve a screen that does not exist.
CREATE POLICY team_messages_select_ops ON public.team_messages
  FOR SELECT
  TO authenticated
  USING (public.is_ops());

-- No UPDATE and no DELETE policy, for anyone. The ops view is read-only by decision, and a
-- message nobody can edit is a message that still says what was sent. Add a `handled_at`
-- column and an ops UPDATE policy if the queue ever needs draining.
