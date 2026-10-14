import { useCallback, useEffect, useRef, useState } from 'react';
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
 * The dot on Home's New on Livil tab: lit when someone uploaded since the viewer last saw the
 * tab. Re-checked when Home gains focus and when the app returns to the foreground.
 *
 * While the tab itself is open, a newer upload is not a dot — it is a list that is out of
 * date — so `onNewWhileOpen` refreshes it, and only then does the marker move.
 *
 * Every failure leaves the dot as it was: a missing dot is the safe mistake.
 */
export function useNewOnLivilDot({
  isOnTab,
  onNewWhileOpen,
}: {
  isOnTab: () => boolean;
  onNewWhileOpen: () => void;
}) {
  const [newDot, setNewDot] = useState(false);
  const newDotRef = useRef(false);
  newDotRef.current = newDot;
  const newestRef = useRef<string | null>(null);
  const optsRef = useRef({ isOnTab, onNewWhileOpen });
  optsRef.current = { isOnTab, onNewWhileOpen };

  const refresh = useCallback(async () => {
    try {
      const uid = await currentUserId();
      if (!uid) { return; }
      const newest = await fetchNewestUploadAt(uid);
      newestRef.current = newest;
      if (!newest) {
        setNewDot(false);
        return;
      }
      let seenAt: string | null = null;
      try { seenAt = await AsyncStorage.getItem(newOnLivilSeenKey(uid)); } catch { /* treat as never */ }
      const isNew = Date.parse(newest) > (seenAt ? Date.parse(seenAt) : Date.now() - FIRST_LOOK_MS);
      if (optsRef.current.isOnTab()) {
        if (isNew) { optsRef.current.onNewWhileOpen(); }
        setNewDot(false);
        try { await AsyncStorage.setItem(newOnLivilSeenKey(uid), newest); } catch { /* ignore */ }
        return;
      }
      setNewDot(isNew);
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
        const newest = newestRef.current ?? await fetchNewestUploadAt(uid);
        if (!newest) { return; }
        newestRef.current = newest;
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

  return { newDot, newDotRef, refresh, markSeen };
}
