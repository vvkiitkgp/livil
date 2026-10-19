/**
 * Which liker the "Liked by **name**" line names, from the newest likers the server sent.
 *
 * The line fetches as soon as the heart changes — optimistically, BEFORE the like or unlike
 * has reached the server. So right after an unlike the newest row can still be the viewer,
 * and the line said "Liked by you" under an empty heart (owner, 2026-10-19). The heart is
 * the truth for the viewer's own like: when it is off, the viewer's row is skipped.
 *
 * When the heart is on but the server has not caught up, the newest row is someone else —
 * naming them is still true, so it is left alone.
 */
export function likerToName<T extends { userId: string }>(
  newest: readonly T[],
  viewerId: string,
  viewerHasLiked: boolean,
): T | null {
  if (viewerHasLiked || !viewerId) { return newest[0] ?? null; }
  return newest.find(row => row.userId !== viewerId) ?? null;
}
