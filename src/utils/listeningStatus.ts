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
 * upload: a repost may be friends-only (the reposter's audience switch, ADR-0028), and
 * the viewer of this status is the LISTENER's friend — usually not the reposter's. Publishing the repost
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

// ── Viewer side: when to stop showing someone ───────────────────────────────

/** Extra wait after an expiry before looking, so a timer that fires on the dot still finds it gone. */
export const LISTENING_EXPIRY_GRACE_MS = 250;

/**
 * When to stop showing a listener whose row was just re-stamped, on THIS phone's clock.
 *
 * From the row's server-stamped `updated_at` when the server's clock is known here
 * (`serverNowMs`), so a heartbeat that arrives LATE — events buffered while Android froze the
 * app, delivered in a burst on return — keeps the listener up only for what is left of their
 * window, not a fresh 150 s from the moment it arrived. Never more than one window from now.
 * Without a known server clock (or a readable stamp) it is one window from now, as before:
 * this phone's own clock can be minutes off, and trusting it would hide live listeners.
 */
export function listeningExpiryAt(
  updatedAtIso: string | null | undefined,
  nowMs: number,
  serverNowMs: number | null,
): number {
  const stamped = updatedAtIso ? Date.parse(updatedAtIso) : NaN;
  if (serverNowMs === null || !Number.isFinite(stamped)) {
    return nowMs + LISTENING_LIVE_WINDOW_MS;
  }
  const leftMs = stamped + LISTENING_LIVE_WINDOW_MS - serverNowMs;
  return nowMs + Math.min(LISTENING_LIVE_WINDOW_MS, Math.max(0, leftMs));
}

/** The listeners still live at `nowMs`. The SAME map when nobody expired, so nothing re-renders. */
export function dropExpiredListeners<T extends { expiresAtMs: number }>(
  map: Map<string, T>,
  nowMs: number,
): Map<string, T> {
  const next = new Map([...map].filter(([, e]) => e.expiresAtMs > nowMs));
  return next.size === map.size ? map : next;
}

/** How long to wait before looking for expired listeners again; null when there is nobody to drop. */
export function nextListeningCheckMs<T extends { expiresAtMs: number }>(
  map: Map<string, T>,
  nowMs: number,
): number | null {
  if (map.size === 0) { return null; }
  const soonest = Math.min(...[...map.values()].map(e => e.expiresAtMs));
  return Math.max(0, soonest - nowMs) + LISTENING_EXPIRY_GRACE_MS;
}
