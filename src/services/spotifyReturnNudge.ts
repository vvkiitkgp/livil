/**
 * "Like or comment on Riya's repost — Tap to come back to Livil": a local notification
 * a few seconds after a hand-off to Spotify from SOMEONE ELSE's repost, the way Blinkit's
 * "Tap to return" card follows a hand-off to a payment app. Its one job is engagement on
 * the friend's repost, so a tap opens that post (PostDetail) and it exists only for a post
 * by someone else — Search, Library, chat and the person's own reposts get no card. Android
 * will not let an app bring itself back to the front, so a tappable card is the one way
 * back that is one tap away.
 *
 * It exists only while the person is away:
 *   • scheduled as a NATIVE timed notification (notifee trigger), never a JS timer — React
 *     Native pauses every JS timer the moment Livil leaves the screen on Android
 *     (JavaTimerManager.onHostPause), so a setTimeout would fire on return, or never;
 *   • cancelled the moment Livil is active again, whether it has fired yet or not — back
 *     within three seconds means nothing ever shows; back later means the card leaves the
 *     shade / Notification Centre as the app opens.
 *
 * Silent: it lands while a song is playing in Spotify. Its own Android channel (no sound,
 * no vibration, no badge) is created here and is deliberately NOT in NOTIFICATION_CHANNELS:
 * that list mirrors the server-side push preferences column for column, and this is a local
 * nudge, not a push.
 *
 * Fail-safe throughout: the hand-off already happened, so nothing here may throw at the UI.
 */
import notifee, { AndroidImportance, TriggerType } from '@notifee/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { supabase } from '../../lib/supabase';
import { COLORS } from '../theme/colors';
import { LIVIL_NOTIFICATION_ID_PREFIX } from './appBadge';
import { getPushPromptStatus, isPushOffFor, notificationPermissionGranted } from './pushNotifications';
import { peekSpotifyTrack } from './spotify';
import { SPOTIFY_ID_RE } from '../utils/spotifyLinks';

/** One card at a time: a second hand-off replaces the first, never stacks on it. */
export const SPOTIFY_RETURN_NOTIFICATION_ID = `${LIVIL_NOTIFICATION_ID_PREFIX}spotify_return`;
/** Android channel. Local-only — see the header. */
export const SPOTIFY_RETURN_CHANNEL_ID = 'spotify_return';
/** How long after the hand-off the card appears. */
export const SPOTIFY_RETURN_DELAY_MS = 3_000;
/** No more than this many a day: helpful once, nagging by the fourth. */
export const SPOTIFY_RETURN_DAILY_CAP = 3;
export const SPOTIFY_RETURN_STORAGE_KEY = 'livil.spotifyReturnNudge.v1';

type NudgeLog = { day: string; count: number; lastPostId: string | null };

/** What the card is about: the friend's repost the song was opened from. */
export type SpotifyReturnNudgeContext = {
  spotifyTrackId: string;
  /** The repost's post id — where a tap lands. */
  postId: string;
  /** The reposter, as shown on the card (display name, else username). */
  authorName: string;
};

/** Local calendar day, so the cap resets at the person's midnight. */
function today(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function readLog(): Promise<NudgeLog> {
  try {
    const raw = await AsyncStorage.getItem(SPOTIFY_RETURN_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<NudgeLog>;
      if (typeof parsed.day === 'string' && typeof parsed.count === 'number') {
        return { day: parsed.day, count: parsed.count, lastPostId: parsed.lastPostId ?? null };
      }
    }
  } catch {
    // Unreadable is the same as empty.
  }
  return { day: today(), count: 0, lastPostId: null };
}

/**
 * Whether a card for `postId` may be shown now, given what has been shown already. Pure,
 * so the cap is testable: not the repost just nudged about (coming back and reopening the
 * same one is not a second chance to ask), and not past the daily cap.
 */
export function mayNudge(log: NudgeLog, postId: string, day = today()): boolean {
  if (log.day === day && log.lastPostId === postId) {return false;}
  if (log.day === day && log.count >= SPOTIFY_RETURN_DAILY_CAP) {return false;}
  return true;
}

export function nextLog(log: NudgeLog, postId: string, day = today()): NudgeLog {
  const count = log.day === day ? log.count + 1 : 1;
  return { day, count, lastPostId: postId };
}

/** Both the person's choices: the phone's permission, and Livil's own Notifications switch. */
async function allowed(): Promise<boolean> {
  if (!(await notificationPermissionGranted())) {return false;}
  if ((await getPushPromptStatus()) !== 'off') {return true;}
  const { data } = await supabase.auth.getUser();
  const me = data?.user?.id;
  return me ? !(await isPushOffFor(me)) : false;
}

let channelReady: Promise<void> | null = null;

function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') {return Promise.resolve();}
  channelReady ??= notifee.createChannel({
    id: SPOTIFY_RETURN_CHANNEL_ID,
    name: 'Back from Spotify',
    description: "A reminder to like or comment on a friend's repost you opened in Spotify",
    // HIGH so it drops in over Spotify like Blinkit's card; silent so it never cuts into the
    // song. `badge: false` keeps it off the launcher count — it is not an unread anything.
    importance: AndroidImportance.HIGH,
    vibration: false,
    badge: false,
  }).then(() => undefined).catch(e => {
    channelReady = null;
    throw e;
  });
  return channelReady;
}

let appStateInstalled = false;
/** The post the pending (or shown) card is about; null when there is none. */
let pendingPostId: string | null = null;
/** Bumped on every return to the foreground, so a schedule still mid-checks can tell. */
let returns = 0;

/**
 * Livil is on screen again: the card has done its job or was never needed. One listener
 * for the life of the process, installed by the first hand-off.
 */
function installReturnCancel(): void {
  if (appStateInstalled) {return;}
  appStateInstalled = true;
  AppState.addEventListener('change', state => {
    if (state === 'active') {
      returns += 1;
      void clearSpotifyReturnNudge();
    }
  });
}

/**
 * Remove the card — pending or already in the tray. Also called once at launch, for a card
 * left behind when the OS closed Livil while the person was still in Spotify.
 */
export async function clearSpotifyReturnNudge(): Promise<void> {
  pendingPostId = null;
  try {
    await notifee.cancelNotification(SPOTIFY_RETURN_NOTIFICATION_ID);
  } catch (e) {
    console.warn('[spotifyReturn] cancel failed', e);
  }
}

/** "Riya’s", "Chris’" — the first name only ("Riya Sharma" → "Riya"), as it reads on the card. */
function possessive(name: string): string {
  const first = name.split(/\s+/)[0];
  return /s$/i.test(first) ? `${first}’` : `${first}’s`;
}

/**
 * Called right after Spotify was opened from a friend's repost. Schedules the card for
 * SPOTIFY_RETURN_DELAY_MS from now; a tap opens that post (route PostDetail, the same path
 * a push tap takes — handleNotificationData).
 */
export async function scheduleSpotifyReturnNudge(ctx: SpotifyReturnNudgeContext): Promise<void> {
  const { spotifyTrackId, postId } = ctx;
  const authorName = ctx.authorName.trim();
  if (!SPOTIFY_ID_RE.test(spotifyTrackId) || !postId || !authorName) {return;}
  try {
    installReturnCancel();
    const returnsAtStart = returns;
    if (!(await allowed())) {return;}
    const log = await readLog();
    if (!mayNudge(log, postId)) {return;}
    // A second hand-off before the first card showed: that one is stale now.
    if (pendingPostId && pendingPostId !== postId) {await clearSpotifyReturnNudge();}
    await ensureChannel();
    // Back already, while the checks above ran? Then the cancel on 'active' has fired and
    // a trigger created now would outlive it — show nothing.
    if (returns !== returnsAtStart) {return;}
    const track = peekSpotifyTrack(spotifyTrackId);
    pendingPostId = postId;
    await notifee.createTriggerNotification(
      {
        id: SPOTIFY_RETURN_NOTIFICATION_ID,
        title: `Like or comment on ${possessive(authorName)} repost`,
        body: 'Tap to come back to Livil',
        data: { route: 'PostDetail', postId },
        android: {
          channelId: SPOTIFY_RETURN_CHANNEL_ID,
          importance: AndroidImportance.HIGH,
          smallIcon: 'ic_stat_livil',
          color: COLORS.purple,
          pressAction: { id: 'default' },
          ...(track?.imageUrl ? { largeIcon: track.imageUrl } : {}),
          // Nothing to count: it is a way back, not an unread event.
          badgeCount: 0,
          // Gone on tap: the person is back, and clearSpotifyReturnNudge runs on 'active' too.
          autoCancel: true,
        },
        // No `ios.sound`: silent, like the Android channel.
      },
      { type: TriggerType.TIMESTAMP, timestamp: Date.now() + SPOTIFY_RETURN_DELAY_MS },
    );
    await AsyncStorage.setItem(SPOTIFY_RETURN_STORAGE_KEY, JSON.stringify(nextLog(log, postId)));
  } catch (e) {
    pendingPostId = null;
    console.warn('[spotifyReturn] schedule failed', e);
  }
}
