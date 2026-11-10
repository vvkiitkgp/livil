import { useSyncExternalStore } from 'react';
import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

let pendingNavigation: { route: keyof RootStackParamList; params?: object } | null = null;

type Navigate = (r: keyof RootStackParamList, p?: object, o?: { pop: boolean }) => void;

/**
 * `navigate` adds a NEW screen unless the target is the one showing. A second `App` would be a
 * second copy of every tab (two Home feeds, two badge counters), so a push tapped from inside a
 * chat goes back to the `App` that exists instead.
 */
function go(route: keyof RootStackParamList, params?: object): void {
  (navigationRef.navigate as Navigate)(route, params, route === 'App' ? { pop: true } : undefined);
}

export function navigateWhenReady(route: keyof RootStackParamList, params?: object): void {
  if (navigationRef.isReady()) {
    go(route, params);
  } else {
    pendingNavigation = { route, params };
  }
}

export function flushPendingNavigation(): void {
  if (pendingNavigation && navigationRef.isReady()) {
    const { route, params } = pendingNavigation;
    pendingNavigation = null;
    go(route, params);
  }
}

let currentRoute: { name: string; params?: Record<string, unknown> } = { name: '' };
const routeListeners = new Set<() => void>();

export function setCurrentRoute(route: { name: string; params?: Record<string, unknown> }): void {
  currentRoute = route;
  routeListeners.forEach(l => l());
}

export function getCurrentRoute(): { name: string; params?: Record<string, unknown> } {
  return currentRoute;
}

function subscribeCurrentRoute(listener: () => void): () => void {
  routeListeners.add(listener);
  return () => { routeListeners.delete(listener); };
}
const currentRouteName = () => currentRoute.name;

/** The root stack's top screen name, re-rendering the caller when it changes. '' before the first screen. */
export function useCurrentRouteName(): string {
  return useSyncExternalStore(subscribeCurrentRoute, currentRouteName, currentRouteName);
}
