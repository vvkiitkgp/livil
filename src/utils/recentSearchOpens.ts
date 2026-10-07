/**
 * Songs recently opened from Search, shown on the empty Search screen.
 *
 * Stored as POST IDS, never as post snapshots. A snapshot would keep showing a song after it
 * was deleted, taken down or its uploader blocked, and would carry media URLs that go stale.
 * The ids are re-read through `fetchPostsByIds` every time, so whatever the viewer can no
 * longer see simply drops out of the list.
 *
 * Same rules as the recent-search terms: newest first, a repeat moves to the top rather than
 * appearing twice, capped, and a bad storage read degrades to a shorter list.
 */

/** Five: enough to find the song you played yesterday, short enough to leave room below. */
export const MAX_RECENT_SEARCH_TRACKS = 5;

export function addRecentSearchTrack(existing: readonly string[], postId: string): string[] {
  if (!postId) return [...existing];
  return [postId, ...existing.filter(id => id !== postId)].slice(0, MAX_RECENT_SEARCH_TRACKS);
}

export function normalizeRecentSearchTracks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item || out.includes(item)) continue;
    out.push(item);
    if (out.length === MAX_RECENT_SEARCH_TRACKS) break;
  }
  return out;
}
