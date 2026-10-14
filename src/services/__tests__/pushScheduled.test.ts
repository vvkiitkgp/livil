/**
 * Livil's own scheduled pushes (migration 20261025000000): the mood nudge and the repost
 * digest.
 *
 * Pinned because each failure is invisible from the server: a nudge posted to a channel
 * the phone never created is dropped by Android without a trace; a tap that does not
 * report `pushId` reads as "nobody opened it" on the ops dashboard; and the morning and
 * evening cards must replace each other rather than pile up.
 */
import { Platform } from 'react-native';

const mockDisplay = jest.fn();
const mockCreateChannel = jest.fn();
const mockRpc = jest.fn();
const mockNavigate = jest.fn();

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    displayNotification: (...a: unknown[]) => mockDisplay(...(a as [])),
    createChannel: (...a: unknown[]) => mockCreateChannel(...(a as [])),
    getDisplayedNotifications: jest.fn().mockResolvedValue([]),
  },
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
  AndroidStyle: { MESSAGING: 2 },
  EventType: {},
}));
jest.mock('@react-native-firebase/messaging', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () => ({}));
jest.mock('../../../lib/supabase', () => ({
  supabase: { rpc: (...a: unknown[]) => mockRpc(...(a as [])) },
}));
jest.mock('../../navigation/navigationRef', () => ({
  navigateWhenReady: (...a: unknown[]) => mockNavigate(...(a as [])),
}));

import {
  displayPushNotification,
  handleNotificationData,
  NOTIFICATION_CHANNELS,
  ALL_CATEGORIES_ON,
} from '../pushNotifications';

const DELIVERY = '0b6f2c1e-7a3d-4e55-9a21-3c4d5e6f7a8b';

const mood = (title: string) => ({
  kind: 'mood_nudge',
  route: 'AddToLivil',
  channelId: 'activity',
  title,
  body: 'What are you listening to right now?',
  collapseId: 'mood',
  pushId: DELIVERY,
});

const digest = (title: string) => ({
  kind: 'repost_digest',
  route: 'App',
  channelId: 'activity',
  title,
  body: 'reposted 18 songs since last night',
  collapseId: 'digest',
  pushId: DELIVERY,
});

type Shown = { id: string; title: string; android: { channelId: string; onlyAlertOnce?: boolean } };
const shown = (call: number): Shown => mockDisplay.mock.calls[call][0] as Shown;

const flush = () => new Promise(resolve => setImmediate(resolve));

const originalOS = Platform.OS;

beforeEach(() => {
  jest.clearAllMocks();
  mockDisplay.mockResolvedValue(undefined);
  mockCreateChannel.mockResolvedValue('reminders');
  mockRpc.mockResolvedValue({ data: null, error: null });
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
});

afterAll(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
});

describe('the Mood reminders category', () => {
  it('is a settings row of its own, on by default', () => {
    const row = NOTIFICATION_CHANNELS.find(c => c.id === 'reminders');
    expect(row?.name).toBe('Mood reminders');
    expect(ALL_CATEGORIES_ON.reminders).toBe(true);
  });
});

describe('a mood nudge', () => {
  it('goes to the Mood reminders channel, creating it first, whatever channel the server named', async () => {
    await displayPushNotification(mood('Ssup, music buddy? 👀'));

    expect(mockCreateChannel).toHaveBeenCalledWith(expect.objectContaining({ id: 'reminders' }));
    expect(mockCreateChannel.mock.invocationCallOrder[0]).toBeLessThan(mockDisplay.mock.invocationCallOrder[0]);
    expect(shown(0).android.channelId).toBe('reminders');
  });

  it('replaces the morning card with the evening one, and alerts both times', async () => {
    await displayPushNotification(mood('Ssup, music buddy? 👀'));
    await displayPushNotification(mood('Hey, are you okay? 🫶'));

    expect(shown(0).id).toBe('livil:mood');
    expect(shown(1).id).toBe('livil:mood');
    expect(shown(1).title).toBe('Hey, are you okay? 🫶');
    expect(shown(1).android.onlyAlertOnce).toBe(false);
  });
});

describe('a repost digest', () => {
  it('stays on the Activity channel and replaces the 11 AM card at 6 PM', async () => {
    await displayPushNotification(digest('Arjun, Kavya and 10 others'));
    await displayPushNotification(digest('Riya and 3 others'));

    expect(mockCreateChannel).not.toHaveBeenCalled();
    expect(shown(0).android.channelId).toBe('activity');
    expect(shown(0).id).toBe('livil:digest');
    expect(shown(1).id).toBe('livil:digest');
  });
});

it('only merges a scheduled card under the id its own kind uses', async () => {
  await displayPushNotification({ ...mood('x'), collapseId: 'digest' });
  await displayPushNotification({ ...digest('x'), collapseId: 'mood' });
  await displayPushNotification({ ...mood('x'), kind: 'activity_comment' });

  mockDisplay.mock.calls.forEach(c => expect((c[0] as Shown).id).not.toMatch(/^livil:(mood|digest)$/));
});

describe('tapping one', () => {
  it('tells the server it was opened, then opens the right screen', async () => {
    handleNotificationData(mood('Ssup, music buddy? 👀'));
    await flush();

    expect(mockRpc).toHaveBeenCalledWith('push_record_open', { p_delivery_id: DELIVERY });
    expect(mockNavigate).toHaveBeenCalledWith('AddToLivil', expect.objectContaining({ kind: 'mood_nudge' }));
  });

  it('lands a digest on the Home tab, not whichever tab was last open', () => {
    handleNotificationData(digest('Arjun, Kavya and 10 others'));

    expect(mockNavigate).toHaveBeenCalledWith('App', { screen: 'Home' });
  });

  it('still navigates when the open cannot be recorded', async () => {
    mockRpc.mockRejectedValueOnce(new Error('offline'));
    handleNotificationData(digest('Arjun'));
    await flush();

    expect(mockNavigate).toHaveBeenCalledWith('App', { screen: 'Home' });
  });

  it('reports nothing for pushes without a delivery id, or with a malformed one', async () => {
    handleNotificationData({ route: 'ActivityCenter', kind: 'activity_like' });
    handleNotificationData({ ...mood('x'), pushId: "1' or '1'='1" });
    await flush();

    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledTimes(2);
  });
});

describe('a New music push', () => {
  const drop = (title: string) => ({
    kind: 'new_drop',
    route: 'App',
    tab: 'new_on_livil',
    channelId: 'activity',
    title,
    body: '“Midnight Chai” · be one of the first to listen',
    collapseId: 'drop',
    pushId: DELIVERY,
  });

  it('goes to the New music channel, creating it first, and keeps one card', async () => {
    await displayPushNotification(drop('Arjun dropped a new song 🎧'));
    await displayPushNotification(drop('Kavya dropped a new song 🎧'));

    expect(mockCreateChannel).toHaveBeenCalledWith(expect.objectContaining({ id: 'new_music' }));
    expect(shown(0).android.channelId).toBe('new_music');
    expect(shown(0).id).toBe('livil:drop');
    expect(shown(1).id).toBe('livil:drop');
  });

  it('files the weekly roundup under New music too, one card a week', async () => {
    await displayPushNotification({ ...drop('Fresh on Livil this week ✨'), kind: 'originals_weekly', collapseId: 'fresh' });

    expect(shown(0).android.channelId).toBe('new_music');
    expect(shown(0).id).toBe('livil:fresh');
  });

  it('opens Home on the New on Livil tab, and counts the open', async () => {
    handleNotificationData(drop('Arjun dropped a new song 🎧'));
    await flush();

    expect(mockRpc).toHaveBeenCalledWith('push_record_open', { p_delivery_id: DELIVERY });
    expect(mockNavigate).toHaveBeenCalledWith('App', {
      screen: 'Home',
      params: { tab: 'new_on_livil', at: expect.any(Number) },
    });
  });

  it('ignores a tab it does not know, landing on Home as before', () => {
    handleNotificationData({ ...drop('x'), tab: 'something_else' });

    expect(mockNavigate).toHaveBeenCalledWith('App', { screen: 'Home' });
  });

  it('is a settings row of its own, on by default', () => {
    expect(NOTIFICATION_CHANNELS.find(c => c.id === 'new_music')?.name).toBe('New music');
    expect(ALL_CATEGORIES_ON.new_music).toBe(true);
  });
});

it('never finds a channel for a kind named after an object property', async () => {
  await displayPushNotification({ ...mood('x'), kind: 'constructor', channelId: 'activity' });

  expect(shown(0).android.channelId).toBe('activity');
});

