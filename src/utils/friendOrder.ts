/**
 * The share sheets' friend strip in CHAT order (owner, 2026-10-19): whoever you messaged
 * most recently first, as in the inbox. Friends with no messages yet follow, in the order
 * they came in (alphabetical, from listFriends). Only one-to-one chats count — a group's
 * last message says nothing about any single member.
 */
export function orderByRecentChat<T extends { id: string }>(
  friends: readonly T[],
  chats: readonly { kind: string; otherUserId: string | null; lastMessageAt: string | null }[],
): T[] {
  const lastAt = new Map<string, number>();
  for (const chat of chats) {
    if (chat.kind !== 'dm' || !chat.otherUserId || !chat.lastMessageAt) { continue; }
    const at = Date.parse(chat.lastMessageAt);
    if (Number.isNaN(at)) { continue; }
    lastAt.set(chat.otherUserId, Math.max(at, lastAt.get(chat.otherUserId) ?? 0));
  }
  // Array sort is stable, so friends with no chat keep their incoming order.
  return [...friends].sort((a, b) => (lastAt.get(b.id) ?? -1) - (lastAt.get(a.id) ?? -1));
}
