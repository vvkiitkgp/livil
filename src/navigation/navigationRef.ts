import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

let pendingNavigation: { route: keyof RootStackParamList; params?: object } | null = null;

export function navigateWhenReady(route: keyof RootStackParamList, params?: object): void {
  if (navigationRef.isReady()) {
    (navigationRef.navigate as (r: keyof RootStackParamList, p?: object) => void)(route, params);
  } else {
    pendingNavigation = { route, params };
  }
}

export function flushPendingNavigation(): void {
  if (pendingNavigation && navigationRef.isReady()) {
    const { route, params } = pendingNavigation;
    pendingNavigation = null;
    (navigationRef.navigate as (r: keyof RootStackParamList, p?: object) => void)(route, params);
  }
}

let currentRoute: { name: string; params?: Record<string, unknown> } = { name: '' };

export function setCurrentRoute(route: { name: string; params?: Record<string, unknown> }): void {
  currentRoute = route;
}

export function getCurrentRoute(): { name: string; params?: Record<string, unknown> } {
  return currentRoute;
}
