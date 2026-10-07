/**
 * The icon badge. Two things here are worth a test rather than a reading:
 *
 *   1. Clearing must cancel OUR notifications and nothing else. The same app
 *      posts the lock-screen media card from media3, under the raw player's
 *      hashCode — cancelling that would stop the user's music notification dead.
 *      That failure is silent and only reproduces while something is playing.
 *
 *   2. Every path must be fail-safe. This is called from a render effect; an
 *      unhandled rejection there is a broken screen, in exchange for a number.
 */

const mockSetBadgeCount = jest.fn();
const mockGetDisplayed = jest.fn();
const mockCancelAll = jest.fn();

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    setBadgeCount: (...a: unknown[]) => mockSetBadgeCount(...(a as [])),
    getDisplayedNotifications: (...a: unknown[]) => mockGetDisplayed(...(a as [])),
    cancelAllNotifications: (...a: unknown[]) => mockCancelAll(...(a as [])),
  },
}));

import { Platform } from 'react-native';
import {
  setAppBadgeCount,
  resyncAppBadgeCount,
  requestBadgeRefresh,
  onBadgeRefreshRequested,
  clearAppBadge,
  LIVIL_NOTIFICATION_ID_PREFIX,
} from '../appBadge';

/** What the tray looks like while a song is playing and two chats are unread. */
const TRAY = [
  { id: `${LIVIL_NOTIFICATION_ID_PREFIX}chat:conv-1` },
  { id: '1739482910' }, // media3 lock-screen player — raw player hashCode
  { id: `${LIVIL_NOTIFICATION_ID_PREFIX}friend_request:u-9:1:0` },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockSetBadgeCount.mockResolvedValue(undefined);
  mockGetDisplayed.mockResolvedValue(TRAY);
  mockCancelAll.mockResolvedValue(undefined);
});

// @react-native/jest-preset sets defaultPlatform: 'ios', so these exercise the
// iOS branch — the only platform where the number is settable at all.
describe('setAppBadgeCount', () => {
  it('puts the number on the icon', async () => {
    await setAppBadgeCount(3);
    expect(mockSetBadgeCount).toHaveBeenCalledWith(3);
  });

  it('does not cancel anything while unread remains', async () => {
    await setAppBadgeCount(3);
    expect(mockCancelAll).not.toHaveBeenCalled();
  });

  it('cancels ONLY our notifications when the count reaches zero', async () => {
    await setAppBadgeCount(0);

    expect(mockCancelAll).toHaveBeenCalledTimes(1);
    const [ids] = mockCancelAll.mock.calls[0] as [string[]];

    // The media card must survive. This is the whole point of the prefix.
    expect(ids).not.toContain('1739482910');
    expect(ids).toEqual([
      `${LIVIL_NOTIFICATION_ID_PREFIX}chat:conv-1`,
      `${LIVIL_NOTIFICATION_ID_PREFIX}friend_request:u-9:1:0`,
    ]);
  });

  it('never calls the no-argument cancel form', async () => {
    await setAppBadgeCount(0);
    // cancelAllNotifications() with no ids clears everything notifee can reach.
    expect(mockCancelAll).not.toHaveBeenCalledWith();
  });

  it('skips the cancel call entirely when nothing of ours is displayed', async () => {
    mockGetDisplayed.mockResolvedValue([{ id: '1739482910' }]);
    await setAppBadgeCount(0);
    expect(mockCancelAll).not.toHaveBeenCalled();
  });

  it.each([
    [-4, 0],
    [NaN, 0],
    [Infinity, 0],
    [2.6, 3],
  ])('normalises %p to %p', async (input, expected) => {
    await setAppBadgeCount(input);
    expect(mockSetBadgeCount).toHaveBeenCalledWith(expected);
  });

  it('swallows a notifee failure instead of rejecting into the render effect', async () => {
    mockSetBadgeCount.mockRejectedValue(new Error('no permission'));
    await expect(setAppBadgeCount(2)).resolves.toBeUndefined();
  });

  it('swallows a failure to read the tray', async () => {
    mockGetDisplayed.mockRejectedValue(new Error('boom'));
    await expect(setAppBadgeCount(0)).resolves.toBeUndefined();
  });

  it('still zeroes the icon when the tray cannot be read', async () => {
    // Clearing the number used to sit behind the tray read in one try block, so a
    // failed read left a stale number on the icon.
    mockGetDisplayed.mockRejectedValue(new Error('boom'));
    await setAppBadgeCount(0);
    expect(mockSetBadgeCount).toHaveBeenCalledWith(0);
  });
});

describe('resyncAppBadgeCount', () => {
  const realOS = Platform.OS;
  afterEach(() => { Platform.OS = realOS; });

  it('re-writes an unchanged zero on iOS, overwriting a number a push left behind', async () => {
    // The bug: a push set the icon to 1, the in-app total stayed 0 → 0, and the
    // change-driven effect never ran again. The resync must write regardless.
    await resyncAppBadgeCount(0);
    await resyncAppBadgeCount(0);
    expect(mockSetBadgeCount).toHaveBeenCalledTimes(2);
    expect(mockSetBadgeCount).toHaveBeenLastCalledWith(0);
  });

  it('does nothing on Android, where re-running the zero path would clear the tray', async () => {
    Platform.OS = 'android';
    await resyncAppBadgeCount(0);
    expect(mockSetBadgeCount).not.toHaveBeenCalled();
    expect(mockCancelAll).not.toHaveBeenCalled();
    expect(mockGetDisplayed).not.toHaveBeenCalled();
  });
});

describe('clearAppBadge', () => {
  it('zeroes the icon and drops our notifications, for account switches', async () => {
    await clearAppBadge();
    expect(mockSetBadgeCount).toHaveBeenCalledWith(0);
    expect(mockCancelAll).toHaveBeenCalledTimes(1);
  });
});

describe('requestBadgeRefresh', () => {
  it('asks every subscriber (HomeScreen) to re-count', () => {
    const home = jest.fn();
    const off = onBadgeRefreshRequested(home);
    requestBadgeRefresh();
    expect(home).toHaveBeenCalledTimes(1);
    off();
  });

  it('stops calling a subscriber once it unsubscribes (signed out / unmounted)', () => {
    const home = jest.fn();
    const off = onBadgeRefreshRequested(home);
    off();
    requestBadgeRefresh();
    expect(home).not.toHaveBeenCalled();
  });

  it('is a no-op with nobody listening, and a throwing listener does not stop the others', () => {
    expect(() => requestBadgeRefresh()).not.toThrow();
    const bad = jest.fn(() => { throw new Error('boom'); });
    const good = jest.fn();
    const offBad = onBadgeRefreshRequested(bad);
    const offGood = onBadgeRefreshRequested(good);
    expect(() => requestBadgeRefresh()).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    offBad();
    offGood();
  });
});
