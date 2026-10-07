/**
 * Songs and albums recently opened from Search, persisted on the device.
 *
 * On the device for the same reason as `useRecentSearches`: nothing needs the server to know
 * it. (`search_result_taps` is write-only from every client by design, so the server copy
 * could not be read back here anyway without weakening that.)
 *
 * Fail-safe like its sibling: a failed read is an empty list, a failed write is dropped.
 */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  addRecentSearchOpen,
  normalizeRecentSearchOpens,
  type RecentSearchOpen,
} from '../utils/recentSearchOpens';

// '@livil:' prefix: messageCache.clearAll() wipes exactly that prefix on sign-out, so the
// next account on a shared phone does not inherit this one's listening history.
const STORAGE_KEY = '@livil:recentSearchOpens:v1';
/** The songs-only list from the previous build (bare post ids), carried over once. */
const LEGACY_KEY = '@livil:recentSearchTracks:v1';

export function useRecentSearchOpens() {
  const [recentOpens, setRecentOpens] = useState<RecentSearchOpen[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          if (!cancelled) { setRecentOpens(normalizeRecentSearchOpens(JSON.parse(raw))); }
          return;
        }
        const legacy = await AsyncStorage.getItem(LEGACY_KEY);
        if (!legacy) { return; }
        const carried = normalizeRecentSearchOpens(JSON.parse(legacy));
        if (!cancelled) { setRecentOpens(carried); }
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(carried));
        await AsyncStorage.removeItem(LEGACY_KEY);
      } catch {
        /* no history is a fine state to start in */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const rememberOpen = useCallback((item: RecentSearchOpen) => {
    setRecentOpens(current => {
      const next = addRecentSearchOpen(current, item);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  return { recentOpens, rememberOpen };
}
