import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../lib/supabase';
import {
  APP_STORE_APP_URL,
  APP_STORE_URL,
  PLAY_STORE_APP_URL,
  PLAY_STORE_WEB_URL,
} from '../constants/links';
import type { PlayUpdateInfo } from '../native/playInAppUpdate';

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

// ── Google Play In-App Updates (Android only) ──────────────────────────────────
// On Android the prompt installs through Play inside the app (src/native/playInAppUpdate.ts)
// instead of sending people to the store page: the gentle prompt runs Play's "flexible"
// flow (downloads in the background while Livil keeps playing, then "Restart"), the blocking
// prompt runs the "immediate" flow (Play's full-screen updater). Whenever Play cannot do it —
// debug or sideloaded build, no Play Store, the release not yet visible to Play on this
// device — the prompt opens the store listing exactly as before. The policy row still
// decides WHETHER to prompt; Play only decides HOW the update is installed.

/** What the prompt shows. `ready` (Android): Play has downloaded the update; Restart installs it. */
export type PromptState = UpdateVerdict | { kind: 'ready'; blocking: boolean };

/** What tapping Update does. `store` is the pre-Play behaviour: open the store listing. */
export type UpdateAction = 'flexible' | 'immediate' | 'restart' | 'store';

/** Play is fetching an update this app started — Play's own notification shows the progress. */
export function isPlayDownloading(play: PlayUpdateInfo | null): boolean {
  return play?.installStatus === 'pending' || play?.installStatus === 'downloading';
}

/**
 * Pure: the policy's verdict, adjusted for what Play reports (null = Play can't be asked,
 * which leaves the verdict untouched).
 *  - An update Play has already downloaded → "Update ready — Restart", whatever the row says
 *    about nudging; it stays blocking if the row blocks this build.
 *  - A GENTLE update Play is still downloading → nothing yet. The download's completion
 *    brings up "Update ready"; asking again mid-download would offer a second download.
 */
export function promptWithPlay(verdict: UpdateVerdict, play: PlayUpdateInfo | null): PromptState {
  if (verdict.kind === 'none' || !play) {return verdict;}
  if (play.installStatus === 'downloaded') {return { kind: 'ready', blocking: verdict.kind === 'hard' };}
  if (verdict.kind === 'soft' && isPlayDownloading(play)) {return NO_UPDATE;}
  return verdict;
}

/**
 * Pure: which Play flow the Update button runs.
 *  - gentle → flexible; immediate if Play allows only that (they did tap Update); else store.
 *  - blocking → immediate, including RESUMING one left half-way (Play reports it
 *    "in_progress", and Google requires the app to resume it); else store.
 *  - a downloaded update → restart, which installs it.
 */
export function chooseUpdateAction(kind: 'soft' | 'hard', play: PlayUpdateInfo | null): UpdateAction {
  if (!play) {return 'store';}
  if (play.installStatus === 'downloaded') {return 'restart';}
  if (kind === 'hard') {
    if (play.availability === 'in_progress') {return 'immediate';}
    return play.availability === 'available' && play.immediateAllowed ? 'immediate' : 'store';
  }
  if (play.availability !== 'available') {return 'store';}
  if (play.flexibleAllowed) {return 'flexible';}
  return play.immediateAllowed ? 'immediate' : 'store';
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
