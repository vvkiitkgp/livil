/**
 * Where the Livil bot (ActivityCenterScreen) opens, and where its "Seen" label goes.
 *
 * The bot is drawn like a chat: newest at the bottom, in an INVERTED list whose data is
 * newest first (the order activity_list returns, `updated_at desc`). Like a person's chat,
 * it opens at what you have not seen yet — the oldest notification that arrived since your
 * last visit — and marks the line with "Seen" under the newest one you had already read.
 *
 * The read state is captured ONCE, from the first page this visit loads, before the screen
 * marks everything read (and before any realtime refresh returns it all read): a boundary
 * time, the `updated_at` of the newest notification that was already read. Client-only — no
 * server change.
 */

export type ReadableActivity = { isRead: boolean; updatedAt: string };

/**
 * The newest notification already read before this visit, as its `updated_at` — or null when
 * none of them was (everything here is new). Items newest first.
 */
export function readBoundaryAt(newestFirst: readonly ReadableActivity[]): string | null {
  for (const item of newestFirst) {
    if (item.isRead) { return item.updatedAt; }
  }
  return null;
}

export type ActivityOpenPoint = {
  /** Index of the row that carries "Seen": the newest read before this visit. Null: no label. */
  seenIndex: number | null;
  /** Index of the row to open at: the oldest one that is new. Null: nothing new — open at rest. */
  firstUnseenIndex: number | null;
};

/**
 * Items newest first. A notification counts as seen when it is no newer than the boundary —
 * so one that was read and has since been bumped (another like on the same post, which also
 * marks it unread) counts as new again, and the label moves under the one before it.
 */
export function activityOpenPoint(
  newestFirst: readonly ReadableActivity[],
  boundaryAt: string | null,
): ActivityOpenPoint {
  if (newestFirst.length === 0) { return { seenIndex: null, firstUnseenIndex: null }; }
  const boundary = boundaryAt ? Date.parse(boundaryAt) : NaN;
  const seen = Number.isFinite(boundary)
    ? newestFirst.findIndex(item => Date.parse(item.updatedAt) <= boundary)
    : -1;
  if (seen === -1) {
    return { seenIndex: null, firstUnseenIndex: newestFirst.length - 1 };
  }
  return { seenIndex: seen, firstUnseenIndex: seen > 0 ? seen - 1 : null };
}

/** Room left above the first new notification when the bot opens on it: the "Seen" line above shows. */
export const OPEN_ABOVE_MARGIN = 56;

/**
 * The scroll offset that opens the inverted list with row `targetIndex` near the TOP of the
 * screen (`margin` of the row above it still showing) and everything newer below it. 0 when
 * all of that already fits with the newest at rest. Null while a row up to the target has
 * not been measured yet.
 *
 * Measured from real row heights, not FlatList's estimate: scrollToIndex without
 * getItemLayout lands on an average height for rows it has not drawn, which is how the bot
 * opened mid-list (owner, 2026-11-02).
 *
 * `restPadding` is the list's inverted paddingTop (the gap under the newest row);
 * `contentHeight`, when known, keeps the offset inside the content.
 */
export function openOffsetFor(
  rowHeightsNewestFirst: ReadonlyArray<number | undefined>,
  targetIndex: number,
  restPadding: number,
  viewportHeight: number,
  margin: number = OPEN_ABOVE_MARGIN,
  contentHeight?: number,
): number | null {
  if (targetIndex < 0 || viewportHeight <= 0) { return null; }
  let farEdge = restPadding;
  for (let i = 0; i <= targetIndex; i++) {
    const h = rowHeightsNewestFirst[i];
    if (h === undefined) { return null; }
    farEdge += h;
  }
  let offset = farEdge + margin - viewportHeight;
  if (contentHeight !== undefined) {
    offset = Math.min(offset, contentHeight - viewportHeight);
  }
  return Math.max(0, Math.round(offset));
}
