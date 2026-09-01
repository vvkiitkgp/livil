/**
 * Recording which feed cards have actually been in front of the viewer.
 *
 * PROP-0010 phase 1. The home feed repeated itself because nothing anywhere knew what it
 * had already shown — see `20260816000000_post_impressions.sql` for the ranking side, and
 * for why the client cannot write the table directly.
 *
 * BATCHED, AND FIRE AND FORGET. This runs while the viewer is scrolling, which is the one
 * moment on this screen where dropped frames are obvious. So:
 *   · ids buffer in memory and leave in groups, never one request per card;
 *   · nothing here is awaited by the UI, and nothing here throws. A lost batch costs a
 *     little suppression accuracy, which is worth strictly less than a stutter.
 *
 * The server rate-limits each (viewer, post) pair to one increment per 10 minutes, so a
 * double-flush is harmless by design rather than by the caller being careful.
 */
import { supabase } from '../../lib/supabase';

/** Flush once the buffer reaches a screenful-ish. */
const BATCH_SIZE = 10;
/** …or once scrolling has been quiet this long, whichever comes first. */
const IDLE_FLUSH_MS = 4000;
/** The RPC bounds its array anyway; this keeps a pathological buffer from ever forming. */
const MAX_BUFFER = 100;

const buffer = new Set<string>();
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

/**
 * Send whatever is buffered. Safe to call at any time, including when empty.
 *
 * Note the buffer is drained BEFORE the request goes out: if the write fails there is no
 * retry, deliberately. A retry queue here would mean impressions arriving minutes after the
 * card left the screen, and the whole value of this signal is that it describes a session.
 */
export function flushImpressions(): void {
  clearIdleTimer();
  if (buffer.size === 0) { return; }

  const postIds = Array.from(buffer);
  buffer.clear();

  void (async () => {
    try {
      // Cast the CLIENT, never the method — see the note in services/posts.ts. Detaching
      // rpc() from the client breaks `this` inside supabase-js and throws.
      const db = supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
      };
      await db.rpc('record_post_impressions', { p_post_ids: postIds });
    } catch {
      /* a lost batch is never worth an error in front of somebody scrolling */
    }
  })();
}

/**
 * Note that a card has been genuinely looked at. The DWELL decision — how long counts as
 * looked at — belongs to the screen, not here; this is only the buffer.
 */
export function recordImpression(postId: string): void {
  if (!postId) { return; }
  buffer.add(postId);

  if (buffer.size >= BATCH_SIZE || buffer.size >= MAX_BUFFER) {
    flushImpressions();
    return;
  }

  // Restart the idle window on every new card, so a slow scroll still flushes but a fast
  // one is a single request.
  clearIdleTimer();
  idleTimer = setTimeout(flushImpressions, IDLE_FLUSH_MS);
}

/**
 * Drop anything buffered WITHOUT sending it.
 *
 * Called on sign-out. The buffer is module-global, so ids collected under one account
 * would otherwise flush after a different account signs in on the same device — and the
 * server attributes the write to whoever is signed in at FLUSH time, not at collection
 * time. The result is impressions filed against the wrong person, for posts the new
 * account may not even be able to see. Same reasoning as the `messageCache.clearAll()`
 * already sitting in the SIGNED_OUT branch of RootNavigator.
 *
 * Discarding rather than flushing is deliberate: the previous account's session is gone,
 * so there is no longer anyone to attribute them to.
 */
export function discardImpressions(): void {
  clearIdleTimer();
  buffer.clear();
}
