/**
 * Android owns per-category notification state; this reads it back rather than
 * mirroring it into our own storage, which would drift and then lie in the
 * settings list. The branches below are each a way that read can go wrong.
 */

const mockGetChannels = jest.fn();
jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: { getChannels: (...a: unknown[]) => mockGetChannels(...(a as [])) },
  AndroidImportance: { NONE: 0, MIN: 1, LOW: 2, DEFAULT: 3, HIGH: 4 },
  AndroidStyle: { MESSAGING: 'messaging', BIGTEXT: 'bigtext' },
  EventType: { PRESS: 1, DISMISSED: 0 },
}));

// The module's other dependencies are only needed at call time by functions
// this suite does not touch, but they must import cleanly.
jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(),
  getToken: jest.fn(),
  onMessage: jest.fn(),
  onNotificationOpenedApp: jest.fn(),
  getInitialNotification: jest.fn(),
  onTokenRefresh: jest.fn(),
  requestPermission: jest.fn(),
  hasPermission: jest.fn(),
  deleteToken: jest.fn(),
  AuthorizationStatus: { AUTHORIZED: 1, PROVISIONAL: 2 },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(),
}));
jest.mock('../../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../navigation/navigationRef', () => ({ navigateWhenReady: jest.fn() }));

import { Platform } from 'react-native';
import { getBlockedChannelIds } from '../pushNotifications';

const channel = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: id,
  blocked: false,
  importance: 3,
  ...over,
});

describe('getBlockedChannelIds', () => {
  const realOS = Platform.OS;
  beforeEach(() => {
    jest.clearAllMocks();
    (Platform as { OS: string }).OS = 'android';
  });
  afterAll(() => { (Platform as { OS: string }).OS = realOS; });

  it('returns nothing when every channel is live', async () => {
    mockGetChannels.mockResolvedValue([channel('social'), channel('messages')]);
    expect(await getBlockedChannelIds()).toEqual(new Set());
  });

  it('reports an explicitly blocked channel', async () => {
    mockGetChannels.mockResolvedValue([
      channel('social'),
      channel('messages', { blocked: true }),
    ]);
    expect(await getBlockedChannelIds()).toEqual(new Set(['messages']));
  });

  it('reports importance NONE as blocked even when the blocked flag is false', async () => {
    // Reached by the "Importance: None" control rather than the on/off switch.
    // Checking only `blocked` here would show the row as On while Android
    // silently drops every notification in it.
    mockGetChannels.mockResolvedValue([
      channel('social'),
      channel('jam', { blocked: false, importance: 0 }),
    ]);
    expect(await getBlockedChannelIds()).toEqual(new Set(['jam']));
  });

  it('reads as all-clear on iOS without calling the Android API', async () => {
    (Platform as { OS: string }).OS = 'ios';
    expect(await getBlockedChannelIds()).toEqual(new Set());
    expect(mockGetChannels).not.toHaveBeenCalled();
  });

  it('fails open — an unreadable state must not claim the user is missing things', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetChannels.mockRejectedValue(new Error('no such module'));
    expect(await getBlockedChannelIds()).toEqual(new Set());
  });
});
