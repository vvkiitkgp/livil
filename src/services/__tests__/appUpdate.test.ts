/**
 * The update prompt's rules. What these pin:
 *  - blocking beats gentle, and a build AT the threshold is not behind it;
 *  - FAIL-OPEN: any failure to read the policy means no prompt — a spurious blocking
 *    screen would lock people out of a working app;
 *  - "Later" snoozes one build for three days, and a newer release asks again at once;
 *  - each platform is sent only to its own store (App Review guideline 2.3.10).
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockMaybeSingle = jest.fn();
const mockEq = jest.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn((_table: string) => ({ select: mockSelect }));
jest.mock('../../../lib/supabase', () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  decideUpdate,
  fetchUpdatePolicy,
  isUpdateSnoozed,
  snoozeUpdate,
  SNOOZE_MS,
  storeUrls,
} from '../appUpdate';
import {
  APP_STORE_APP_URL,
  APP_STORE_URL,
  PLAY_STORE_APP_URL,
  PLAY_STORE_WEB_URL,
} from '../../constants/links';

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('decideUpdate', () => {
  const policy = { latestBuild: 79, minimumBuild: 77, message: null };

  it('blocks a build below the minimum', () => {
    expect(decideUpdate(policy, 76)).toEqual({ kind: 'hard', message: null });
  });

  it('nudges a build between the minimum and the latest', () => {
    expect(decideUpdate(policy, 77)).toEqual({ kind: 'soft', latestBuild: 79, message: null });
    expect(decideUpdate(policy, 78).kind).toBe('soft');
  });

  it('leaves the latest build — and anything newer, e.g. a dev build — alone', () => {
    expect(decideUpdate(policy, 79).kind).toBe('none');
    expect(decideUpdate(policy, 80).kind).toBe('none');
  });

  it('passes the custom message through to either prompt', () => {
    const withMessage = { ...policy, message: 'Spotify reposts are here' };
    expect(decideUpdate(withMessage, 76)).toEqual({ kind: 'hard', message: 'Spotify reposts are here' });
    expect(decideUpdate(withMessage, 78)).toMatchObject({ message: 'Spotify reposts are here' });
  });

  it('says nothing without a policy', () => {
    expect(decideUpdate(null, 1).kind).toBe('none');
  });

  it('the seed rows (0, 0) are inert', () => {
    expect(decideUpdate({ latestBuild: 0, minimumBuild: 0, message: null }, 77).kind).toBe('none');
  });
});

describe('fetchUpdatePolicy', () => {
  it("reads this platform's row", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { latest_build: 79, minimum_build: 77, message: '  New: Spotify reposts  ' },
      error: null,
    });
    await expect(fetchUpdatePolicy('android')).resolves.toEqual({
      latestBuild: 79,
      minimumBuild: 77,
      message: 'New: Spotify reposts',
    });
    expect(mockFrom).toHaveBeenCalledWith('app_update_policy');
    expect(mockEq).toHaveBeenCalledWith('platform', 'android');
  });

  it('treats a blank message as none', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { latest_build: 1, minimum_build: 0, message: '   ' }, error: null });
    await expect(fetchUpdatePolicy('ios')).resolves.toMatchObject({ message: null });
  });

  it('fails open: an error, no row, or a throw is "no policy"', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'relation does not exist' } });
    await expect(fetchUpdatePolicy('ios')).resolves.toBeNull();
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchUpdatePolicy('ios')).resolves.toBeNull();
    mockMaybeSingle.mockRejectedValueOnce(new Error('Network request failed'));
    await expect(fetchUpdatePolicy('ios')).resolves.toBeNull();
  });

  it('never asks on a platform with no store row', async () => {
    await expect(fetchUpdatePolicy('web')).resolves.toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('Later', () => {
  const T0 = 1_760_000_000_000;

  it('snoozes that build for three days', async () => {
    snoozeUpdate(79, T0);
    await Promise.resolve();
    await expect(isUpdateSnoozed(79, T0 + SNOOZE_MS - 1)).resolves.toBe(true);
    await expect(isUpdateSnoozed(79, T0 + SNOOZE_MS)).resolves.toBe(false);
  });

  it('a newer release asks again straight away', async () => {
    snoozeUpdate(79, T0);
    await Promise.resolve();
    await expect(isUpdateSnoozed(80, T0 + 1000)).resolves.toBe(false);
  });

  it('nothing saved, or garbage saved, is not snoozed', async () => {
    await expect(isUpdateSnoozed(79, T0)).resolves.toBe(false);
    await AsyncStorage.setItem('livil.update.snooze.v1', '{not json');
    await expect(isUpdateSnoozed(79, T0)).resolves.toBe(false);
  });
});

describe('storeUrls', () => {
  it('iPhone goes to the App Store only', () => {
    expect(storeUrls('ios')).toEqual({ primary: APP_STORE_APP_URL, fallback: APP_STORE_URL });
  });

  it('Android goes to Google Play only', () => {
    expect(storeUrls('android')).toEqual({ primary: PLAY_STORE_APP_URL, fallback: PLAY_STORE_WEB_URL });
  });
});
