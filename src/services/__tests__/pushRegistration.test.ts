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
  deleteToken: async () => {},
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
  supabase: {
    from: () => ({
      upsert: (row: unknown, opts: unknown) => mockUpsert(row, opts),
      delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
    }),
  },
}));
jest.mock('../../navigation/navigationRef', () => ({ navigateWhenReady: jest.fn() }));

import { disablePushForUser, registerDeviceForUser, registerIfNewlyAllowed } from '../pushNotifications';

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

it('switched off in Livil\'s Settings: stays off, even with the OS permission on', async () => {
  await disablePushForUser('me');
  await registerDeviceForUser('me');
  await registerIfNewlyAllowed('me');
  expect(mockUpsert).not.toHaveBeenCalled();
  expect(mockStore.get(STATUS)).toBe('off');
});

it('one account\'s off switch does not bind the next account on the same phone', async () => {
  await disablePushForUser('riya');
  await registerDeviceForUser('arjun');
  expect(mockUpsert).toHaveBeenCalledTimes(1);
  expect(mockUpsert.mock.calls[0][0]).toEqual(expect.objectContaining({ user_id: 'arjun' }));
});

it('two registrations at once (app + inbox card on return): one device, one row', async () => {
  mockStore.set(STATUS, 'denied');
  await Promise.all([registerIfNewlyAllowed('me'), registerIfNewlyAllowed('me')]);
  const ids = new Set(mockUpsert.mock.calls.map(c => (c[0] as { device_id: string }).device_id));
  expect(ids.size).toBe(1);
  expect(mockUpsert).toHaveBeenCalledTimes(1);
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
