/**
 * Pure decision logic for the chat "listening now" indicator.
 *
 * The indicator depends ONLY on whether the person is playing music in Livil — never
 * on whether the app is open. The listener's device keeps one row in
 * `listen_sessions` current; the database treats a row as LIVE while
 * `playing && updated_at > now() - LIVE_WINDOW` (see
 * supabase/migrations/20260925000000_listening_now.sql — keep the two in step).
 *
 * The I/O lives in src/services/listeningStatus.ts; this file only decides WHAT to
 * write and WHEN, so the throttling that bounds the cost of the feature is testable.
 */

/** Re-stamp the row this often while playing. */
export const LISTENING_HEARTBEAT_MS = 60_000;

/**
 * How long a row stays live without a re-stamp. Mirrors `interval '150 seconds'` in
 * the migration. One missed heartbeat (a dropped request) is tolerated; a process
 * that dies mid-song stops showing within this window.
 */
export const LISTENING_LIVE_WINDOW_MS = 150_000;

/** What the listener is playing right now, or null when nothing is playing. */
export type ListeningTrack = {
  postId: string;
  title: string;
  artistName: string;
};

/** The fields of a now-playing item that decide what is published. */
export type PublishableTrack = {
  postId: string;
  kind: 'upload' | 'repost';
  originalPostId: string | null;
  title: string;
  artistName: string;
};

/**
 * What to publish for this now-playing item. A REPOST is published as its ORIGINAL
 * upload: reposts are visible only to the reposter's friends, and the viewer of this
 * status is the LISTENER's friend — usually not the reposter's. Publishing the repost
 * made "Listen" fail with "no longer available" for a public song, and named a repost
 * the viewer may not see. An orphaned repost (original deleted) falls back to itself.
 *
 * Shared by ListeningStatusReporter (foreground, via React) and GlobalAudioPlayer's
 * native-event handlers (background) so the two can never publish different things.
 */
export function listeningTrackFor(item: PublishableTrack): ListeningTrack {
  return {
    postId: item.kind === 'repost' && item.originalPostId ? item.originalPostId : item.postId,
    title: item.title,
    artistName: item.artistName,
  };
}

/** What this device last successfully told the server. */
export type ReportedListening = {
  postId: string | null;
  playing: boolean;
  lastWriteMs: number;
};

export type ListeningWrite =
  | { kind: 'none' }
  /** Upsert `playing = true` with this track (a new play, or a track change). */
  | { kind: 'start'; track: ListeningTrack }
  /** Re-stamp the same track so it stays live. */
  | { kind: 'beat'; track: ListeningTrack }
  /** Set `playing = false`. */
  | { kind: 'stop' };

/**
 * Decide the next write.
 *
 * `desired` is what should be showing (null = nothing). `reported` is what the server
 * was last told (null = nothing written this session). `shareAllowed` is the
 * listener's "Show what I'm listening to" switch — when it is off, the only permitted write is
 * the `stop` that takes down a status that was already up.
 */
export function planListeningWrite(
  desired: ListeningTrack | null,
  reported: ReportedListening | null,
  nowMs: number,
  shareAllowed: boolean,
): ListeningWrite {
  const wasPlaying = reported?.playing === true;
  if (!desired || !shareAllowed) {
    return wasPlaying ? { kind: 'stop' } : { kind: 'none' };
  }
  if (!wasPlaying || reported!.postId !== desired.postId) {
    return { kind: 'start', track: desired };
  }
  if (nowMs - reported!.lastWriteMs >= LISTENING_HEARTBEAT_MS) {
    return { kind: 'beat', track: desired };
  }
  return { kind: 'none' };
}
