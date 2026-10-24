/**
 * A tap on a notification card must open what it points at — exactly once.
 *
 * Android hands notifee taps on a backgrounded app to index.js's background handler, and
 * on a cold start hands the SAME tap to getInitialNotification as well. Routing only from
 * getInitialNotification (once, at launch) is what left a tap on a backgrounded app on
 * whatever screen it was last on; routing from both must not open the chat twice.
 */

const mockDisplay = jest.fn();
const mockNavigate = jest.fn();

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
jest.mock('../../../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
let mockOnScreen: { name: string; params?: object } | undefined;
jest.mock('../../navigation/navigationRef', () => ({
  navigateWhenReady: (...a: unknown[]) => mockNavigate(...(a as [])),
  navigationRef: {
    isReady: () => mockOnScreen !== undefined,
    getCurrentRoute: () => mockOnScreen,
  },
}));

import { Platform } from 'react-native';
import { displayPushNotification, handleNotificationPress } from '../pushNotifications';

const realOS = Platform.OS;
afterAll(() => { Platform.OS = realOS; });

const riyaCard = {
  id: 'livil:chat:conv-riya',
  data: { route: 'Conversation', conversationId: 'conv-riya', title: 'Riya', kind: 'message' },
};
const samCard = {
  id: 'livil:chat:conv-sam',
  data: { route: 'Conversation', conversationId: 'conv-sam', title: 'Sam', kind: 'message' },
};

let now = 1_000_000;
beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
  mockOnScreen = { name: 'Home' };
  mockDisplay.mockResolvedValue(undefined);
  now += 60_000; // each test starts well clear of the previous one's taps
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('opens the chat the card is for', () => {
  handleNotificationPress(riyaCard);
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledWith(
    'Conversation',
    expect.objectContaining({ conversationId: 'conv-riya' }),
  );
});

it('opens it once when a cold start reports the same tap twice', () => {
  handleNotificationPress(riyaCard); // index.js background handler (PRESS event)
  now += 800;
  handleNotificationPress(riyaCard); // initPush's getInitialNotification
  expect(mockNavigate).toHaveBeenCalledTimes(1);
});

it('still opens a different card tapped straight after', () => {
  handleNotificationPress(riyaCard);
  now += 800;
  handleNotificationPress(samCard);
  expect(mockNavigate).toHaveBeenCalledTimes(2);
  expect(mockNavigate).toHaveBeenLastCalledWith(
    'Conversation',
    expect.objectContaining({ conversationId: 'conv-sam' }),
  );
});

it('opens the same chat again once the moment has passed', () => {
  handleNotificationPress(riyaCard);
  now += 11_000;
  handleNotificationPress(riyaCard);
  expect(mockNavigate).toHaveBeenCalledTimes(2);
});

it('treats a card re-posted for a new message as a new tap, however soon', async () => {
  handleNotificationPress(riyaCard);
  now += 2_000;
  // Riya writes again: the chat's card is posted again under the same id.
  await displayPushNotification({
    kind: 'message',
    conversationId: 'conv-riya',
    title: 'Riya',
    body: 'one more thing',
    actorAvatarUrl: 'https://example.com/riya.jpg',
    route: 'Conversation',
  });
  expect(mockDisplay).toHaveBeenCalledWith(expect.objectContaining({ id: 'livil:chat:conv-riya' }));
  now += 1_000;
  handleNotificationPress(riyaCard);
  expect(mockNavigate).toHaveBeenCalledTimes(2);
});

it('ignores a press without data, as the old handler did', () => {
  handleNotificationPress(undefined);
  handleNotificationPress({ id: 'livil:x' });
  expect(mockNavigate).not.toHaveBeenCalled();
});

describe('Android chat taps', () => {
  beforeEach(() => { Platform.OS = 'android'; });

  it("opens the chat without the push's own kind, so the chat looks up dm/group itself", () => {
    handleNotificationPress(riyaCard);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const params = mockNavigate.mock.calls[0][1] as Record<string, string>;
    expect(params.conversationId).toBe('conv-riya');
    expect(params).not.toHaveProperty('kind');
  });

  it('does nothing when that chat is already on screen', () => {
    mockOnScreen = { name: 'Conversation', params: { conversationId: 'conv-riya', kind: 'dm' } };
    handleNotificationPress(riyaCard);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('still opens a different chat from inside one', () => {
    mockOnScreen = { name: 'Conversation', params: { conversationId: 'conv-sam', kind: 'dm' } };
    handleNotificationPress(riyaCard);
    expect(mockNavigate).toHaveBeenCalledWith(
      'Conversation',
      expect.objectContaining({ conversationId: 'conv-riya' }),
    );
  });

  it('queues the chat when the navigator is not up yet (cold start)', () => {
    mockOnScreen = undefined;
    handleNotificationPress(riyaCard);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });
});

it('iOS routes exactly as before — kind and all', () => {
  Platform.OS = 'ios';
  mockOnScreen = { name: 'Conversation', params: { conversationId: 'conv-riya', kind: 'dm' } };
  handleNotificationPress(riyaCard);
  expect(mockNavigate).toHaveBeenCalledWith(
    'Conversation',
    expect.objectContaining({ conversationId: 'conv-riya', kind: 'message' }),
  );
});

