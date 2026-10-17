/**
 * Registering this phone for pushes follows the OS permission as it is NOW, not what was
 * answered in the app before: someone who said no and later switched notifications on in
 * Settings gets registered (found 2026-10-18 — a friend with zero device tokens). On
 * returning to the app, a registered install does nothing; an unregistered one re-checks.
 */

let mockPermission = 1; // AuthorizationStatus.AUTHORIZED
const mockStore = new Map<string, string>();
const mockUpsert = jest.fn(async (_row: unknown, _opts: unknown) => ({ error: null }));
const mockGetToken = jest.fn(async () => 'fcm-token-1');

jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: () => ({}),
  getToken: () => mockGetToken(),
  onTokenRefresh: () => () => {},
  hasPermission: async () => mockPermission,
  requestPermission: async () => mockPermission,
  AuthorizationStatus: { NOT_DETERMINED: -1, DENIED: 0, AUTHORIZED: 1, PROVISIONAL: 2 },
}));
jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {},
  AndroidImportance: {},
  AndroidStyle: {},
  EventType: {},
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mockStore.get(k) ?? null,
    setItem: async (k: string, v: string) => { mockStore.set(k, v); },
  },
}));
jest.mock('../../../lib/supabase', () => ({
  supabase: { from: () => ({ upsert: (row: unknown, opts: unknown) => mockUpsert(row, opts) }) },
}));
jest.mock('../../navigation/navigationRef', () => ({ navigateWhenReady: jest.fn() }));

import { registerDeviceForUser, registerIfNewlyAllowed } from '../pushNotifications';

const STATUS = 'livil.push_prompt_status';

beforeEach(() => {
  mockStore.clear();
  mockUpsert.mockClear();
  mockGetToken.mockClear();
  mockPermission = 1;
});

it('said no in the app, later allowed in Settings: the phone is registered', async () => {
  mockStore.set(STATUS, 'denied');
  await registerDeviceForUser('me');
  expect(mockUpsert).toHaveBeenCalledTimes(1);
  expect(mockStore.get(STATUS)).toBe('accepted');
});

it('still not allowed: nothing is registered, whatever the earlier answer', async () => {
  mockPermission = 0;
  for (const status of ['denied', 'shown', 'pending']) {
    mockStore.set(STATUS, status);
    await registerDeviceForUser('me');
  }
  expect(mockUpsert).not.toHaveBeenCalled();
});

it('returning to the app: re-checks until registered, then stays quiet', async () => {
  mockStore.set(STATUS, 'shown');
  mockPermission = 0;
  await registerIfNewlyAllowed('me');
  expect(mockUpsert).not.toHaveBeenCalled();

  mockPermission = 1; // switched on in Settings while away
  await registerIfNewlyAllowed('me');
  expect(mockUpsert).toHaveBeenCalledTimes(1);

  await registerIfNewlyAllowed('me');
  expect(mockUpsert).toHaveBeenCalledTimes(1);
  expect(mockGetToken).toHaveBeenCalledTimes(1);
});
