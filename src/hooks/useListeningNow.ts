import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  extendListening,
  fetchListeningNow,
  subscribeListeningChanges,
  type ListeningNow,
} from '../services/listeningStatus';
import { dropExpiredListeners, nextListeningCheckMs } from '../utils/listeningStatus';

/**
 * Who among `userIds` is playing music in Livil right now, and what — kept live.
 *
 * Only LIVE listeners are in the map; a pause removes the entry within a second
 * (realtime), and a listener whose device stopped checking in drops out when their
 * `expiresAtMs` passes. Whether they have the app open is never considered.
 *
 * Cost discipline: the listener re-stamps their row once a minute, and every re-stamp
 * reaches every subscriber. Those are applied LOCALLY (extend the expiry) — the RPC is
 * called again only when a listener starts or changes track, because that is the only
 * time there is anything new to fetch (the cover art).
 *
 * `refreshToken`: a value that changes when the caller wants the list re-read from the
 * server — a screen that stays mounted passes one that changes on every focus. The chat list
 * never unmounts, so without it a listener whose phone died (a killed app never writes
 * "stopped") stayed on the list on nothing but this phone's timer, while opening the chat —
 * which reads afresh on mount — correctly showed nothing (owner, 2026-11-02).
 */
export function useListeningNow(userIds: string[], refreshToken?: unknown): Map<string, ListeningNow> {
  // A stable key, so a new array with the same ids does not resubscribe.
  const key = useMemo(() => [...new Set(userIds)].sort().join(','), [userIds]);
  const [map, setMap] = useState<Map<string, ListeningNow>>(() => new Map());
  // Read by the realtime handler, which is created once per subscription.
  const mapRef = useRef(map);
  mapRef.current = map;
  // The current subscription's full re-read, for refreshToken.
  const loadAllRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    setMap(new Map());
    if (ids.length === 0) { return; }
    let alive = true;

    const merge = (userId: string, entry: ListeningNow | null) => {
      if (!alive) { return; }
      setMap(prev => {
        if (!entry && !prev.has(userId)) { return prev; }
        const next = new Map(prev);
        if (entry) { next.set(userId, entry); } else { next.delete(userId); }
        return next;
      });
    };

    const loadAll = () => {
      void fetchListeningNow(ids).then(rows => {
        if (!alive) { return; }
        setMap(new Map(rows.map(r => [r.userId, r])));
      });
    };
    loadAll();
    loadAllRef.current = loadAll;

    const unsubscribe = subscribeListeningChanges(ids, change => {
      if (!change.playing) { merge(change.userId, null); return; }
      const cur = mapRef.current.get(change.userId);
      if (cur && cur.postId === change.postId) {
        merge(change.userId, extendListening(cur, change));
        return;
      }
      // New listener or new track: fetch it (cover art, and the server's liveness).
      void fetchListeningNow([change.userId]).then(rows => merge(change.userId, rows[0] ?? null));
    });

    // Realtime events are missed while this app is in the background; catch up on return.
    const appSub = AppState.addEventListener('change', state => {
      if (state === 'active') { loadAll(); }
    });

    return () => {
      alive = false;
      loadAllRef.current = null;
      unsubscribe();
      appSub.remove();
    };
  }, [key]);

  // Re-read when the caller's token changes (not on mount: the subscription just read).
  const tokenRef = useRef(refreshToken);
  useEffect(() => {
    if (Object.is(tokenRef.current, refreshToken)) { return; }
    tokenRef.current = refreshToken;
    loadAllRef.current?.();
  }, [refreshToken]);

  // Drop entries as they expire. One timer, for the soonest expiry — and ALWAYS another
  // look after it fires. It used to re-arm only when an entry was dropped, so a timer that
  // fired a moment early (or across a clock change) dropped nothing and was never set again:
  // the listener stayed up until something else changed the list.
  const [recheck, setRecheck] = useState(0);
  useEffect(() => {
    const delay = nextListeningCheckMs(map, Date.now());
    if (delay === null) { return; }
    const t = setTimeout(() => {
      setMap(prev => dropExpiredListeners(prev, Date.now()));
      setRecheck(n => n + 1);
    }, delay);
    return () => clearTimeout(t);
  }, [map, recheck]);

  return map;
}
