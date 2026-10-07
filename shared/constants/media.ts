/**
 * Minimum lengths, shared by the app and the web studio so the two can't drift.
 *
 * Enforced CLIENT-SIDE only, deliberately: a DB CHECK on `tracks.duration_seconds`
 * would reject uploads from shipped app builds that don't know the rule (and the
 * column is nullable — duration backfills on first play when it can't be probed).
 */

/** Shortest audio or video file that can be uploaded as a track. */
export const MIN_TRACK_SECONDS = 10;

/** Shortest clip a repost may carry. Capped to the track's own length for tracks
 *  uploaded before MIN_TRACK_SECONDS existed. Stories have their own 10s MAX. */
export const MIN_REPOST_CLIP_SECONDS = 10;

export function tooShortMessage(seconds: number): string {
  return `Tracks need to be at least ${MIN_TRACK_SECONDS} seconds long — this one is ${Math.max(1, Math.round(seconds))}s.`;
}
