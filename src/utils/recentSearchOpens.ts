/**
 * Songs and albums recently opened from Search, shown under "Recent" on the empty screen.
 *
 * Stored as `{ kind, id }` — POST ids for songs, album ids for albums — never as snapshots.
 * A snapshot would keep showing something after it was deleted, taken down or its uploader
 * blocked, and would carry media URLs that go stale. The ids are re-read every time, so
 * whatever the viewer can no longer see simply drops out.
 *
 * Same rules as the recent-search terms: newest first, a repeat moves to the top rather than
 * appearing twice, capped (songs and albums share the cap), and a bad storage read degrades
 * to a shorter list.
 */

export type RecentSearchOpen = { kind: 'track' | 'album'; id: string };

/** Five, songs and albums together: enough to find yesterday's, short enough to leave room. */
export const MAX_RECENT_SEARCH_OPENS = 5;

const same = (a: RecentSearchOpen, b: RecentSearchOpen) => a.kind === b.kind && a.id === b.id;

export function addRecentSearchOpen(
  existing: readonly RecentSearchOpen[],
  item: RecentSearchOpen,
): RecentSearchOpen[] {
  if (!item.id) return [...existing];
  return [item, ...existing.filter(e => !same(e, item))].slice(0, MAX_RECENT_SEARCH_OPENS);
}

/**
 * Clean a list read from storage. Accepts bare strings too: the songs-only build stored post
 * ids as plain strings (`@livil:recentSearchTracks:v1`), and those are read as songs so the
 * upgrade keeps them.
 */
export function normalizeRecentSearchOpens(value: unknown): RecentSearchOpen[] {
  if (!Array.isArray(value)) return [];
  const out: RecentSearchOpen[] = [];
  for (const raw of value) {
    const item: RecentSearchOpen | null =
      typeof raw === 'string'
        ? (raw ? { kind: 'track', id: raw } : null)
        : raw && typeof raw === 'object'
            && (raw.kind === 'track' || raw.kind === 'album')
            && typeof raw.id === 'string' && raw.id
          ? { kind: raw.kind, id: raw.id }
          : null;
    if (!item || out.some(e => same(e, item))) continue;
    out.push(item);
    if (out.length === MAX_RECENT_SEARCH_OPENS) break;
  }
  return out;
}
