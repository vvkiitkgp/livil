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
import notifee, { AndroidImportance, AndroidStyle, EventType } from '@notifee/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, PermissionsAndroid } from 'react-native';
import { supabase } from '../../lib/supabase';
import { COLORS } from '../theme/colors';
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
 * Whether push is currently live for this device: the OS permission is granted
 * AND the user has not turned it off in Settings.
 *
 * Both halves matter. The OS permission alone is not enough — turning push off
 * from Settings deletes the device token and records 'denied', which leaves the
 * OS permission granted but no delivery path. Checking only our own status is
 * likewise wrong: the user can revoke the permission from OS settings behind
 * our back.
 */
export async function isPushEnabled(): Promise<boolean> {
  const status = await getPushPromptStatus();
  if (status === 'denied') return false;
  return await checkOsNotificationPermission();
}

/**
 * Settings-screen "off" switch. Deletes this device's token so the edge
 * function stops targeting it, and records 'denied' so a later app launch does
 * not silently re-register (registerDeviceForUser short-circuits on 'denied').
 *
 * The OS permission is deliberately left alone — an app cannot revoke it, and
 * re-enabling from Settings should not have to re-prompt.
 */
export async function disablePushForUser(userId: string): Promise<void> {
  await setPushPromptStatus('denied');
  await unregisterDevice(userId);
}

/**
 * Open the OS notification settings for this app, or for one channel when
 * `channelId` is given (Android only — iOS has no per-channel concept and
 * lands on the app's notification page either way).
 */
export async function openOsNotificationSettings(channelId?: string): Promise<void> {
  await notifee.openNotificationSettings(channelId);
}

export type NotificationChannel = {
  id: string;
  name: string;
  description: string;
  importance: AndroidImportance;
};

/**
 * The Android notification channels, in the order the settings list shows them.
 *
 * This is the single source of truth: `ensureChannels` creates them from this
 * array and NotificationSettingsScreen lists them from it, so a channel can
 * never exist in the OS without a settings row (or vice versa).
 *
 * `social` is DEFAULT (silent tray); the rest are HIGH so they surface as a
 * heads-up banner — DEFAULT-importance social notifications were being missed.
 */
export const NOTIFICATION_CHANNELS: NotificationChannel[] = [
  {
    id: 'social',
    name: 'Social',
    description: 'Friend requests, new followers, and fan activity',
    importance: AndroidImportance.DEFAULT,
  },
  {
    id: 'activity',
    name: 'Activity',
    description: 'Likes, comments, reposts, milestones, and new fans on your tracks',
    importance: AndroidImportance.HIGH,
  },
  {
    id: 'messages',
    name: 'Messages',
    description: 'Direct messages, group messages, and reactions',
    importance: AndroidImportance.HIGH,
  },
  {
    id: 'jam',
    name: 'Jam Rooms',
    description: 'Jam invites and host activity',
    importance: AndroidImportance.HIGH,
  },
];

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

/**
 * Kinds that represent a chat-style interaction. For these we use Android
 * MessagingStyle so the notification renders WhatsApp/Telegram-like: a
 * circular avatar inline, the sender's display name as the title, and the
 * message body underneath.
 *
 * Non-chat kinds (friend request, new fan, jam_ended) get a simpler layout
 * with the avatar as a regular large icon.
 */
const CHAT_KINDS = new Set(['message', 'reaction', 'jam_invite_dm']);

/**
 * Create the per-category channels so users can mute by category from Android
 * settings. Defined by NOTIFICATION_CHANNELS — add a channel there, not here.
 */
async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  for (const channel of NOTIFICATION_CHANNELS) {
    await notifee.createChannel({
      id: channel.id,
      name: channel.name,
      importance: channel.importance,
      description: channel.description,
    });
  }
}

/**
 * Render an FCM data payload as a visual notification via notifee. Same
 * code path is used for foreground (onMessage) and background/quit
 * (setBackgroundMessageHandler in index.js).
 *
 * Edge function sends data-only FCM messages so the OS does NOT auto-display
 * — this function is the only place that calls displayNotification.
 */
export async function displayPushNotification(
  data: Record<string, string | undefined> | undefined,
): Promise<void> {
  if (!data) return;
  const kind = data.kind ?? '';
  const channelId = data.channelId ?? 'messages';
  const title = data.title ?? '';
  const body = data.body ?? '';
  const actorDisplayName = data.actorDisplayName || title;
  const actorAvatarUrl = data.actorAvatarUrl || '';

  const baseAndroid = {
    channelId,
    importance: AndroidImportance.HIGH,
    // Android masks the small icon to its alpha channel, so a full-colour
    // launcher icon renders as a solid white square in the status bar.
    // `ic_stat_livil` is the flat white pulse silhouette on transparent.
    smallIcon: 'ic_stat_livil',
    color: COLORS.purple,
    pressAction: { id: 'default' },
  };

  // Strip our internal `_keys` from the data we pass into notifee — only
  // what's needed for the tap-routing handler.
  const tapData: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') tapData[k] = v;
  }

  if (CHAT_KINDS.has(kind) && actorAvatarUrl) {
    // Group all chat notifications from one conversation under a stable id
    // so successive messages merge into a single expandable thread (the
    // WhatsApp/Telegram pattern), instead of stacking as separate cards.
    //
    // The id is per-conversation, so different chats stay separate. For
    // events without a conversation (rare), fall back to actorUserId.
    const conversationId = data.conversationId ?? data.actorUserId ?? 'default';
    const notifId = `chat:${conversationId}`;

    let prior: Array<{ text: string; timestamp: number }> = [];
    try {
      const displayed = await notifee.getDisplayedNotifications();
      const existing = displayed.find(d => d.id === notifId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const style = (existing?.notification?.android?.style as any) ?? null;
      if (style && Array.isArray(style.messages)) {
        prior = style.messages.map((m: { text: string; timestamp: number }) => ({
          text: m.text,
          timestamp: m.timestamp,
        }));
      }
    } catch {
      // best-effort — if we can't read prior messages, just show this one
    }

    await notifee.displayNotification({
      id: notifId,
      data: tapData,
      android: {
        ...baseAndroid,
        groupId: 'chats',
        style: {
          type: AndroidStyle.MESSAGING,
          person: {
            name: actorDisplayName,
            icon: actorAvatarUrl,
          },
          messages: [
            ...prior,
            { text: body, timestamp: Date.now() },
          ],
        },
      },
    });
    return;
  }

  await notifee.displayNotification({
    title,
    body,
    data: tapData,
    android: {
      ...baseAndroid,
      ...(actorAvatarUrl ? { largeIcon: actorAvatarUrl } : {}),
    },
  });
}

const unsubFns: Array<() => void> = [];
let initialized = false;
let tokenRefreshUnsub: (() => void) | null = null;

export function initPush(): void {
  if (initialized) return;
  initialized = true;

  void ensureChannels();

  const messaging = getMessaging();

  // FCM foreground delivery: edge function sends data-only, so the OS won't
  // auto-display. Render via notifee here so the user sees the same
  // MessagingStyle in foreground as in background.
  const offMessage = onMessage(messaging, async msg => {
    await displayPushNotification(msg.data as Record<string, string> | undefined);
  });
  unsubFns.push(offMessage);

  // Notifee tap handling — runs when the user taps a notification we
  // displayed. Routes through the same handleNotificationData path the
  // FCM auto-display tap used to.
  const offNotifee = notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.PRESS) {
      handleNotificationData(detail.notification?.data as Record<string, string> | undefined);
    }
  });
  unsubFns.push(offNotifee);

  // Legacy: if FCM ever delivers a message with a `notification` payload
  // (e.g. from a server we don't control, or messages dispatched before the
  // edge function was upgraded), these handlers still route the tap.
  const offOpened = onNotificationOpenedApp(messaging, msg => {
    handleNotificationData(msg.data as Record<string, string> | undefined);
  });
  unsubFns.push(offOpened);

  void getInitialNotification(messaging).then(msg => {
    if (msg) handleNotificationData(msg.data as Record<string, string> | undefined);
  });

  // Cold-start tap on a notifee-rendered notification: app was killed,
  // user tapped, Android launched MainActivity, notifee preserved the
  // tapped notification's data here.
  void notifee.getInitialNotification().then(initial => {
    if (initial?.notification?.data) {
      handleNotificationData(initial.notification.data as Record<string, string>);
    }
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
