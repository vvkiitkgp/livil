import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../lib/supabase';
import { fetchNewestUploadAt } from '../services/posts';

/**
 * When the viewer last saw New on Livil, per account: the created_at of the newest upload
 * there was at that moment — server time on both sides of the comparison, so a wrong phone
 * clock can neither hide nor re-light the dot. Device-local on purpose: it only decides a dot.
 */
export const newOnLivilSeenKey = (uid: string) => `livil.home.newOnLivilSeenAt.${uid}`;
/** With no visit recorded yet, uploads from the last week light the dot. */
const FIRST_LOOK_MS = 7 * 24 * 60 * 60 * 1000;

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/**
 * The dot on Home's New on Livil pill: lit when there is an upload newer than the viewer's
 * New on Livil list — the list reloads only on a pull-to-refresh (owner decision), so the
 * marker moves only when it does (`markSeen`, called by Home on a pull or a first load),
 * never just because the tab was opened. Re-checked when Home gains focus and when the app
 * returns to the foreground. The pill itself hides the dot while its tab is open.
 *
 * Every failure leaves the dot as it was: a missing dot is the safe mistake.
 */
export function useNewOnLivilDot() {
  const [newDot, setNewDot] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const uid = await currentUserId();
      if (!uid) { return; }
      const newest = await fetchNewestUploadAt(uid);
      if (!newest) {
        setNewDot(false);
        return;
      }
      let seenAt: string | null = null;
      try { seenAt = await AsyncStorage.getItem(newOnLivilSeenKey(uid)); } catch { /* treat as never */ }
      setNewDot(Date.parse(newest) > (seenAt ? Date.parse(seenAt) : Date.now() - FIRST_LOOK_MS));
    } catch {
      // ignore — the dot stays as it is
    }
  }, []);

  const markSeen = useCallback(() => {
    setNewDot(false);
    void (async () => {
      try {
        const uid = await currentUserId();
        if (!uid) { return; }
        // Asked afresh: the list being (re)loaded now includes everything up to now.
        const newest = await fetchNewestUploadAt(uid);
        if (!newest) { return; }
        await AsyncStorage.setItem(newOnLivilSeenKey(uid), newest);
      } catch {
        // ignore — at worst the dot shows once more
      }
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') { void refresh(); }
    });
    return () => sub.remove();
  }, [refresh]);

  return { newDot, refresh, markSeen };
}
