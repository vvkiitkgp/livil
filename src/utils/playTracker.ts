import { recordPlay } from '../services/posts';
import { isStoryViewerPostId } from './storyPlayback';

/**
 * Play-count tracker.
 *
 * One "play" = 3 seconds of cumulative actual playback within a single play
 * instance. A play instance ends and restarts when:
 *   - the position jumps backward (loop, prev-button restart, manual seek
 *     to start, clip-loop wrap from end → clip start), or
 *   - the player switches to a different post.
 *
 * That model gives us:
 *   - A casual scroll-past doesn't count (no playback fires).
 *   - Looping the same song N times counts as N plays.
 *   - Pause + resume mid-song stays a single play (accumulated time keeps
 *     building once playback resumes — onProgress just doesn't fire while
 *     paused, so we naturally don't accumulate during pause).
 *   - Jam listeners count too, because their local audio engine ticks
 *     onProgress just like the host's.
 */

type Session = {
  /** Cumulative seconds of forward playback observed in this instance. */
  accumulated: number;
  /** Did we already record this instance? Prevents double-counting. */
  recorded: boolean;
  /** Last position we saw — used to detect forward vs backward motion. */
  lastPos: number;
};

const sessions = new Map<string, Session>();

const THRESHOLD_SEC = 3;
/**
 * How far backward the position has to jump for us to treat it as a new play
 * instance. Small enough to catch loop restarts; large enough not to fire on
 * onProgress's natural micro-jitter (~0.1–0.3 s between frames).
 */
const BACKWARD_DELTA_SEC = 0.5;

/**
 * Call on every audio onProgress with the current playback position (seconds).
 * Idempotent — safe to fire many times per second.
 */
export function trackPlayProgress(postId: string, positionSec: number): void {
  // Synthetic playback ids (the story viewer's `story_viewer_<uuid>`) are not
  // real `posts` rows. Recording a play for one fires `activity_record_play`
  // with a non-uuid → the cast fails every time (swallowed, but a doomed
  // round-trip + an error log per story). Skip tracking for them entirely.
  if (isStoryViewerPostId(postId)) { return; }

  let s = sessions.get(postId);
  if (!s) {
    s = { accumulated: 0, recorded: false, lastPos: positionSec };
    sessions.set(postId, s);
    return;
  }

  if (positionSec < s.lastPos - BACKWARD_DELTA_SEC) {
    // Backward seek / clip-loop wrap / replay-from-start → new play instance.
    s.accumulated = 0;
    s.recorded = false;
  } else if (positionSec > s.lastPos) {
    s.accumulated += positionSec - s.lastPos;
  }
  s.lastPos = positionSec;

  if (!s.recorded && s.accumulated >= THRESHOLD_SEC) {
    s.recorded = true;
    recordPlay(postId).catch(() => {
      // best-effort; a missed record is fine and we don't want to spam toasts
    });
  }
}

/**
 * Reset tracking for a post — useful when we know a fresh play instance is
 * about to start (track change, queue advance). Not strictly required because
 * `trackPlayProgress` self-resets on backward jumps, but useful when the
 * caller has explicit knowledge.
 */
export function resetPlayTracking(postId: string): void {
  sessions.delete(postId);
}

export function clearAllPlayTracking(): void {
  sessions.clear();
}
