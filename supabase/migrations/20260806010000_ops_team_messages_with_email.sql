-- Show the sender's email alongside a message in /studio/ops.
--
-- WHY A FUNCTION AND NOT A COLUMN. Email lives in `auth.users`, which no client may read.
-- The alternative — storing the address on the row at insert time — would mean trusting a
-- value the sender's browser supplied. RLS constrains which ROWS may be written, not what a
-- column contains, so a patched client could write someone else's address next to its own
-- message. Reading it from `auth.users` at query time means the address is whatever the
-- account actually has, and cannot be spoofed.
--
-- SECURITY DEFINER, SO AUTHORIZATION IS THIS FUNCTION'S JOB. Definer rights bypass RLS, which
-- is the entire reason it can see `auth.users` — and equally the reason it must gate itself.
-- `is_ops()` is checked first and the body is unreachable otherwise.
--
-- RETURNS EMPTY rather than raising for a non-ops caller, matching how the RLS-gated reads
-- behave everywhere else in the dashboard. /studio/ops has no route guard precisely because
-- a non-ops visitor loads a page with nothing in it; an exception here would make that page
-- show an error instead, and an error is a louder signal that something exists than an empty
-- list is.
--
-- `search_path = public, pg_temp` per LIV-16: pg_temp is searched FIRST for relation names
-- when not listed explicitly, so a caller could otherwise create a temp table to shadow
-- `team_messages` or `profiles` inside this body. Pinning pg_temp LAST closes that. Do not
-- drop the pg_temp entry.

CREATE OR REPLACE FUNCTION public.ops_team_messages()
RETURNS TABLE (
  id              uuid,
  body            text,
  created_at      timestamptz,
  sender_name     text,
  sender_username text,
  sender_email    text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_ops() THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT m.id, m.body, m.created_at, p.display_name, p.username, u.email::text
      FROM public.team_messages m
      JOIN public.profiles p ON p.id = m.sender_id
      -- LEFT JOIN: `profiles` cascades from `auth.users`, so an orphan should be impossible.
      -- Joining inner anyway would mean a single inconsistent row silently removing a message
      -- from the inbox, which is the wrong failure for a support queue.
      LEFT JOIN auth.users u ON u.id = m.sender_id
     ORDER BY m.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.ops_team_messages() FROM public;
GRANT EXECUTE ON FUNCTION public.ops_team_messages() TO authenticated;

COMMENT ON FUNCTION public.ops_team_messages() IS
  'Ops-only read of team_messages joined to the sender profile and auth email. Returns empty for a non-ops caller.';

-- REVOKE ALL ... FROM public does NOT remove a DIRECT grant to anon, and Supabase's default
-- privileges grant EXECUTE on every new public function to both anon and authenticated. The
-- revoke above therefore does nothing for anon on its own, which is not the intent it states.
--
-- Not exploitable — the body checks is_ops(), and auth.uid() is null for anon, so the worst
-- an anonymous caller gets is an empty set. Revoked anyway: a function that reads auth.users
-- should not be callable by an unauthenticated role at all, and "it happens to return
-- nothing" is a property of today's body rather than of the grant.
--
-- NOTE, wider than this migration: is_ops, claim_username, is_username_available and
-- account_email_hash all carry the same stale anon grant for the same reason. Each re-checks
-- authorization internally so none is exploitable today, but their migrations claim a revoke
-- that did not take. Worth a sweep of its own.
REVOKE EXECUTE ON FUNCTION public.ops_team_messages() FROM anon;
