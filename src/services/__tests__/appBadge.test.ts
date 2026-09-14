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

import {
  setAppBadgeCount,
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
});

describe('clearAppBadge', () => {
  it('zeroes the icon and drops our notifications, for account switches', async () => {
    await clearAppBadge();
    expect(mockSetBadgeCount).toHaveBeenCalledWith(0);
    expect(mockCancelAll).toHaveBeenCalledTimes(1);
  });
});
