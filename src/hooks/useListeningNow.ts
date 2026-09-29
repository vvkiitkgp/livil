import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  extendListening,
  fetchListeningNow,
  subscribeListeningChanges,
  type ListeningNow,
} from '../services/listeningStatus';

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
 */
export function useListeningNow(userIds: string[]): Map<string, ListeningNow> {
  // A stable key, so a new array with the same ids does not resubscribe.
  const key = useMemo(() => [...new Set(userIds)].sort().join(','), [userIds]);
  const [map, setMap] = useState<Map<string, ListeningNow>>(() => new Map());
  // Read by the realtime handler, which is created once per subscription.
  const mapRef = useRef(map);
  mapRef.current = map;

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
      unsubscribe();
      appSub.remove();
    };
  }, [key]);

  // Drop entries as they expire. One timer, for the soonest expiry.
  useEffect(() => {
    if (map.size === 0) { return; }
    const soonest = Math.min(...[...map.values()].map(e => e.expiresAtMs));
    const t = setTimeout(() => {
      const now = Date.now();
      setMap(prev => {
        const next = new Map([...prev].filter(([, e]) => e.expiresAtMs > now));
        return next.size === prev.size ? prev : next;
      });
    }, Math.max(0, soonest - Date.now()) + 250);
    return () => clearTimeout(t);
  }, [map]);

  return map;
}
