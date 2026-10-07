/**
 * Which chat the user is looking at right now, and a way to poke it.
 *
 * Messages reach an open chat over two independent paths: the realtime
 * channel (fast, but it drops on sleep / network change / backgrounding and
 * reconnects slowly) and the push (APNs/FCM — reliable, ~1s). The chat screen
 * used to listen to realtime only, and the push path did not know a chat was
 * open. So a dead channel meant the message never appeared in the chat while
 * its push banner did — for the very chat being read.
 *
 * Now a push for the open chat is not shown; it pings the chat instead, which
 * fetches its latest messages. The push becomes the backup for realtime.
 *
 * Plain module state, not a context: the push handler runs outside React.
 */

let activeId: string | null = null;
const pingListeners = new Map<string, Set<() => void>>();

/** Called by the chat screen on focus (id) and blur (null). */
export function setActiveConversation(conversationId: string | null): void {
  activeId = conversationId;
}

export function getActiveConversation(): string | null {
  return activeId;
}

/** Subscribe to pings for one conversation. Returns the unsubscribe function. */
export function onConversationPing(conversationId: string, listener: () => void): () => void {
  let set = pingListeners.get(conversationId);
  if (!set) {
    set = new Set();
    pingListeners.set(conversationId, set);
  }
  set.add(listener);
  return () => {
    const current = pingListeners.get(conversationId);
    if (!current) { return; }
    current.delete(listener);
    if (current.size === 0) { pingListeners.delete(conversationId); }
  };
}

/**
 * Tell a conversation's screen that something new exists server-side.
 * Returns whether anyone was listening, so the caller can fall back to
 * showing the notification after all.
 */
export function pingConversation(conversationId: string): boolean {
  const set = pingListeners.get(conversationId);
  if (!set || set.size === 0) { return false; }
  set.forEach(listener => {
    try {
      listener();
    } catch (e) {
      console.warn('[chat] conversation ping listener failed', e);
    }
  });
  return true;
}
