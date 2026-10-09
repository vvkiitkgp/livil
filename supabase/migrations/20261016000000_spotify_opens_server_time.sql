-- spotify_opens.created_at is the server's clock, never the client's (ADR-0027).
--
-- 20261014000000_play_stats.sql gave `created_at` only a DEFAULT, and a default is just a
-- fallback: a client calling the table's REST endpoint with its own token could send any
-- timestamp. A row dated 2099 sat at the top of ops_recent_plays forever and was counted in
-- every ops_play_summary window (`created_at >= now() - N days` has no upper bound); a row
-- dated 2020 was accepted too. Nothing was exposed — the damage was confined to the
-- numbers on /studio/ops — but those numbers are the point of the table.
--
-- Fix: a BEFORE INSERT trigger overwrites the value with now(), the same pattern as
-- jam_suggestions (20260930000000). Not a column-level REVOKE: the RLS test harness
-- re-grants table privileges after the migration chain runs, so a test of a REVOKE would
-- pass for the wrong reason (see 20260722160000_counters_are_not_client_writable.sql).
--
-- Volume (one account inserting many rows) is the known no-rate-limit gap shared with
-- search_result_taps; ops_top_played ranks by DISTINCT people first, which bounds it.
--
-- ── WHY THIS IS SAFE FOR APPS ALREADY INSTALLED ────────────────────────────
-- No released app writes this table (it is not referenced at release 2.1.2), and the new
-- app never sends created_at (recordSpotifyOpen inserts spotify_track_id, source, user_id).
-- Insert shape, policies and return values are unchanged.
--
-- ── EXISTING DATA ───────────────────────────────────────────────────────────
-- Untouched. Production held one row at the time of writing (2026-10-08 20:18 UTC, a real
-- hand-off from a dev build), with no future or pre-launch timestamps.
-- ============================================================================

create or replace function public.spotify_opens_server_time()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists spotify_opens_server_time on public.spotify_opens;
create trigger spotify_opens_server_time
  before insert on public.spotify_opens
  for each row execute function public.spotify_opens_server_time();
