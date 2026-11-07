/**
 * The open chat's message list is kept NEWEST FIRST (the FlatList is inverted). New messages
 * reach it by three paths — realtime, the catch-up fetch (resume, or a push for the open
 * chat), and a send's own reply — and they do not arrive in server order: a catch-up or a slow
 * send can deliver an OLDER message after newer ones are already on screen. Putting each one
 * on top jumbled the chat until it was reopened (Android, 2026-11-03). These helpers place
 * them by server time instead.
 */

type Ordered = { id: string; createdAt: string };

/** An unsent placeholder (`opt-<time>`): the newest by definition, so it stays on top. */
const isPending = (m: Ordered) => m.id.startsWith('opt-');

const timeOf = (m: Ordered) => {
  const t = Date.parse(m.createdAt);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
};

/**
 * `incoming` added to `prev` in server order. Ids already on screen are skipped; nothing
 * new → the same array (no re-render).
 */
export function mergeNewestFirst<T extends Ordered>(prev: T[], incoming: T[]): T[] {
  const known = new Set(prev.map(m => m.id));
  const fresh = incoming.filter(m => !known.has(m.id) && !isPending(m));
  if (fresh.length === 0) { return prev; }
  const pending = prev.filter(isPending);
  const sent = [...prev.filter(m => !isPending(m)), ...fresh];
  // Stable: messages with the same time keep the order they already had.
  sent.sort((a, b) => timeOf(b) - timeOf(a));
  return [...pending, ...sent];
}

/**
 * A send came back: its placeholder gives way to the real message, placed by server time —
 * or simply goes, when a catch-up already brought the real one in (it would show twice).
 */
export function settlePending<T extends Ordered>(prev: T[], pendingId: string, real: T): T[] {
  return mergeNewestFirst(prev.filter(m => m.id !== pendingId), [real]);
}

/**
 * The originals to fetch for the replies in `messages`: quoted, above the loaded pages, and
 * not in `asked` already. A deleted reply draws no quote, so it needs none.
 */
export function missingReplyOriginals(
  messages: { id: string; replyToId: string | null; deletedAt: string | null }[],
  asked: ReadonlySet<string>,
): string[] {
  const loaded = new Set(messages.map(m => m.id));
  const missing = new Set<string>();
  for (const m of messages) {
    if (m.replyToId && !m.deletedAt && !loaded.has(m.replyToId) && !asked.has(m.replyToId)) {
      missing.add(m.replyToId);
    }
  }
  return [...missing];
}
