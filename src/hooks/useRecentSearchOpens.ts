/**
 * Songs recently opened from Search, persisted on the device.
 *
 * On the device for the same reason as `useRecentSearches`: nothing needs the server to know
 * it. (`search_result_taps` is write-only from every client by design, so the server copy
 * could not be read back here anyway without weakening that.)
 *
 * Fail-safe like its sibling: a failed read is an empty list, a failed write is dropped.
 */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { addRecentSearchTrack, normalizeRecentSearchTracks } from '../utils/recentSearchTracks';

// '@livil:' prefix: messageCache.clearAll() wipes exactly that prefix on sign-out, so the
// next account on a shared phone does not inherit this one's listening history.
const STORAGE_KEY = '@livil:recentSearchTracks:v1';

export function useRecentSearchTracks() {
  const [recentPostIds, setRecentPostIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then(raw => {
        if (cancelled || !raw) { return; }
        setRecentPostIds(normalizeRecentSearchTracks(JSON.parse(raw)));
      })
      .catch(() => {
        /* no history is a fine state to start in */
      });
    return () => { cancelled = true; };
  }, []);

  const rememberTrack = useCallback((postId: string) => {
    setRecentPostIds(current => {
      const next = addRecentSearchTrack(current, postId);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  return { recentPostIds, rememberTrack };
}
