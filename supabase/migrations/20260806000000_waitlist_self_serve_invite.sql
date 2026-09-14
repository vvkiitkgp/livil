-- ============================================================================
-- Waitlist self-serve invite — the two RPCs the public join path needs
-- ============================================================================
--
-- Goal: submitting the waitlist form sends the invite immediately, instead of
-- waiting for an operator to click Send in /ops.
--
-- ── WHY RPCs AND NOT A TRIGGER ──────────────────────────────────────────────
--
-- A trigger would be the obvious answer and is not available: emitting HTTP from
-- Postgres needs pg_net, which does NOT exist on this project (no `net` schema —
-- verified), and ADR-0008 rejects dashboard-configured Database Webhooks as
-- unversioned production state. So the send happens in an edge function, and these
-- functions are the two things that edge function cannot do as `anon`.
--
-- ── WHY NOT service_role IN THE EDGE FUNCTION ───────────────────────────────
--
-- ADR-0008 §4. The function holds the Resend key and nothing else; it talks to the
-- database with the same `anon` key the browser uses. These two DEFINER functions are
-- the narrow, auditable holes that allows — each does exactly one thing, neither can
-- read the list.
--
-- ── THE HONEST WEAK SPOT ────────────────────────────────────────────────────
--
-- `waitlist_mark_emailed` is executable by `anon`, because the caller is an
-- unauthenticated edge function. Someone holding a row id could therefore mark that
-- row as emailed. Assessed as acceptable, and here is the reasoning rather than a
-- shrug:
--
--   * Row ids are uuids and the table has no SELECT policy for anon, so they cannot
--     be enumerated. The only id a caller ever learns is the one for the address they
--     themselves just submitted.
--   * The update is idempotent (`WHERE email_sent_at IS NULL`), so a forged call can
--     flip a row from pending to sent exactly once and can never un-send or overwrite.
--   * The blast radius is one wrong badge in an internal dashboard. No data is
--     exposed, no mail is sent, no access is granted.
--
-- If that ever stops being acceptable, the fix is a signed one-time token minted by
-- `waitlist_request` and consumed here — not a service_role key.

-- ── who triggered the send ──────────────────────────────────────────────────
--
-- Once invites fire on their own, "was this sent?" stops being the interesting
-- question and "did the automation actually fire, or did I send it by hand?" starts.
-- Without this column the two are indistinguishable, and a silently-broken automation
-- looks exactly like a working one for as long as someone keeps clicking Send.
--
-- NULL means never sent. Existing rows keep NULL until their next successful send;
-- the four invites sent by hand before this migration are not retro-labelled, because
-- guessing at history is how a status column starts lying.

ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS email_source text
    CONSTRAINT waitlist_email_source_check
    CHECK (email_source IN ('auto', 'ops'));

COMMENT ON COLUMN public.waitlist.email_source IS
  '''auto'' = sent by waitlist-join on signup; ''ops'' = sent by hand from /studio/ops. NULL = never sent.';

-- ── request ─────────────────────────────────────────────────────────────────
--
-- Returns the id of a NEWLY created row, or NULL when the address was already on the
-- list. That distinction is what stops a repeat submission from sending a second
-- invite; the caller must treat NULL as "success, do not send".
--
-- The caller sees only its own result, so this leaks no membership: a person
-- submitting their own address learns whether they had already signed up, which they
-- are entitled to know. `web/src/auth/signIn.ts` still reports both outcomes to the
-- visitor identically, preserving the anti-enumeration property of the original design.
--
-- DEFINER + `search_path = public, pg_temp` per LIV-16: pg_temp is searched first for
-- relation names when unlisted, so a caller could otherwise shadow `public.waitlist`
-- with a temp table inside this body. Keep pg_temp last.

CREATE OR REPLACE FUNCTION public.waitlist_request(p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_id    uuid;
BEGIN
  -- Cheap sanity only. The edge function does the real validation; this exists so the
  -- function cannot be used to write junk directly through PostgREST.
  IF v_email IS NULL
     OR length(v_email) < 3
     OR length(v_email) > 254
     OR v_email !~ '^[^@[:space:]]+@[^@[:space:].]+(\.[^@[:space:].]+)+$'
  THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.waitlist (email)
  VALUES (v_email)
  ON CONFLICT (email) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;  -- NULL when the address was already present
END;
$$;

REVOKE ALL ON FUNCTION public.waitlist_request(text) FROM public;
GRANT EXECUTE ON FUNCTION public.waitlist_request(text) TO anon, authenticated;

-- ── mark emailed ────────────────────────────────────────────────────────────
--
-- Idempotent by design: `email_sent_at IS NULL` in the WHERE clause means a row can
-- transition pending -> sent once and never back. An error is recorded without
-- setting `email_sent_at`, so a failed attempt stays visibly unsent in the dashboard
-- and can be retried by hand.

-- `email_source` is hardcoded to 'auto' rather than taken as a parameter. This function
-- is reachable by anon; letting a caller claim 'ops' would let it forge the one field
-- that tells you whether the automation is alive. The dashboard writes 'ops' through
-- its own RLS UPDATE, which requires being in `ops_users`.

CREATE OR REPLACE FUNCTION public.waitlist_mark_emailed(p_id uuid, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.waitlist
     SET email_sent_at  = CASE WHEN p_error IS NULL THEN now() ELSE NULL END,
         email_error    = CASE WHEN p_error IS NULL THEN NULL ELSE left(p_error, 500) END,
         email_source   = CASE WHEN p_error IS NULL THEN 'auto' ELSE email_source END,
         email_attempts = email_attempts + 1
   WHERE id = p_id
     AND email_sent_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.waitlist_mark_emailed(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.waitlist_mark_emailed(uuid, text) TO anon, authenticated;
