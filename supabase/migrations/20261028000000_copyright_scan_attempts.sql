-- ============================================================================
-- copyright_scan_attempts — the ledger scan-upload's daily quota counts
-- ============================================================================
--
-- scan-upload capped spend at SCANS_PER_USER_PER_DAY by counting the caller's rows in
-- track_copyright_scans. That counted VERDICTS, not CALLS, and both ways a verdict
-- disappears let the cap be walked past:
--
--   • the verdict is upserted on (track_id, provider), so re-scanning the same track
--     rewrites one row and its created_at never moves — a loop of calls on one track
--     never reached 429;
--   • 20260923090000 deletes a track's unanswered scan rows with the track, so deleting
--     and re-uploading handed the slot back.
--
-- With the whole-song path (AudD's enterprise endpoint, up to 100 billed chunks a call)
-- that turned one account into an unbounded bill. This table is what the quota counts
-- instead: one row per call that reaches the provider, written BEFORE the call, never
-- updated, and not tied to the track — so nothing the uploader can do to a track gives a
-- call back.
--
-- ── Who touches it ──────────────────────────────────────────────────────────
-- Only scan-upload, with the service role. RLS is on with NO policies and every client
-- grant is revoked: no app reads or writes it. `user_id` cascades with the profile, so a
-- deleted account takes its history with it; a new account starts a fresh count, as it
-- would anyway.
--
-- ADDITIVE ONLY: one new table and its index. No shipped app reads or writes it, and
-- scan-upload keeps working against the old count until its new version is deployed.
-- ============================================================================

create table if not exists public.copyright_scan_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- Not a foreign key, on purpose: an attempt outlives its track (see above).
  track_id uuid not null,
  -- Whole-song calls are the expensive ones and have their own, smaller allowance.
  full_song boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists copyright_scan_attempts_user_created_idx
  on public.copyright_scan_attempts (user_id, created_at desc);

alter table public.copyright_scan_attempts enable row level security;

-- NO POLICIES: written and read only by scan-upload's service-role client.
revoke all on public.copyright_scan_attempts from anon, authenticated;

comment on table public.copyright_scan_attempts is
  'One row per scan-upload call that reached the recognition provider. Counted by the '
  'per-user daily quota; append-only, not tied to the track, service role only.';
