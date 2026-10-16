import { useCallback, useEffect, useRef } from 'react';
import type { ProfileTab } from '../components/ProfileTabBar';
import type { FeedPost } from '../services/posts';
import type { AlbumSummary } from '../services/albums';
import type { UserPlaylist } from '../services/playlists';

export type TabSnapshot = {
  posts: FeedPost[];
  albums: AlbumSummary[];
  playlists: UserPlaylist[];
  endReached: boolean;
};

/**
 * What each profile tab has loaded, kept while the profile is open.
 *
 * A tab used to be fetched again on every switch — profile, counts and all its posts —
 * so going Reposts → Uploads → Reposts loaded Reposts twice. Now a tab loads the first
 * time it is opened, then switching back shows what it had (pages already scrolled in
 * included); a pull to refresh is what fetches again (`clear`).
 *
 * Loads are generation-checked: a tab switch or a refresh starts a new generation
 * (`beginLoad`), and a load from an older one must drop its results — otherwise a slow
 * Reposts load landing after a switch to a remembered Uploads would show reposts under
 * Uploads (and be remembered as Uploads). A next-page load checks without starting one
 * (`current`).
 *
 * A tab is remembered only once it has settled: not while loading, and not after a failed
 * load, so a failure is retried on the next visit rather than remembered as empty.
 */
export function useProfileTabCache(
  tab: ProfileTab,
  snapshot: TabSnapshot,
  settled: boolean,
) {
  const cache = useRef<Partial<Record<ProfileTab, TabSnapshot>>>({});
  const generation = useRef(0);
  const { posts, albums, playlists, endReached } = snapshot;

  useEffect(() => {
    if (!settled) { return; }
    cache.current[tab] = { posts, albums, playlists, endReached };
  }, [tab, posts, albums, playlists, endReached, settled]);

  const remembered = useCallback((t: ProfileTab): TabSnapshot | undefined => cache.current[t], []);

  const clear = useCallback(() => { cache.current = {}; }, []);

  /** Starts a new generation; the returned check is false once another one starts. */
  const beginLoad = useCallback(() => {
    const mine = ++generation.current;
    return () => mine === generation.current;
  }, []);

  /** A check for the current generation, without starting one (next-page loads). */
  const current = useCallback(() => {
    const mine = generation.current;
    return () => mine === generation.current;
  }, []);

  return { remembered, clear, beginLoad, current };
}
