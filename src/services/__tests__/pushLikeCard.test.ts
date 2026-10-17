/**
 * Likes on one post share ONE Android card that each new like replaces, and a
 * like inside send-push's alert window updates it without a sound. Everything
 * else keeps a card of its own.
 */

const mockDisplay = jest.fn();

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    displayNotification: (...a: unknown[]) => mockDisplay(...(a as [])),
    getDisplayedNotifications: jest.fn().mockResolvedValue([]),
  },
  AndroidImportance: { HIGH: 4 },
  AndroidStyle: { MESSAGING: 2 },
  EventType: {},
}));
jest.mock('@react-native-firebase/messaging', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () => ({}));
jest.mock('../../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../navigation/navigationRef', () => ({ navigateWhenReady: jest.fn() }));

import { displayPushNotification } from '../pushNotifications';

const POST = '6f1c2a10-0000-4000-8000-00000000abcd';
const OTHER_POST = '6f1c2a10-0000-4000-8000-00000000ef01';

const like = (title: string, extra: Record<string, string> = {}) => ({
  kind: 'activity_like',
  route: 'ActivityCenter',
  title,
  body: 'liked your repost of “Blinding Lights”',
  collapseId: `like:${POST}`,
  ...extra,
});

type Shown = { id: string; title: string; android: { onlyAlertOnce?: boolean } };
const shown = (call: number): Shown => mockDisplay.mock.calls[call][0] as Shown;

beforeEach(() => {
  jest.clearAllMocks();
  mockDisplay.mockResolvedValue(undefined);
});

it('posts every like on one post under the same card, which the next like replaces', async () => {
  await displayPushNotification(like('Riya'));
  await displayPushNotification(like('Priya and 4 others', { quiet: '1' }));

  expect(shown(0).id).toBe(`livil:like:${POST}`);
  expect(shown(1).id).toBe(`livil:like:${POST}`);
  expect(shown(1).title).toBe('Priya and 4 others');
});

it('alerts for the loud like and only updates the card for a quiet one', async () => {
  await displayPushNotification(like('Riya'));
  await displayPushNotification(like('Arjun and 1 other', { quiet: '1' }));

  expect(shown(0).android.onlyAlertOnce).toBe(false);
  expect(shown(1).android.onlyAlertOnce).toBe(true);
});

it('gives each post its own card', async () => {
  await displayPushNotification(like('Riya'));
  await displayPushNotification(like('Riya', { collapseId: `like:${OTHER_POST}` }));

  expect(shown(0).id).not.toBe(shown(1).id);
});

it('keeps a card per push when send-push names none (older server) or a malformed one', async () => {
  const unnamed: Record<string, string> = like('Riya');
  delete unnamed.collapseId;
  await displayPushNotification(unnamed);
  await displayPushNotification(unnamed);
  await displayPushNotification(like('Riya', { collapseId: 'like:../../chat:abc' }));

  const ids = mockDisplay.mock.calls.map(c => (c[0] as Shown).id);
  expect(new Set(ids).size).toBe(3);
  ids.forEach(id => expect(id).toMatch(/^livil:activity_like:/));
  mockDisplay.mock.calls.forEach(c => expect((c[0] as Shown).android.onlyAlertOnce).toBe(false));
});

it('never merges anything but likes, even if a card id arrives', async () => {
  await displayPushNotification({ ...like('Riya'), kind: 'activity_comment', quiet: '1' });

  expect(shown(0).id).toMatch(/^livil:activity_comment:/);
  expect(shown(0).android.onlyAlertOnce).toBe(false);
});

it('likes on one comment share one card too — and only a comment like may use that id', async () => {
  const COMMENT = '6f1c2a10-0000-4000-8000-0000000c0de1';
  const commentLike = (title: string) => ({
    kind: 'activity_comment_like',
    route: 'ActivityCenter',
    title,
    body: 'liked your comment',
    collapseId: `comment_like:${COMMENT}`,
  });
  await displayPushNotification(commentLike('Riya'));
  await displayPushNotification(commentLike('Riya and 1 other'));
  expect(shown(0).id).toBe(`livil:comment_like:${COMMENT}`);
  expect(shown(1).id).toBe(`livil:comment_like:${COMMENT}`);
  // A post like naming a comment card, or a malformed comment id, gets a card of its own.
  await displayPushNotification(like('Riya', { collapseId: `comment_like:${COMMENT}` }));
  await displayPushNotification({ ...commentLike('Riya'), collapseId: 'comment_like:../chat' });
  expect(shown(2).id).not.toBe(`livil:comment_like:${COMMENT}`);
  expect(shown(3).id).not.toMatch(/chat/);
});
