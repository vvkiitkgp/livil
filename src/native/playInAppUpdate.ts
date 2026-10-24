import { NativeEventEmitter, NativeModules, Platform, type NativeModule } from 'react-native';

/**
 * Google Play In-App Updates — the JS side of InAppUpdateModule.kt. ANDROID ONLY.
 *
 * Every function here is fail-safe: on iOS, on a build without the native module, or when
 * Play cannot be asked (debug / sideloaded build, no Play Store, Play's API errors), it
 * answers "nothing" instead of throwing, and the update prompt falls back to opening the
 * Play Store listing. Which flow to run is decided in src/services/appUpdate.ts.
 */

export type PlayAvailability = 'available' | 'not_available' | 'in_progress' | 'unknown';

export type PlayInstallStatus =
  | 'pending'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'installed'
  | 'failed'
  | 'canceled'
  | 'unknown';

export type PlayUpdateInfo = {
  availability: PlayAvailability;
  installStatus: PlayInstallStatus;
  flexibleAllowed: boolean;
  immediateAllowed: boolean;
  availableVersionCode: number;
};

export type PlayFlow = 'flexible' | 'immediate';

/** What the person did with Play's update UI; `unavailable` = Play would not show it. */
export type PlayFlowResult = 'accepted' | 'cancelled' | 'failed' | 'unavailable';

/** Must match InAppUpdateModule.STATE_EVENT. */
const STATE_EVENT = 'LivilInAppUpdateState';

type NativeInAppUpdate = NativeModule & {
  check(): Promise<PlayUpdateInfo>;
  start(mode: PlayFlow): Promise<PlayFlowResult>;
  completeUpdate(): Promise<null>;
};

function nativeModule(): NativeInAppUpdate | null {
  if (Platform.OS !== 'android') {return null;}
  return (NativeModules.LivilInAppUpdate as NativeInAppUpdate | undefined) ?? null;
}

/** What Play knows about an update for this install, or null when it cannot be asked. */
export async function checkPlayUpdate(): Promise<PlayUpdateInfo | null> {
  const native = nativeModule();
  if (!native) {return null;}
  try {
    return await native.check();
  } catch {
    return null;
  }
}

/** Shows Play's flexible or immediate update UI. A rejection from Play reads as `failed`. */
export async function startPlayUpdate(flow: PlayFlow): Promise<PlayFlowResult> {
  const native = nativeModule();
  if (!native) {return 'unavailable';}
  try {
    return await native.start(flow);
  } catch {
    return 'failed';
  }
}

/**
 * Installs a downloaded flexible update: Play takes over the screen and restarts the app,
 * so a successful call usually never returns. Resolves false if Play refused.
 */
export async function completePlayUpdate(): Promise<boolean> {
  const native = nativeModule();
  if (!native) {return false;}
  try {
    await native.completeUpdate();
    return true;
  } catch {
    return false;
  }
}

/**
 * Follows a background (flexible) download. Native only listens to Play while at least one
 * subscription is open, so unsubscribe once the download has finished or failed.
 */
export function subscribePlayInstallState(
  onStatus: (status: PlayInstallStatus) => void,
): () => void {
  const native = nativeModule();
  if (!native) {return () => {};}
  const emitter = new NativeEventEmitter(native);
  const sub = emitter.addListener(
    STATE_EVENT,
    (event: { installStatus?: PlayInstallStatus }) => {
      if (event?.installStatus) {onStatus(event.installStatus);}
    },
  );
  return () => sub.remove();
}
