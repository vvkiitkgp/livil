/**
 * Pull-to-refresh must never put the same post first twice in a row.
 *
 * The server does re-rank on refresh (a new seed per pass), but a small feed —
 * a dozen posts, several by one friend — often draws the same post at the top
 * again, and a refresh that shows the same first card reads as "nothing
 * happened". If the new page would open with the card the user was just
 * looking at, swap it with the next one. The rest of the order is the server's.
 *
 * Client-side on purpose: it needs no change to `fetch_home_feed`, so it cannot
 * affect app versions already in the stores. The pagination cursor is computed
 * from the server's own last row before this runs, so reordering is safe.
 */
export function avoidRepeatTop<T extends { id: string }>(
  next: readonly T[],
  previousTopId: string | null | undefined,
): T[] {
  if (!previousTopId || next.length < 2 || next[0].id !== previousTopId) {
    return [...next];
  }
  return [next[1], next[0], ...next.slice(2)];
}
