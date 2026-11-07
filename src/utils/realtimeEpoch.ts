import { useSyncExternalStore } from 'react';

/**
 * How many times RealtimeConnectionGate has reopened the realtime socket it closed (iOS only).
 *
 * Closing it wipes every channel's listeners and reopening brings none back, so a subscriber
 * still mounted when the user returns stays dead until its effect runs again: the socket says
 * "open", the channel says "closed", and nothing arrives. See kb/architecture/realtime.md.
 *
 * Anything that stays mounted across an app switch (a tab, a context) puts this in its effect's
 * dependencies and in its channel's topic. The topic matters: `supabase.channel()` hands back an
 * existing channel with the same topic, so one still leaving would swallow the new subscription.
 */
let epoch = 0;
const listeners = new Set<() => void>();

export function bumpRealtimeEpoch(): void {
  epoch += 1;
  listeners.forEach(listener => listener());
}

export function getRealtimeEpoch(): number {
  return epoch;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useRealtimeEpoch(): number {
  return useSyncExternalStore(subscribe, getRealtimeEpoch);
}
