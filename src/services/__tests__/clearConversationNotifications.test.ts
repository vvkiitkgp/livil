/**
 * Reading a chat must remove that chat's notifications — all of them, on both
 * platforms — and nothing else. The failure this pins: two messages arrive as
 * two iOS rows, the user taps one, reads both in the chat, and the second row
 * stays until swiped away.
 */

const mockGetDisplayed = jest.fn();
const mockCancelDisplayed = jest.fn();

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    getDisplayedNotifications: (...a: unknown[]) => mockGetDisplayed(...(a as [])),
    cancelDisplayedNotifications: (...a: unknown[]) => mockCancelDisplayed(...(a as [])),
  },
  AndroidImportance: {},
  AndroidStyle: {},
  EventType: {},
}));
jest.mock('@react-native-firebase/messaging', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () => ({}));
jest.mock('../../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../navigation/navigationRef', () => ({ navigateWhenReady: jest.fn() }));

import { clearConversationNotifications } from '../pushNotifications';

const CONV = 'conv-riya';

/** A tray holding this chat (both platforms' shapes), another chat, and the music card. */
const TRAY = [
  // iOS: rendered by iOS from the APNs alert — one row per message, id chosen by iOS.
  { id: 'A1B2-ios-row-1', notification: { data: { kind: 'message', conversationId: CONV } } },
  { id: 'C3D4-ios-row-2', notification: { data: { kind: 'message', conversationId: CONV } } },
  // Android: notifee's merged per-chat card.
  { id: `livil:chat:${CONV}`, notification: { data: { kind: 'message' } } },
  // Someone else's chat — must survive.
  { id: 'E5F6-ios-row-3', notification: { data: { kind: 'message', conversationId: 'conv-sam' } } },
  { id: 'livil:chat:conv-sam', notification: { data: { conversationId: 'conv-sam' } } },
  // media3 lock-screen player card — raw player hashCode, no data.
  { id: '1739482910', notification: {} },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockGetDisplayed.mockResolvedValue(TRAY);
  mockCancelDisplayed.mockResolvedValue(undefined);
});

it('removes every notification for the chat being read, including ones not tapped', async () => {
  await clearConversationNotifications(CONV);
  expect(mockCancelDisplayed).toHaveBeenCalledTimes(1);
  expect(mockCancelDisplayed.mock.calls[0][0]).toEqual([
    'A1B2-ios-row-1',
    'C3D4-ios-row-2',
    `livil:chat:${CONV}`,
  ]);
});

it('leaves other chats and the music player card alone', async () => {
  await clearConversationNotifications(CONV);
  const [ids] = mockCancelDisplayed.mock.calls[0] as [string[]];
  expect(ids).not.toContain('E5F6-ios-row-3');
  expect(ids).not.toContain('livil:chat:conv-sam');
  expect(ids).not.toContain('1739482910');
});

it('never calls the no-argument form, which clears everything', async () => {
  mockGetDisplayed.mockResolvedValue([{ id: '1739482910', notification: {} }]);
  await clearConversationNotifications(CONV);
  expect(mockCancelDisplayed).not.toHaveBeenCalled();
});

it('never throws into the chat screen', async () => {
  mockGetDisplayed.mockRejectedValue(new Error('boom'));
  await expect(clearConversationNotifications(CONV)).resolves.toBeUndefined();
});
