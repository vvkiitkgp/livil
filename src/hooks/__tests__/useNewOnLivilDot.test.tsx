/**
 * The New on Livil dot means "an upload newer than your New on Livil list". The list only
 * reloads on a pull-to-refresh (owner decision), so the dot is cleared only by markSeen —
 * which Home calls on a pull or a first load — never by opening the tab. Compared in server
 * time, and every failure leaves it off.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockNewest = jest.fn();
const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
jest.mock('../../services/posts', () => ({ fetchNewestUploadAt: (...a: unknown[]) => mockNewest(...a) }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (...a: unknown[]) => mockGetItem(...a),
  setItem: (...a: unknown[]) => mockSetItem(...a),
}));
jest.mock('../../../lib/supabase', () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'me' } } } }) } },
}));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: () => {} }));

import { useNewOnLivilDot, newOnLivilSeenKey } from '../useNewOnLivilDot';

type Api = ReturnType<typeof useNewOnLivilDot>;

function mount() {
  const api: { current: Api | null } = { current: null };
  function Probe() {
    api.current = useNewOnLivilDot();
    return null;
  }
  act(() => { TestRenderer.create(<Probe />); });
  return api as { current: Api };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSetItem.mockResolvedValue(undefined);
});

it('lights when someone uploaded after the list was last loaded, and not before', async () => {
  mockNewest.mockResolvedValue('2026-10-14T10:00:00Z');
  mockGetItem.mockResolvedValue('2026-10-14T09:00:00Z');
  const dot = mount();
  await act(async () => { await dot.current.refresh(); });
  expect(dot.current.newDot).toBe(true);

  mockGetItem.mockResolvedValue('2026-10-14T10:00:00Z');
  await act(async () => { await dot.current.refresh(); });
  expect(dot.current.newDot).toBe(false);
});

it('stays lit across re-checks until the list is reloaded (markSeen)', async () => {
  mockNewest.mockResolvedValue('2026-10-14T10:00:00Z');
  mockGetItem.mockResolvedValue('2026-10-14T09:00:00Z');
  const dot = mount();
  await act(async () => { await dot.current.refresh(); });
  await act(async () => { await dot.current.refresh(); });
  expect(dot.current.newDot).toBe(true);
  expect(mockSetItem).not.toHaveBeenCalled();
});

it('a reload marks seen with the newest upload\'s own time, never the phone clock', async () => {
  mockNewest.mockResolvedValue('2026-10-14T10:00:00Z');
  const dot = mount();
  await act(async () => { dot.current.markSeen(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  expect(dot.current.newDot).toBe(false);
  expect(mockSetItem).toHaveBeenCalledWith(newOnLivilSeenKey('me'), '2026-10-14T10:00:00Z');
});

it('stays off when the newest upload cannot be read', async () => {
  mockNewest.mockResolvedValue(null);
  const dot = mount();
  await act(async () => { await dot.current.refresh(); });
  expect(dot.current.newDot).toBe(false);
});
