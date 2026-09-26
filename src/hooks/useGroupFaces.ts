import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  cachedGroupFaces,
  fetchGroupFaces,
  rememberGroupFaces,
  subscribeGroupMessages,
  type GroupFace,
} from '../services/groupFaces';
import { bumpSender } from '../utils/groupFaces';

/**
 * The faces for each of these groups, most recent speaker first — kept live.
 *
 * A new message reorders the picture LOCALLY (bumpSender): the realtime payload says who
 * sent it, so there is nothing to fetch. Only a sender with no face yet (a 7th+ member
 * who just spoke, or someone new) triggers a refetch of that one group.
 */
export function useGroupFaces(
  conversationIds: string[],
  /** Bump to force a refetch, e.g. after adding or removing a member. */
  version = 0,
): Map<string, GroupFace[]> {
  const key = useMemo(() => [...new Set(conversationIds)].sort().join(','), [conversationIds]);
  const [faces, setFaces] = useState<Map<string, GroupFace[]>>(() => seedFromCache(conversationIds));
  const facesRef = useRef(faces);
  facesRef.current = faces;

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) { setFaces(new Map()); return; }
    let alive = true;
    setFaces(seedFromCache(ids));

    const load = (which: string[]) => {
      void fetchGroupFaces(which).then(fetched => {
        if (!alive) { return; }
        setFaces(prev => {
          const next = new Map(prev);
          for (const id of which) {
            const f = fetched.get(id);
            if (f) { next.set(id, f); } else { next.delete(id); }
          }
          return next;
        });
      });
    };
    load(ids);

    const unsubscribe = subscribeGroupMessages(ids, ({ conversationId, senderId, createdAt }) => {
      const current = facesRef.current.get(conversationId);
      if (!current) { load([conversationId]); return; }
      const next = bumpSender(current, senderId, createdAt);
      if (next === null) { load([conversationId]); return; }
      if (next === current) { return; }
      rememberGroupFaces(conversationId, next);
      setFaces(prev => new Map(prev).set(conversationId, next));
    });

    // Realtime events are missed while the app is in the background; catch up on return.
    const appSub = AppState.addEventListener('change', state => {
      if (state === 'active') { load(ids); }
    });

    return () => {
      alive = false;
      unsubscribe();
      appSub.remove();
    };
  }, [key, version]);

  return faces;
}

function seedFromCache(ids: string[]): Map<string, GroupFace[]> {
  const m = new Map<string, GroupFace[]>();
  for (const id of ids) {
    const f = cachedGroupFaces(id);
    if (f) { m.set(id, f); }
  }
  return m;
}
