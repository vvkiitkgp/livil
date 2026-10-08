-- Why people delete their accounts: the optional question on the way out, readable in
-- /studio/ops (Insights tab).
--
-- PURELY ADDITIVE. A new table and a new function; nothing a shipped app reads or calls is
-- touched. Old apps never ask the question, so they never call submit_account_exit_feedback,
-- and delete_my_account is unchanged.
--
-- THE ANSWER OUTLIVES THE ACCOUNT, ANONYMOUSLY. `user_id` references auth.users with
-- ON DELETE SET NULL. delete_my_account ends in `delete from auth.users`, so the moment the
-- deletion goes through the row loses its link to the person and keeps only what they chose
-- to tell us. The question says so on the phone before they answer. A NULL user_id is
-- therefore also the "did they actually go through with it" signal: a row that still has a
-- user_id belongs to someone who answered and then backed out (or whose deletion failed).
--
-- WRITES ONLY THROUGH THE FUNCTION. No INSERT/UPDATE/DELETE policy exists, so a direct
-- PostgREST write is rejected. The function stamps user_id from the session (a caller
-- cannot file feedback under someone else's account) and works out account age from
-- auth.users, which no client may read. One row per account: answering twice — deleting,
-- failing, retrying — replaces the earlier answer instead of counting the person twice.
--
-- DAY PRECISION ON PURPOSE. delete_my_account writes deleted_accounts(username, deleted_at)
-- a second or two after this row; an exact created_at would let anyone with database access
-- join the two on time and put a username back on an "anonymous" answer. The function stores
-- the start of the day instead — the ops page only ever shows the date.
--
-- READS ARE OPS-ONLY, through RLS on the table itself (`is_ops()`), the same posture as
-- team_messages: a non-ops session gets an empty list, not an error.

CREATE TABLE IF NOT EXISTS public.account_exit_feedback (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Mirrors shared/constants/exitFeedback.ts. Widen this CHECK before shipping a client
  -- that offers a new reason.
  reason           text CHECK (reason IN (
                     'no_music', 'no_friends', 'bugs', 'hard_to_use', 'privacy', 'break', 'other'
                   )),
  note             text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 1000),
  platform         text CHECK (platform IN ('ios', 'android', 'web')),
  account_age_days integer CHECK (account_age_days >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- An empty answer is a skip, and a skip is not a row.
  CONSTRAINT account_exit_feedback_not_empty CHECK (reason IS NOT NULL OR note IS NOT NULL)
);

COMMENT ON TABLE public.account_exit_feedback IS
  'Optional reason given when deleting an account. user_id is SET NULL by the deletion, leaving the answer anonymous. Written only via submit_account_exit_feedback; read only by ops.';

CREATE INDEX IF NOT EXISTS account_exit_feedback_created_at_desc_idx
  ON public.account_exit_feedback (created_at DESC);

ALTER TABLE public.account_exit_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY account_exit_feedback_select_ops ON public.account_exit_feedback
  FOR SELECT
  TO authenticated
  USING (public.is_ops());


-- `search_path = public, pg_temp` per LIV-16: pg_temp LAST so a caller cannot shadow
-- account_exit_feedback with a temp table inside this definer body.
CREATE OR REPLACE FUNCTION public.submit_account_exit_feedback(
  p_reason   text DEFAULT NULL,
  p_note     text DEFAULT NULL,
  p_platform text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me      uuid := auth.uid();
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_created timestamptz;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '42501';
  END IF;

  -- Nothing chosen and nothing written is a skip. Not an error: the client calls this
  -- unconditionally and must never be blocked from deleting by its own survey.
  IF p_reason IS NULL AND v_note IS NULL THEN
    RETURN;
  END IF;

  SELECT u.created_at INTO v_created FROM auth.users u WHERE u.id = v_me;

  -- reason / note / platform are validated by the table's CHECKs; a bad value raises here
  -- and the client swallows it (see submitExitFeedback).
  INSERT INTO public.account_exit_feedback
    (user_id, reason, note, platform, account_age_days, created_at)
  VALUES (
    v_me,
    p_reason,
    left(v_note, 1000),
    p_platform,
    greatest(0, current_date - v_created::date),
    date_trunc('day', now())   -- see "DAY PRECISION" in the header
  )
  ON CONFLICT (user_id) DO UPDATE
    SET reason           = excluded.reason,
        note             = excluded.note,
        platform         = excluded.platform,
        account_age_days = excluded.account_age_days,
        created_at       = date_trunc('day', now());
END;
$$;

-- REVOKE ... FROM public does not remove Supabase's direct default grant to anon, so anon is
-- named explicitly (see 20260806010000_ops_team_messages_with_email.sql).
REVOKE ALL ON FUNCTION public.submit_account_exit_feedback(text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_account_exit_feedback(text, text, text) TO authenticated;

COMMENT ON FUNCTION public.submit_account_exit_feedback(text, text, text) IS
  'Records (or replaces) the caller''s optional account-deletion reason. Skips silently when both reason and note are empty.';
