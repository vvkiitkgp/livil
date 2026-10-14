/**
 * The New on Livil dot. Compared in server time (the newest upload against the marker left
 * at the last visit), so a phone clock cannot fake it; while the tab is open a newer upload
 * refreshes the list instead of lighting a dot; and every failure leaves the dot off.
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

function mount(onTab: boolean, onNewWhileOpen = jest.fn()) {
  const api: { current: Api | null } = { current: null };
  function Probe() {
    api.current = useNewOnLivilDot({ isOnTab: () => onTab, onNewWhileOpen });
    return null;
  }
  act(() => { TestRenderer.create(<Probe />); });
  return api as { current: Api };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSetItem.mockResolvedValue(undefined);
});

it('lights when someone uploaded after the last visit, and not before', async () => {
  mockNewest.mockResolvedValue('2026-10-14T10:00:00Z');
  mockGetItem.mockResolvedValue('2026-10-14T09:00:00Z');
  const dot = mount(false);
  await act(async () => { await dot.current.refresh(); });
  expect(dot.current.newDot).toBe(true);

  mockGetItem.mockResolvedValue('2026-10-14T10:00:00Z');
  await act(async () => { await dot.current.refresh(); });
  expect(dot.current.newDot).toBe(false);
});

it('while the tab is open, refreshes the list instead, and moves the marker', async () => {
  mockNewest.mockResolvedValue('2026-10-14T10:00:00Z');
  mockGetItem.mockResolvedValue('2026-10-14T09:00:00Z');
  const onNew = jest.fn();
  const dot = mount(true, onNew);
  await act(async () => { await dot.current.refresh(); });

  expect(onNew).toHaveBeenCalledTimes(1);
  expect(dot.current.newDot).toBe(false);
  expect(mockSetItem).toHaveBeenCalledWith(newOnLivilSeenKey('me'), '2026-10-14T10:00:00Z');
});

it('marks seen with the newest upload\'s own time, never the phone clock', async () => {
  mockNewest.mockResolvedValue('2026-10-14T10:00:00Z');
  const dot = mount(false);
  await act(async () => { dot.current.markSeen(); await Promise.resolve(); await Promise.resolve(); });
  expect(mockSetItem).toHaveBeenCalledWith(newOnLivilSeenKey('me'), '2026-10-14T10:00:00Z');
});

it('stays off when the newest upload cannot be read', async () => {
  mockNewest.mockResolvedValue(null);
  const dot = mount(false);
  await act(async () => { await dot.current.refresh(); });
  expect(dot.current.newDot).toBe(false);
});
