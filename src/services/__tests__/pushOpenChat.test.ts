/**
 * A push for the chat the user is looking at must not show a banner; it must
 * make that chat fetch its latest instead (realtime may have missed the
 * message). In every other situation the banner still shows.
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

import { AppState } from 'react-native';
import { displayPushNotification } from '../pushNotifications';
import { setActiveConversation, onConversationPing } from '../activeConversation';

const push = (conversationId: string, kind = 'message') => ({
  kind,
  conversationId,
  title: 'Riya',
  body: 'are you there?',
});

let offPing: () => void = () => {};
let ping: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockDisplay.mockResolvedValue(undefined);
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  setActiveConversation('conv-riya');
  ping = jest.fn();
  offPing = onConversationPing('conv-riya', ping);
});

afterEach(() => {
  offPing();
  setActiveConversation(null);
});

it('pings the open chat and shows no banner', async () => {
  await displayPushNotification(push('conv-riya'));
  expect(ping).toHaveBeenCalledTimes(1);
  expect(mockDisplay).not.toHaveBeenCalled();
});

it('still notifies for a different chat, even one whose screen is open underneath', async () => {
  // Sam's chat is mounted (and so subscribed to pings) lower in the stack, but
  // Riya's is the one on screen — Sam's message must still be announced.
  const samPing = jest.fn();
  const offSam = onConversationPing('conv-sam', samPing);
  await displayPushNotification(push('conv-sam'));
  expect(samPing).not.toHaveBeenCalled();
  expect(mockDisplay).toHaveBeenCalledTimes(1);
  offSam();
});

it('still notifies when the app is in the background, even with that chat left open', async () => {
  Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });
  await displayPushNotification(push('conv-riya'));
  expect(ping).not.toHaveBeenCalled();
  expect(mockDisplay).toHaveBeenCalledTimes(1);
});

it('still notifies when no chat screen answers the ping', async () => {
  offPing();
  await displayPushNotification(push('conv-riya'));
  expect(mockDisplay).toHaveBeenCalledTimes(1);
});

it('does not swallow non-chat notifications that happen to carry the id', async () => {
  await displayPushNotification(push('conv-riya', 'activity_like'));
  expect(ping).not.toHaveBeenCalled();
  expect(mockDisplay).toHaveBeenCalledTimes(1);
});
