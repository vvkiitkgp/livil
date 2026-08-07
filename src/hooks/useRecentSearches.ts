/**
 * Recent searches, persisted on the device.
 *
 * ON THE DEVICE, not in the database. What somebody searches for is a record of what they
 * were curious about, and there is no feature here that needs the server to know it —
 * shipping it to Postgres would be collecting something for no stated purpose, which is the
 * kind of thing that is easy to add and impossible to un-collect. It lives in AsyncStorage,
 * so uninstalling the app takes it with it.
 *
 * (Search ANALYTICS — most-searched songs — is a separate, aggregate question and belongs in
 * its own design, not smuggled in here.)
 *
 * Every storage call is fail-safe. A read that throws yields an empty list and a write that
 * throws is dropped: this is a convenience list, and nothing about it is worth an error in
 * front of somebody who is trying to search.
 */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  addRecentSearch,
  removeRecentSearch,
  normalizeRecentSearches,
} from '../utils/recentSearches';

const STORAGE_KEY = 'livil:recentSearches:v1';

export function useRecentSearches() {
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then(raw => {
        if (cancelled || !raw) { return; }
        // `normalizeRecentSearches` handles anything JSON.parse produces, including the
        // shapes an older build might have written.
        setRecents(normalizeRecentSearches(JSON.parse(raw)));
      })
      .catch(() => {
        /* no history is a fine state to start in */
      });
    return () => { cancelled = true; };
  }, []);

  /**
   * Write through: state first, storage after.
   *
   * The list has to feel instant — deleting an entry should not wait on a disk round trip —
   * and if the write fails the only cost is that the change does not survive a restart.
   */
  const persist = useCallback((next: string[]) => {
    setRecents(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {
      /* best-effort; the in-memory list is already correct for this session */
    });
  }, []);

  const remember = useCallback(
    (term: string) => {
      // Computed from the latest state rather than the closed-over value, so two searches in
      // quick succession cannot drop one.
      setRecents(current => {
        const next = addRecentSearch(current, term);
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    },
    [],
  );

  const forget = useCallback(
    (term: string) => {
      setRecents(current => {
        const next = removeRecentSearch(current, term);
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    },
    [],
  );

  return { recents, remember, forget, persist };
}
