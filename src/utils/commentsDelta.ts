/**
 * Comment-count changes a feed shows before the server's count catches up — the viewer's own
 * comment, a deletion, a comment arriving live while the sheet is open.
 *
 * Each change remembers the server count it was made against (`base`). Once the feed holds a
 * different count, that count is newer data from the server, which already includes the
 * change — so the change is dropped rather than added on top. Without this, a pull-to-refresh
 * counted the viewer's own comment twice, for good: 1 comment showed as 2.
 */
export type PendingCommentsDelta = {
  /** The post's count in the feed when the change was recorded; null if the post was not in
      the feed, in which case the change always applies. */
  base: number | null;
  delta: number;
};

export type PendingCommentsDeltas = Readonly<Record<string, PendingCommentsDelta>>;

/** Record a change. It accumulates only onto earlier changes made against the same count. */
export function addCommentsDelta(
  pending: PendingCommentsDeltas,
  postId: string,
  delta: number,
  base: number | null,
): PendingCommentsDeltas {
  const current = pending[postId];
  const carried = current && current.base === base ? current.delta : 0;
  return { ...pending, [postId]: { base, delta: carried + delta } };
}

/** The post as the feed should show it: its count plus any change the server has not seen. */
export function withCommentsDelta<T extends { commentsCount: number }>(
  post: T,
  pending: PendingCommentsDelta | undefined,
): T {
  if (!pending || pending.delta === 0) { return post; }
  if (pending.base !== null && pending.base !== post.commentsCount) { return post; }
  return { ...post, commentsCount: Math.max(post.commentsCount + pending.delta, 0) };
}
