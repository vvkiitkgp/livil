import {
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  getInitialNotification,
  onTokenRefresh,
  requestPermission,
  hasPermission,
  deleteToken,
  AuthorizationStatus,
} from '@react-native-firebase/messaging';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, PermissionsAndroid } from 'react-native';
import { supabase } from '../../lib/supabase';
import { navigateWhenReady } from '../navigation/navigationRef';
import type { RootStackParamList } from '../navigation/types';

const DEVICE_ID_KEY = 'livil.device_id';
const PROMPT_STATUS_KEY = 'livil.push_prompt_status';

export type PushPromptStatus = 'pending' | 'shown' | 'accepted' | 'denied';

function generateDeviceId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getOrCreateDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = generateDeviceId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export async function getPushPromptStatus(): Promise<PushPromptStatus> {
  const v = await AsyncStorage.getItem(PROMPT_STATUS_KEY);
  if (v === 'shown' || v === 'accepted' || v === 'denied') return v;
  return 'pending';
}

export async function setPushPromptStatus(status: PushPromptStatus): Promise<void> {
  await AsyncStorage.setItem(PROMPT_STATUS_KEY, status);
}

/**
 * Whether the OS notification permission is currently granted.
 *
 * On Android 13+ this is POST_NOTIFICATIONS — a real runtime permission that
 * the Firebase SDK does NOT manage (its requestPermission() is a no-op there).
 * On older Android the permission is implicitly granted at install time.
 * On iOS the Firebase SDK tracks it correctly via hasPermission().
 */
async function checkOsNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    return await PermissionsAndroid.check(
      'android.permission.POST_NOTIFICATIONS' as Parameters<typeof PermissionsAndroid.check>[0],
    );
  }
  if (Platform.OS === 'android') return true; // < API 33 grants at install
  try {
    const current = await hasPermission(getMessaging());
    return (
      current === AuthorizationStatus.AUTHORIZED ||
      current === AuthorizationStatus.PROVISIONAL
    );
  } catch {
    return false;
  }
}

/**
 * Trigger the actual OS-level runtime permission dialog.
 *
 * On Android 13+ this is the only path that shows a real prompt — Firebase's
 * own requestPermission() does not. On older platforms we fall back to the
 * Firebase API.
 */
async function requestOsNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    const result = await PermissionsAndroid.request(
      'android.permission.POST_NOTIFICATIONS' as Parameters<typeof PermissionsAndroid.request>[0],
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }
  if (Platform.OS === 'android') return true;
  const status = await requestPermission(getMessaging());
  return (
    status === AuthorizationStatus.AUTHORIZED ||
    status === AuthorizationStatus.PROVISIONAL
  );
}

/**
 * Whether to render the pre-prompt modal. Returns true only when:
 *  - the user has never resolved the prompt before ('pending'), AND
 *  - the OS hasn't already granted permission (handles users who installed
 *    a previous build that asked directly — we don't want to re-bother them).
 *
 * 'shown' means the user tapped "Maybe later" — we don't immediately re-show,
 * but a follow-up nudge can flip it back to 'pending' at a later moment.
 */
export async function shouldShowPushPrompt(): Promise<boolean> {
  const status = await getPushPromptStatus();
  if (status !== 'pending') return false;
  const granted = await checkOsNotificationPermission();
  if (granted) {
    // Already granted from a previous build; record and skip the pre-prompt.
    await setPushPromptStatus('accepted');
    return false;
  }
  return true;
}

function handleNotificationData(data: Record<string, string> | undefined): void {
  if (!data?.route) return;
  const { route, ...rest } = data;
  navigateWhenReady(route as keyof RootStackParamList, rest);
}

const unsubFns: Array<() => void> = [];
let initialized = false;
let tokenRefreshUnsub: (() => void) | null = null;

export function initPush(): void {
  if (initialized) return;
  initialized = true;

  const messaging = getMessaging();

  const offMessage = onMessage(messaging, msg => {
    console.log('[push] foreground', msg.notification?.title, msg.data);
  });
  unsubFns.push(offMessage);

  const offOpened = onNotificationOpenedApp(messaging, msg => {
    handleNotificationData(msg.data as Record<string, string> | undefined);
  });
  unsubFns.push(offOpened);

  void getInitialNotification(messaging).then(msg => {
    if (msg) handleNotificationData(msg.data as Record<string, string> | undefined);
  });
}

async function upsertToken(userId: string, token: string, deviceId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { error } = await db
    .from('device_tokens')
    .upsert(
      {
        user_id: userId,
        token,
        device_id: deviceId,
        platform: Platform.OS,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,device_id' },
    );
  if (error) throw new Error(error.message);
}

/**
 * Actually fetch the FCM token and write it to device_tokens. Assumes
 * notification permission is already granted. Also wires the token-refresh
 * listener (cancelling any previous one) so a stale closure from a prior
 * sign-in can't write under the wrong user_id.
 */
async function registerTokenAndListen(userId: string): Promise<void> {
  const messaging = getMessaging();
  const token = await getToken(messaging);
  const deviceId = await getOrCreateDeviceId();
  await upsertToken(userId, token, deviceId);

  if (tokenRefreshUnsub) {
    tokenRefreshUnsub();
    tokenRefreshUnsub = null;
  }
  tokenRefreshUnsub = onTokenRefresh(messaging, async (newToken: string) => {
    try {
      await upsertToken(userId, newToken, deviceId);
    } catch (e) {
      console.warn('[push] token refresh upsert failed', e);
    }
  });
}

/**
 * Called on sign-in. Does NOT trigger the system permission prompt — that's
 * gated on the pre-prompt modal so users see context before the OS dialog.
 *
 * - 'denied': previously refused, don't bother them
 * - 'shown': they tapped "Maybe later" earlier this session/install
 * - 'pending': brand new — modal will show and call requestPushPermissionInteractive
 * - 'accepted': just register the token
 *
 * Edge case: if a prior build (Slice 1) auto-prompted and the user accepted,
 * status will still be 'pending' on first launch of this build but the OS
 * already considers permission granted. We detect that and short-circuit
 * straight into registration.
 */
export async function registerDeviceForUser(userId: string): Promise<void> {
  try {
    const status = await getPushPromptStatus();
    if (status === 'denied') return;

    if (status === 'pending' || status === 'shown') {
      const alreadyGranted = await checkOsNotificationPermission();
      if (!alreadyGranted) return;
      await setPushPromptStatus('accepted');
    }

    await registerTokenAndListen(userId);
  } catch (e) {
    console.warn('[push] registerDeviceForUser failed', e);
  }
}

/**
 * Called from the pre-prompt modal's "Enable notifications" button.
 * Triggers the real OS permission dialog, then either registers the token
 * (on grant) or marks the status as 'denied' (on refuse) so we never
 * re-prompt the user.
 *
 * Returns true if push is now active for this user.
 */
export async function requestPushPermissionInteractive(userId: string): Promise<boolean> {
  try {
    const granted = await requestOsNotificationPermission();
    if (!granted) {
      await setPushPromptStatus('denied');
      return false;
    }
    await registerTokenAndListen(userId);
    await setPushPromptStatus('accepted');
    return true;
  } catch (e) {
    console.warn('[push] requestPushPermissionInteractive failed', e);
    return false;
  }
}

/**
 * Called from the modal's "Maybe later" button. Marks the prompt as shown
 * so we don't re-render the modal on every navigation/state change, but
 * keeps the OS permission un-touched so a later flow can still re-prompt.
 */
export async function deferPushPrompt(): Promise<void> {
  await setPushPromptStatus('shown');
}

export async function unregisterDevice(userId: string): Promise<void> {
  try {
    if (tokenRefreshUnsub) {
      tokenRefreshUnsub();
      tokenRefreshUnsub = null;
    }
    const deviceId = await getOrCreateDeviceId();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    await db
      .from('device_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('device_id', deviceId);
    try {
      await deleteToken(getMessaging());
    } catch {
      // best-effort: token may already be gone
    }
  } catch (e) {
    console.warn('[push] unregisterDevice failed', e);
  }
}
