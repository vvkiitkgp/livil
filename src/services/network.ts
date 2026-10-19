import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

/** The two fields of NetInfo's state this app reads. */
export type NetworkState = {
  isConnected: boolean | null;
  isInternetReachable?: boolean | null;
};

type NetInfoModule = {
  configure: (config: { reachabilityShouldRun: () => boolean }) => void;
  addEventListener: (listener: (state: NetworkState) => void) => () => void;
};

let netInfo: NetInfoModule | null | undefined;

/**
 * NetInfo, or null on a build that predates it. Its JS throws on import when the native half
 * is missing, and Metro serves new JS to an app installed before the rebuild — so it is
 * required lazily, and a missing module means "never offline", never a crash.
 *
 * `reachabilityShouldRun: false`: by default NetInfo pings clients3.google.com every 60 s on
 * iOS to tell "Wi-Fi with no internet" apart. Livil does not send traffic to Google to find
 * that out. Android answers the same question natively (the network's "validated" flag),
 * with no request at all.
 */
function loadNetInfo(): NetInfoModule | null {
  if (netInfo !== undefined) { return netInfo; }
  try {
    const mod = require('@react-native-community/netinfo').default as NetInfoModule;
    mod.configure({ reachabilityShouldRun: () => false });
    netInfo = mod;
  } catch {
    netInfo = null;
  }
  return netInfo;
}

/**
 * Offline = no network at all (airplane mode, no signal, Wi-Fi off), or — Android only — a
 * network the phone itself says has no internet. iOS's `isInternetReachable` is not used:
 * with the Google ping off, NetInfo reports it as `false` even when online.
 * `null` (not known yet) is online, so a slow first answer never flashes the banner.
 */
export function isOfflineState(state: NetworkState, os: string = Platform.OS): boolean {
  if (state.isConnected === false) { return true; }
  return os === 'android' && state.isInternetReachable === false;
}

/** Calls `listener` with true/false on every change, starting with the current state. */
export function subscribeToOffline(listener: (offline: boolean) => void): () => void {
  const mod = loadNetInfo();
  if (!mod) { return () => {}; }
  let last: boolean | null = null;
  return mod.addEventListener(state => {
    const offline = isOfflineState(state);
    if (offline === last) { return; }
    last = offline;
    listener(offline);
  });
}

/** Whether the phone is offline right now. */
export function useIsOffline(): boolean {
  const [offline, setOffline] = useState(false);
  useEffect(() => subscribeToOffline(setOffline), []);
  return offline;
}

/** Runs `onReconnect` each time the phone comes back online — not on the first answer. */
export function useOnReconnect(onReconnect: () => void): void {
  const cb = useRef(onReconnect);
  cb.current = onReconnect;
  useEffect(() => {
    let wasOffline = false;
    return subscribeToOffline(offline => {
      if (wasOffline && !offline) { cb.current(); }
      wasOffline = offline;
    });
  }, []);
}

/**
 * Whether `url` answers at all right now — ANY HTTP response counts, a 401 included; only a
 * failed connection or the timeout is "no". For "Try again" on the offline screen, so a phone
 * that wrongly thinks it is offline (Android marks some working networks "no internet") is
 * never locked out.
 */
export async function canReach(url: string, timeoutMs = 5000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, { method: 'HEAD', cache: 'no-store', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
