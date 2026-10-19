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
import { AppState, Linking, Platform, PermissionsAndroid } from 'react-native';
import { supabase } from '../../lib/supabase';
import { COLORS } from '../theme/colors';
import { navigateWhenReady } from '../navigation/navigationRef';
import { LIVIL_NOTIFICATION_ID_PREFIX } from './appBadge';
import { getActiveConversation, pingConversation } from './activeConversation';
import type { RootStackParamList } from '../navigation/types';

const DEVICE_ID_KEY = 'livil.device_id';
const PROMPT_STATUS_KEY = 'livil.push_prompt_status';

/**
 * 'denied' = the phone's dialog was refused; the OS permission stays the truth after that, so
 * allowing Livil in the phone's settings later registers it. 'off' = switched off in Livil's
 * own Settings: respected whatever the OS says, until switched on again there.
 */
export type PushPromptStatus = 'pending' | 'shown' | 'accepted' | 'denied' | 'off';

/* eslint-disable no-bitwise -- RFC 4122 v4 layout: `| 0` truncates to a nibble, `& 0x3 | 0x8` sets the variant bits */
function generateDeviceId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
/* eslint-enable no-bitwise */

const PUSH_OFF_USER_KEY = 'livil.push_off_user';

// One read-or-create at a time: two registrations started in the same tick (the app's and
// the inbox card's, both on returning to the foreground) would otherwise each mint an id and
// write two device_tokens rows for one token — every push then arrives twice.
let deviceIdOnce: Promise<string> | null = null;

export function getOrCreateDeviceId(): Promise<string> {
  deviceIdOnce ??= (async () => {
    let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = generateDeviceId();
      await AsyncStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  })().catch(e => { deviceIdOnce = null; throw e; });
  return deviceIdOnce;
}

export async function getPushPromptStatus(): Promise<PushPromptStatus> {
  const v = await AsyncStorage.getItem(PROMPT_STATUS_KEY);
  if (v === 'shown' || v === 'accepted' || v === 'denied' || v === 'off') return v;
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

/** Whether the OS permission is granted now — the guide's last card asks only when it is not. */
export function notificationPermissionGranted(): Promise<boolean> {
  return checkOsNotificationPermission();
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
 * AND it is neither switched off in Livil ('off') nor last refused ('denied').
 *
 * Both halves matter. The OS permission alone is not enough — Livil's off switch
 * deletes the device token and records 'off', which leaves the OS permission
 * granted but no delivery path. Checking only our own status is likewise wrong:
 * the user can revoke the permission from OS settings behind our back.
 */
export async function isPushEnabled(): Promise<boolean> {
  const status = await getPushPromptStatus();
  if (status === 'denied' || status === 'off') return false;
  return await checkOsNotificationPermission();
}

/**
 * Settings-screen "off" switch. Deletes this device's token so the edge function
 * stops targeting it, and records 'off' — with the account it belongs to — so a
 * later app launch does not silently re-register this account
 * (registerDeviceForUser returns early on it). 'denied' would not do: that marks a
 * refused dialog, which the OS permission overrides once it is granted.
 *
 * The OS permission is deliberately left alone — an app cannot revoke it, and
 * re-enabling from Settings should not have to re-prompt.
 */
export async function disablePushForUser(userId: string): Promise<void> {
  await setPushPromptStatus('off');
  await AsyncStorage.setItem(PUSH_OFF_USER_KEY, userId);
  await unregisterDevice(userId);
}

/**
 * Whether THIS account switched notifications off in Livil on this phone. The choice is
 * per account: another account signing in on the same phone is not bound by it.
 */
export async function isPushOffFor(userId: string): Promise<boolean> {
  if ((await getPushPromptStatus()) !== 'off') return false;
  const owner = await AsyncStorage.getItem(PUSH_OFF_USER_KEY);
  return owner === null || owner === userId;
}

/**
 * Open the OS notification settings for this app, or for one channel when
 * `channelId` is given (Android only — iOS has no per-channel concept and
 * lands on the app's notification page either way).
 */
export async function openOsNotificationSettings(channelId?: string): Promise<void> {
  // notifee's opener is Android-only — on iOS it silently did nothing (found 2026-10-19:
  // the inbox card's Settings button). Livil's page in iOS Settings holds Notifications.
  if (Platform.OS === 'ios') {
    await Linking.openSettings();
    return;
  }
  await notifee.openNotificationSettings(channelId);
}

/**
 * Whether asking would show the phone's own dialog. iOS shows it once per install: after
 * an answer only Settings can change it. Android 13+ shows it until refused twice, which
 * it does not report — there the last answer we recorded ('denied') stands in for it.
 */
export async function canShowPermissionDialog(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    try {
      return (await hasPermission(getMessaging())) === AuthorizationStatus.NOT_DETERMINED;
    } catch {
      return false;
    }
  }
  if (Number(Platform.Version) < 33) return false; // granted at install; nothing to ask
  return (await getPushPromptStatus()) !== 'denied';
}

/**
 * The ids of channels the user has silenced in Android settings.
 *
 * Android owns per-category state and we deliberately do not mirror it into our
 * own storage: the OS is authoritative, the user can change it from outside the
 * app at any time, and a second copy would drift and then lie in the settings
 * list. Reading it back is the correct direction of dependency.
 *
 * One `getChannels()` call rather than four `getChannel()` calls. Empty on iOS,
 * which has no channels, and on any failure — an unknown state should read as
 * "on" rather than falsely telling the user they are missing notifications.
 */
export async function getBlockedChannelIds(): Promise<Set<string>> {
  if (Platform.OS !== 'android') return new Set();
  try {
    const channels = await notifee.getChannels();
    return new Set(
      channels
        // `blocked` covers an explicitly turned-off channel. IMPORTANCE_NONE is
        // the same thing reached by a different control ("Importance: None"),
        // and does NOT always set `blocked` — check both or the row lies.
        .filter(c => c.blocked || c.importance === AndroidImportance.NONE)
        .map(c => c.id),
    );
  } catch (e) {
    console.warn('[push] getBlockedChannelIds failed', e);
    return new Set();
  }
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
    description: 'Likes, comments, reposts, milestones, new fans, and repost roundups',
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
  // A friend's (or a starred artist's) new song, and the weekly Fresh on Livil roundup
  // (migration 20261026000000 adds the switch). Livil's own push about other people's
  // music, so it gets a switch of its own rather than riding Activity.
  {
    id: 'new_music',
    name: 'New music',
    description: 'New songs from friends and artists you star, and a weekly roundup of fresh Livil songs',
    importance: AndroidImportance.DEFAULT,
  },
  // Livil's own morning/evening nudge to share a song (scheduled server-side, migration
  // 20261025000000). Its own switch is what lets those be sent at all: App Store guideline
  // 4.5.4 wants an in-app opt-out for this kind of message. DEFAULT, not HIGH: a nudge
  // should land in the tray, not drop down over whatever the person is doing.
  {
    id: 'reminders',
    name: 'Mood reminders',
    description: 'A friendly nudge, morning and evening, to share a song. Skipped on days you post',
    importance: AndroidImportance.DEFAULT,
  },
];

/** One flag per notifee channel id. Mirrors the notification_preferences columns. */
export type NotificationCategoryPrefs = {
  social: boolean;
  activity: boolean;
  messages: boolean;
  jam: boolean;
  new_music: boolean;
  reminders: boolean;
  /**
   * @-tags in posts and comments (20261109000000). Not a channel of its own: mentions show
   * on Activity's channel, which every installed app already has, and Activity off silences
   * them too (send-push preferenceColumnsFor).
   */
  mentions: boolean;
};

/** Every category on, which is what an absent row means server-side. */
export const ALL_CATEGORIES_ON: NotificationCategoryPrefs = {
  social: true,
  activity: true,
  messages: true,
  jam: true,
  new_music: true,
  reminders: true,
  mentions: true,
};

/**
 * The user's per-category send preferences.
 *
 * This is OUR state, not Android's: it decides whether send-push sends at all, which
 * is the only mechanism that works on iOS and the only one that avoids waking the
 * device for a category the user muted. Android channel state is separate, OS-owned,
 * and read via `getBlockedChannelIds` — never mirrored here.
 *
 * No row means all-on, matching the server's reading, so a user who has never opened
 * this screen behaves exactly as before. Defaults to all-on if the read fails too —
 * showing someone their notifications are off when we simply could not check would be
 * a lie in the alarming direction.
 */
export async function getNotificationPreferences(
  userId: string,
): Promise<NotificationCategoryPrefs> {
  // `*`, not a column list: a database without `reminders` (20261025000000 not applied)
  // must still return the other four rather than fail the whole read.
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) {
    return { ...ALL_CATEGORIES_ON };
  }
  const row = data as Partial<NotificationCategoryPrefs>;
  return {
    social: row.social ?? true,
    activity: row.activity ?? true,
    messages: row.messages ?? true,
    jam: row.jam ?? true,
    new_music: row.new_music ?? true,
    reminders: row.reminders ?? true,
    mentions: row.mentions ?? true,
  };
}

/**
 * Turn one category on or off.
 *
 * Upsert, not update: the row does not exist until the first toggle, and creating it
 * lazily keeps the migration from having to backfill every user. The other three
 * columns take their `true` defaults on insert, which is the correct starting point.
 */
export async function updateNotificationPreference(
  userId: string,
  category: keyof NotificationCategoryPrefs,
  enabled: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('notification_preferences')
    .upsert(
      { user_id: userId, [category]: enabled, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  if (error) {throw error;}
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Livil's own pushes that this build files under their own Android channel. A Map, not an
 * object literal: `kind` comes off the wire, and `'constructor'` must not find anything.
 */
const OWN_CHANNEL_FOR_KIND = new Map<string, string>([
  ['mood_nudge', 'reminders'],
  ['new_drop', 'new_music'],
  ['originals_weekly', 'new_music'],
]);

/**
 * Where a tap goes, and — for Livil's scheduled pushes, which carry `pushId` (their
 * delivery row) — telling the server it was opened, so the ops dashboard can count it.
 * Every tap path (foreground, background, cold start, FCM-rendered) lands here; the
 * server records only the first open, so a tap seen twice counts once.
 */
export function handleNotificationData(data: Record<string, string> | undefined): void {
  if (!data?.route) return;
  const { route, ...rest } = data;
  if (rest.pushId && UUID_RE.test(rest.pushId)) {
    void (async () => {
      try {
        await supabase.rpc('push_record_open', { p_delivery_id: rest.pushId });
      } catch {
        // A lost count is not worth an error; the navigation below is what matters.
      }
    })();
  }
  // A data-only push carries strings only, so the repost digest names the tab navigator
  // (`App`); land on Home, where the reposts are, rather than whichever tab was last open.
  // A New music push also names Home's feed (`tab: new_on_livil`); anything else — the
  // digest included — opens For you, the feed reposts are in, whichever feed Home was left
  // on. `at` makes a second identical tap still switch, since Home reacts to its params.
  if (route === 'App') {
    const tab = rest.tab === 'new_on_livil' ? 'new_on_livil' : 'for_you';
    navigateWhenReady('App', { screen: 'Home', params: { tab, at: Date.now() } });
    return;
  }
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

/** Monotonic tail for non-chat notification ids -- see the id built below. */
let nonChatSeq = 0;

/**
 * Create the per-category channels so users can mute by category from Android
 * settings. Defined by NOTIFICATION_CHANNELS — add a channel there, not here.
 */
async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  for (const channel of NOTIFICATION_CHANNELS) {
    await createChannel(channel);
  }
}

async function createChannel(channel: NotificationChannel): Promise<void> {
  await notifee.createChannel({
    id: channel.id,
    name: channel.name,
    importance: channel.importance,
    description: channel.description,
    // Already the default, but stated because the launcher badge depends on
    // it: with `badge: false` a channel's notifications contribute nothing to
    // the icon, and the setting CANNOT be changed after a channel is created.
    // Leaving it implicit makes the badge one upstream default change away
    // from silently disappearing, with no call site to grep for.
    badge: true,
  });
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

  // The user is looking at this very chat: a banner would announce something
  // already on screen — or, when realtime has dropped, something NOT yet on
  // screen. Either way, have the chat fetch its latest instead of notifying.
  // Only while the app is in the foreground: index.js's background handler
  // shares this module state on Android, and a backgrounded user must still be
  // told. If no chat screen answers the ping, fall through and notify.
  if (
    CHAT_KINDS.has(kind) &&
    data.conversationId &&
    AppState.currentState === 'active' &&
    data.conversationId === getActiveConversation() &&
    pingConversation(data.conversationId)
  ) {
    return;
  }

  // Mood nudges and New music pushes arrive on the `activity` channel (the only one
  // older builds have); this build gives them their own, so Android's per-category
  // settings can mute them without muting likes. Created here as well as in initPush: an
  // app updated but not yet opened has never run initPush, and Android drops a
  // notification posted to a channel that does not exist. createChannel is a no-op when
  // it already does.
  const ownChannel = OWN_CHANNEL_FOR_KIND.get(kind);
  const channelId = ownChannel ?? data.channelId ?? 'messages';
  if (ownChannel && Platform.OS === 'android') {
    const def = NOTIFICATION_CHANNELS.find(c => c.id === ownChannel);
    if (def) await createChannel(def);
  }
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
    //
    // The `livil:` prefix lets appBadge.ts cancel our notifications without
    // touching the media3 lock-screen player card, which the same app posts under
    // the raw player's hashCode. See LIVIL_NOTIFICATION_ID_PREFIX.
    const conversationId = data.conversationId ?? data.actorUserId ?? 'default';
    const notifId = `${LIVIL_NOTIFICATION_ID_PREFIX}chat:${conversationId}`;

    let prior: Array<{ text: string; timestamp: number }> = [];
    try {
      const displayed = await notifee.getDisplayedNotifications();
      const existing = displayed.find(d => d.id === notifId);
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
        // Android has no "set the app's badge to N" API: the launcher SUMS the
        // `number` of every notification in the tray. This card merges every
        // unread message from one conversation, so its number is that message
        // count -- which makes the sum across cards the true unread total.
        badgeCount: prior.length + 1,
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

  // Likes on one post share ONE card: each new like replaces it ("Riya" → "Priya
  // and 4 others"), so five likes are one card, not five. send-push names the card
  // (collapseId) and marks a like inside its 15-minute alert window `quiet`; a quiet
  // like updates a card still in the tray without a sound, but onlyAlertOnce lets it
  // alert if the card was swiped away. A push without collapseId (an older send-push)
  // keeps a card of its own. Mood nudges and repost digests also replace their own
  // earlier card (never quiet: each is a new message), so an unread morning nudge
  // and its evening one are one card, not two.
  const sharedCard = cardIdFor(kind, data.collapseId);

  await notifee.displayNotification({
    // Prefixed so appBadge.ts can clear it; sequenced so two notifications that
    // land in the same millisecond don't replace one another. Apart from the shared
    // cards above, these are deliberately NOT merged -- a comment and a new fan are
    // separate events.
    id: sharedCard ?? `${LIVIL_NOTIFICATION_ID_PREFIX}${kind || 'push'}:${Date.now()}:${nonChatSeq++}`,
    title,
    body,
    data: tapData,
    android: {
      ...baseAndroid,
      // One event, one unit of badge. See the chat card's badgeCount for why the
      // launcher's sum is what we are steering here. A like card is one unit too:
      // it is one row in the Activity list, however many likes it counts.
      badgeCount: 1,
      onlyAlertOnce: sharedCard !== null && data.quiet === '1',
      ...(actorAvatarUrl ? { largeIcon: actorAvatarUrl } : {}),
    },
  });
}

/**
 * The notification id a card that later pushes REPLACE lives under, or null for a card of
 * its own. send-push names it in `collapseId` (iOS honours the same value as
 * apns-collapse-id):
 *   • activity_like   `like:<post uuid>` — one card per liked post
 *   • activity_comment_like `comment_like:<comment uuid>` — one card per liked comment
 *   • mood_nudge      `mood`             — the evening nudge replaces the morning one
 *   • repost_digest   `digest`           — the 6 PM digest replaces the 11 AM one
 *   • new_drop        `drop`             — a friend's new song replaces an unread earlier one
 *   • originals_weekly `fresh`           — this week's roundup replaces last week's
 * Anything else, or a malformed id, keeps a card per push.
 */
function cardIdFor(kind: string, collapseId: string | undefined): string | null {
  if (!collapseId) return null;
  const ok =
    (kind === 'activity_like' && collapseId.startsWith('like:') && UUID_RE.test(collapseId.slice(5)))
    || (kind === 'activity_comment_like' && collapseId.startsWith('comment_like:')
      && UUID_RE.test(collapseId.slice('comment_like:'.length)))
    || (kind === 'mood_nudge' && collapseId === 'mood')
    || (kind === 'repost_digest' && collapseId === 'digest')
    || (kind === 'new_drop' && collapseId === 'drop')
    || (kind === 'originals_weekly' && collapseId === 'fresh');
  return ok ? `${LIVIL_NOTIFICATION_ID_PREFIX}${collapseId.toLowerCase()}` : null;
}

/**
 * Remove every notification for one conversation from the tray / Notification
 * Center. Called when that conversation is read in-app, so a message the user
 * has already seen does not sit there until it is swiped away.
 *
 * Matched two ways, because the two platforms post these differently:
 *   • Android — notifee posted it, as ONE merged card per chat under
 *     `livil:chat:<conversationId>`.
 *   • iOS — iOS rendered it itself from the APNs alert (see send-push), one row
 *     per message, under an id iOS chose. The only handle is the FCM data, which
 *     lands in the row's userInfo with `conversationId` set by
 *     messages.ts / jam invites.
 * Tapping a notification only removes THAT row, so a second message from the
 * same chat used to survive the user reading it.
 *
 * Never touches anything without this conversation's id — the media3 player
 * card and other chats are left alone. Fail-safe: a lingering notification is
 * cosmetic, so this never throws.
 */
export async function clearConversationNotifications(conversationId: string): Promise<void> {
  try {
    const mergedChatId = `${LIVIL_NOTIFICATION_ID_PREFIX}chat:${conversationId}`;
    const displayed = await notifee.getDisplayedNotifications();
    const ids = displayed
      .filter(d =>
        d.id === mergedChatId || d.notification?.data?.conversationId === conversationId)
      .map(d => d.id)
      .filter((id): id is string => typeof id === 'string');
    if (ids.length === 0) { return; }
    await notifee.cancelDisplayedNotifications(ids);
  } catch (e) {
    console.warn('[push] clearConversationNotifications failed', e);
  }
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
 * - 'accepted': just register the token
 * - anything else ('pending', 'shown' = "Maybe later", 'denied'): register only if the OS
 *   permission is granted now — e.g. switched on in Settings after saying no
 *
 * Edge case: if a prior build (Slice 1) auto-prompted and the user accepted,
 * status will still be 'pending' on first launch of this build but the OS
 * already considers permission granted. We detect that and short-circuit
 * straight into registration.
 */
export async function registerDeviceForUser(userId: string): Promise<void> {
  try {
    const status = await getPushPromptStatus();
    // Switched off in Livil's own Settings by this account: stays off until switched on there.
    if (await isPushOffFor(userId)) return;
    // The OS permission is the truth, whatever was answered in the app before. 'denied'
    // used to return here unconditionally — so someone who said no and later switched
    // notifications ON in Settings was never registered, and no push could reach them
    // (found 2026-10-18: a friend with zero device tokens).
    if (status !== 'accepted') {
      const granted = await checkOsNotificationPermission();
      if (!granted) return;
      await setPushPromptStatus('accepted');
    }

    await registerTokenAndListen(userId);
  } catch (e) {
    console.warn('[push] registerDeviceForUser failed', e);
  }
}

/**
 * On returning to the app: register if notifications were switched on in Settings since
 * the last check. Cheap when there is nothing to do — once this install is registered
 * ('accepted'), it returns without touching the network; token changes after that arrive
 * through onTokenRefresh.
 */
let registerOnce: Promise<void> | null = null;

export function registerIfNewlyAllowed(userId: string): Promise<void> {
  // Shared while one is running: the app and the inbox card both call this when the app
  // comes back, and two registrations in parallel would race each other's writes.
  registerOnce ??= (async () => {
    try {
      if ((await getPushPromptStatus()) === 'accepted') return;
      await registerDeviceForUser(userId);
    } catch (e) {
      console.warn('[push] registerIfNewlyAllowed failed', e);
    } finally {
      registerOnce = null;
    }
  })();
  return registerOnce;
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
 * The guide's last card (TURN ON NOTIFICATIONS): waits only for the person's answer in the
 * phone's dialog, then registers in the background. Registration is two network calls with
 * no timeout (Firebase getToken, then the device_tokens upsert); awaiting them could hold a
 * new user on a spinning last card on a stalled connection. 'accepted' is written first, so
 * the in-app pre-prompt never asks again; a failed registration is retried on the next cold
 * start by registerDeviceForUser. NotificationSettingsScreen keeps the awaited version,
 * because there "on" must mean push is live.
 */
export async function requestPermissionThenRegisterInBackground(userId: string): Promise<boolean> {
  try {
    const granted = await requestOsNotificationPermission();
    if (!granted) {
      await setPushPromptStatus('denied');
      return false;
    }
    await setPushPromptStatus('accepted');
    registerTokenAndListen(userId).catch(e => console.warn('[push] background registration failed', e));
    return true;
  } catch (e) {
    console.warn('[push] requestPermissionThenRegisterInBackground failed', e);
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
