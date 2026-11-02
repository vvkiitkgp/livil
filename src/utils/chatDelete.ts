/**
 * The open chat's list after a delete (20261119010000). Pure, so what the chat shows after
 * "Delete for everyone", "Delete for me", a delete arriving live, or a catch-up that finds
 * one is tested in one place. Lists are newest first; an unchanged list is returned as the
 * SAME array, so nothing re-renders.
 */

type Deletable = {
  id: string;
  deletedAt: string | null;
  body: string | null;
  metadata: Record<string, unknown> | null;
  reactions: readonly unknown[];
};

/** The placeholder a deleted message becomes: no words, no attachment, no reactions. */
export function asDeleted<T extends Deletable>(msg: T, deletedAt: string): T {
  return { ...msg, deletedAt: msg.deletedAt ?? deletedAt, body: null, metadata: null, reactions: [] };
}

/** Message `id` shown as deleted. */
export function markDeletedIn<T extends Deletable>(list: T[], id: string, deletedAt: string): T[] {
  const i = list.findIndex(m => m.id === id);
  if (i < 0 || (list[i]!.deletedAt && list[i]!.body === null && list[i]!.metadata === null)) { return list; }
  const next = list.slice();
  next[i] = asDeleted(list[i]!, deletedAt);
  return next;
}

/** Message `id` gone from the list (Delete for me). */
export function withoutMessage<T extends { id: string }>(list: T[], id: string): T[] {
  return list.some(m => m.id === id) ? list.filter(m => m.id !== id) : list;
}

/**
 * A fresh page from the server, applied to what is on screen: a message it says is deleted
 * becomes the placeholder. (mergeNewestFirst only ADDS messages it has not seen, so without
 * this a catch-up would leave a deleted message's words up.)
 */
export function applyServerDeletes<T extends Deletable>(prev: T[], server: readonly T[]): T[] {
  let next = prev;
  for (const m of server) {
    if (m.deletedAt) { next = markDeletedIn(next, m.id, m.deletedAt); }
  }
  return next;
}
