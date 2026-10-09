import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../lib/supabase';
import {
  APP_STORE_APP_URL,
  APP_STORE_URL,
  PLAY_STORE_APP_URL,
  PLAY_STORE_WEB_URL,
} from '../constants/links';

/**
 * The app-update prompt's rules (migration 20261018000000_app_update_policy.sql).
 *
 * One row per platform says which builds are nudged (below `latestBuild`) and which are
 * blocked (below `minimumBuild`). Everything here is FAIL-OPEN: any failure to read the
 * policy means "no prompt". A missing nudge costs nothing; a spurious blocking screen
 * would lock people out of an app that works.
 */
export type UpdatePolicy = {
  latestBuild: number;
  minimumBuild: number;
  /** Replaces the default body text when set. */
  message: string | null;
};

export type UpdateVerdict =
  | { kind: 'none' }
  | { kind: 'soft'; latestBuild: number; message: string | null }
  | { kind: 'hard'; message: string | null };

export const NO_UPDATE: UpdateVerdict = { kind: 'none' };

/** Pure: what this build should be told, given its platform's policy. */
export function decideUpdate(policy: UpdatePolicy | null, build: number): UpdateVerdict {
  if (!policy) {return NO_UPDATE;}
  if (build < policy.minimumBuild) {return { kind: 'hard', message: policy.message };}
  if (build < policy.latestBuild) {
    return { kind: 'soft', latestBuild: policy.latestBuild, message: policy.message };
  }
  return NO_UPDATE;
}

/** This platform's policy row, or null on ANY failure (no row, no table, offline). Never throws. */
export async function fetchUpdatePolicy(platform: string = Platform.OS): Promise<UpdatePolicy | null> {
  if (platform !== 'ios' && platform !== 'android') {return null;}
  try {
    const { data, error } = await supabase
      .from('app_update_policy')
      .select('latest_build, minimum_build, message')
      .eq('platform', platform)
      .maybeSingle();
    if (error || !data) {return null;}
    return {
      latestBuild: data.latest_build,
      minimumBuild: data.minimum_build,
      message: data.message?.trim() || null,
    };
  } catch {
    return null;
  }
}

// ── "Later" ─────────────────────────────────────────────────────────────────
// Snoozes the gentle prompt for SNOOZE_MS, for THAT build only: a newer release asks
// again straight away. Per device (AsyncStorage) — losing it costs one extra prompt.

export const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const SNOOZE_KEY = 'livil.update.snooze.v1';

export async function isUpdateSnoozed(latestBuild: number, now: number = Date.now()): Promise<boolean> {
  const raw = await AsyncStorage.getItem(SNOOZE_KEY).catch(() => null);
  if (!raw) {return false;}
  try {
    const saved = JSON.parse(raw) as { build?: unknown; until?: unknown };
    return saved.build === latestBuild && typeof saved.until === 'number' && now < saved.until;
  } catch {
    return false;
  }
}

export function snoozeUpdate(latestBuild: number, now: number = Date.now()): void {
  AsyncStorage.setItem(SNOOZE_KEY, JSON.stringify({ build: latestBuild, until: now + SNOOZE_MS }))
    .catch(() => {});
}

/** Livil's store page in the store APP first, then on the web. Each platform only ever gets its own store. */
export function storeUrls(platform: string = Platform.OS): { primary: string; fallback: string } {
  return platform === 'ios'
    ? { primary: APP_STORE_APP_URL, fallback: APP_STORE_URL }
    : { primary: PLAY_STORE_APP_URL, fallback: PLAY_STORE_WEB_URL };
}
