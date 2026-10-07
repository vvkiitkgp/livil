const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(async (k: string, v: string) => { mockStore.set(k, v); }),
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { RETURNING_LISTENER_KEY, markSignedInHere, wasSignedInHere } from '../returningListener';

beforeEach(() => mockStore.clear());

test('a fresh install is not a returning listener', async () => {
  expect(await wasSignedInHere()).toBe(false);
});

test('a session on this install makes them a returning listener', async () => {
  await markSignedInHere();
  expect(await wasSignedInHere()).toBe(true);
});

test('the key survives the sign-out wipe of @livil: keys', () => {
  expect(RETURNING_LISTENER_KEY.startsWith('@livil:')).toBe(false);
});

test('a storage failure falls back to the first-time greeting', async () => {
  (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('disk'));
  expect(await wasSignedInHere()).toBe(false);
});
