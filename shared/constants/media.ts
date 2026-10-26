/**
 * Length limits, shared by the app and the web studio so the two can't drift.
 *
 * Enforced CLIENT-SIDE only, deliberately: a DB CHECK on `tracks.duration_seconds`
 * would reject uploads from shipped app builds that don't know the rule (and the
 * column is nullable — duration backfills on first play when it can't be probed).
 */

/** Shortest audio or video file that can be uploaded as a track. */
export const MIN_TRACK_SECONDS = 10;

/**
 * Longest audio or video file that can be uploaded as a track — 15 minutes.
 *
 * Why: the server-side transcoder (ADR-0033) re-encodes heavy uploads on a GitHub runner
 * at roughly real time, with a 20-minute budget per file. The phone app's 500 MB cap
 * already keeps its uploads well inside that; the web studio accepts 2 GB (resumable), so
 * an hour-long video could arrive there and never get its light copy. Checked at pick
 * time in the studio queue and again before publish. Not yet enforced by the phone app
 * (its size cap covers it) — wire it into UploadScreen whenever it next ships.
 */
export const MAX_TRACK_SECONDS = 15 * 60;

/** Shortest clip a repost may carry. Capped to the track's own length for tracks
 *  uploaded before MIN_TRACK_SECONDS existed. Stories have their own 10s MAX. */
export const MIN_REPOST_CLIP_SECONDS = 10;

export function tooShortMessage(seconds: number): string {
  return `Tracks need to be at least ${MIN_TRACK_SECONDS} seconds long — this one is ${Math.max(1, Math.round(seconds))}s.`;
}

export function tooLongMessage(seconds: number): string {
  return `Tracks can be at most ${MAX_TRACK_SECONDS / 60} minutes long — this one is ${formatMinutes(seconds)}.`;
}

/**
 * The reason a file of this length cannot be a track, or null when it can. An unknown
 * length (the browser could not probe it) is let through — see readMediaMeta.
 */
export function trackLengthError(seconds: number | null): string | null {
  if (seconds === null || !(seconds > 0)) { return null; }
  if (seconds < MIN_TRACK_SECONDS) { return tooShortMessage(seconds); }
  if (seconds > MAX_TRACK_SECONDS) { return tooLongMessage(seconds); }
  return null;
}

/** 3725 → "1h 2m", 754 → "12m 34s", 59 → "59s". */
function formatMinutes(seconds: number): string {
  const total = Math.max(1, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) { return `${h}h ${m}m`; }
  if (m > 0) { return `${m}m ${s}s`; }
  return `${s}s`;
}
