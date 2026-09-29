-- First-run guide: the 15-card animated tour shown ONCE after sign-up, before the
-- first Home screen. Remembered on the account (not the device) so a reinstall or a
-- second phone never replays it uninvited; Settings has an explicit "Replay the guide".
--
-- `guide_seen_at` is NULL for a brand-new account and stamped by the client when the
-- user finishes or skips the tour. EXISTING accounts are stamped by this migration:
-- nobody who signed up before the guide existed is prompted retroactively — the same
-- stance 20260628000000 took for `username_set`.
--
-- Written by the owner under the existing `profiles_update_own` policy. The column is
-- a timestamp and not a boolean so that an "already seen" state also says when — useful
-- when deciding later whether a redesigned guide should show again.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS guide_seen_at timestamptz;

COMMENT ON COLUMN public.profiles.guide_seen_at IS
  'When the first-run guide was finished or skipped. NULL = show it once after sign-up. Stamped for every account that predates the guide.';

-- Existing users never see the tour uninvited.
UPDATE public.profiles SET guide_seen_at = now() WHERE guide_seen_at IS NULL;
