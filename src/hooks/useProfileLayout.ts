import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ProfileLayout = 'list' | 'grid';

const KEY = 'livil.profile.layout.v1';

/**
 * List or grid for a profile's Reposts and Uploads tabs — one choice for every profile,
 * remembered on this phone.
 *
 * Starts as the list (what the tabs always showed) until the person picks the grid. A
 * failed read or write just means the choice is not remembered: never an error.
 */
export function useProfileLayout(): [ProfileLayout, (next: ProfileLayout) => void] {
  const [layout, setLayout] = useState<ProfileLayout>('list');

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(KEY)
      .then(saved => {
        if (!cancelled && (saved === 'list' || saved === 'grid')) { setLayout(saved); }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const choose = useCallback((next: ProfileLayout) => {
    setLayout(next);
    AsyncStorage.setItem(KEY, next).catch(() => {});
  }, []);

  return [layout, choose];
}
