import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { supabase } from '../../lib/supabase';
import * as svc from '../services/relationships';

export type RelationshipStatus =
  | 'me'
  | 'friend'
  | 'star'
  | 'pending_outgoing'
  | 'pending_incoming'
  | 'none';

type Sets = {
  friends: Set<string>;
  stars: Set<string>;
  pendingOutgoing: Set<string>;
  pendingIncoming: Set<string>;
};

type RelationshipContextValue = {
  meId: string | null;
  ready: boolean;
  status: (userId: string) => RelationshipStatus;
  // Live count of incoming friend requests — used by HomeScreen's badge.
  // Updates optimistically on accept/reject and live via friendships subscription.
  pendingIncomingCount: number;
  // Mutations — optimistic, throw on RPC failure (after rollback).
  sendFriendRequest: (userId: string) => Promise<void>;
  acceptFriendRequest: (userId: string) => Promise<void>;
  rejectFriendRequest: (userId: string) => Promise<void>;
  cancelFriendRequest: (userId: string) => Promise<void>;
  removeFriend: (userId: string) => Promise<void>;
  addStar: (userId: string) => Promise<void>;
  removeStar: (userId: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const RelationshipContext = createContext<RelationshipContextValue | null>(null);

function emptySets(): Sets {
  return {
    friends: new Set(),
    stars: new Set(),
    pendingOutgoing: new Set(),
    pendingIncoming: new Set(),
  };
}

export function RelationshipProvider({ children }: { children: React.ReactNode }) {
  const [meId, setMeId] = useState<string | null>(null);
  const [sets, setSets] = useState<Sets>(emptySets);
  const [ready, setReady] = useState(false);
  const setsRef = useRef<Sets>(sets);
  setsRef.current = sets;

  const applySets = useCallback((next: Sets) => {
    setSets(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getUser();
      const me = data?.user?.id ?? null;
      setMeId(me);
      if (!me) {
        applySets(emptySets());
        setReady(true);
        return;
      }
      const r = await svc.loadViewerRelationships();
      applySets({
        friends: new Set(r.friends),
        stars: new Set(r.stars),
        pendingOutgoing: new Set(r.pendingOutgoing),
        pendingIncoming: new Set(r.pendingIncoming),
      });
    } catch {
      // Leave sets as-is; surface via individual mutation errors instead.
    } finally {
      setReady(true);
    }
  }, [applySets]);

  useEffect(() => {
    void refresh();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setMeId(null);
        applySets(emptySets());
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        void refresh();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh, applySets]);

  // Live updates: any change to the friendships table that RLS lets us see
  // (i.e. rows where we're user_a or user_b) means our sets are stale.
  // Cheapest reliable refresh is to refetch — friendships are small.
  useEffect(() => {
    if (!meId) { return; }
    const channel = supabase
      .channel(`friendships:${meId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friendships' },
        () => { void refresh(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [meId, refresh]);

  const status = useCallback(
    (userId: string): RelationshipStatus => {
      if (!userId) { return 'none'; }
      if (meId && userId === meId) { return 'me'; }
      const s = setsRef.current;
      if (s.friends.has(userId)) { return 'friend'; }
      if (s.pendingOutgoing.has(userId)) { return 'pending_outgoing'; }
      if (s.pendingIncoming.has(userId)) { return 'pending_incoming'; }
      if (s.stars.has(userId)) { return 'star'; }
      return 'none';
    },
    [meId],
  );

  const mutate = useCallback(
    async (apply: (s: Sets) => Sets, rpc: () => Promise<void>) => {
      const before = setsRef.current;
      const next = apply({
        friends: new Set(before.friends),
        stars: new Set(before.stars),
        pendingOutgoing: new Set(before.pendingOutgoing),
        pendingIncoming: new Set(before.pendingIncoming),
      });
      applySets(next);
      try {
        await rpc();
      } catch (err) {
        applySets(before);
        throw err;
      }
    },
    [applySets],
  );

  const sendFriendRequest = useCallback(
    (userId: string) =>
      mutate(
        s => {
          s.pendingOutgoing.add(userId);
          // Mutual exclusion: friend request consumes any star toward this user.
          s.stars.delete(userId);
          return s;
        },
        () => svc.sendFriendRequest(userId),
      ),
    [mutate],
  );

  const acceptFriendRequest = useCallback(
    (userId: string) =>
      mutate(
        s => {
          s.pendingIncoming.delete(userId);
          s.friends.add(userId);
          s.stars.delete(userId);
          return s;
        },
        () => svc.acceptFriendRequest(userId),
      ),
    [mutate],
  );

  const rejectFriendRequest = useCallback(
    (userId: string) =>
      mutate(
        s => {
          s.pendingIncoming.delete(userId);
          return s;
        },
        () => svc.rejectFriendRequest(userId),
      ),
    [mutate],
  );

  const cancelFriendRequest = useCallback(
    (userId: string) =>
      mutate(
        s => {
          s.pendingOutgoing.delete(userId);
          return s;
        },
        () => svc.cancelFriendRequest(userId),
      ),
    [mutate],
  );

  const removeFriend = useCallback(
    (userId: string) =>
      mutate(
        s => {
          s.friends.delete(userId);
          return s;
        },
        () => svc.removeFriend(userId),
      ),
    [mutate],
  );

  const addStar = useCallback(
    (userId: string) =>
      mutate(
        s => {
          s.stars.add(userId);
          return s;
        },
        () => svc.addStar(userId),
      ),
    [mutate],
  );

  const removeStar = useCallback(
    (userId: string) =>
      mutate(
        s => {
          s.stars.delete(userId);
          return s;
        },
        () => svc.removeStar(userId),
      ),
    [mutate],
  );

  const pendingIncomingCount = sets.pendingIncoming.size;

  const value = useMemo<RelationshipContextValue>(
    () => ({
      meId,
      ready,
      status,
      pendingIncomingCount,
      sendFriendRequest,
      acceptFriendRequest,
      rejectFriendRequest,
      cancelFriendRequest,
      removeFriend,
      addStar,
      removeStar,
      refresh,
    }),
    [
      meId,
      ready,
      status,
      pendingIncomingCount,
      sendFriendRequest,
      acceptFriendRequest,
      rejectFriendRequest,
      cancelFriendRequest,
      removeFriend,
      addStar,
      removeStar,
      refresh,
    ],
  );

  return (
    <RelationshipContext.Provider value={value}>{children}</RelationshipContext.Provider>
  );
}

export function useRelationships(): RelationshipContextValue {
  const ctx = useContext(RelationshipContext);
  if (!ctx) {
    throw new Error('useRelationships must be used inside <RelationshipProvider>');
  }
  return ctx;
}
