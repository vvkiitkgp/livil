/**
 * The chat list's "listening now" bars (owner, 2026-11-02): an iPhone listener swiped Livil
 * away and the bars stayed on a friend's chat list, while opening the chat showed nothing.
 * A killed app never writes "stopped", so the viewer must (1) re-read on every visit to a
 * screen that stays mounted and (2) always drop someone once their window has passed — even
 * when the expiry timer fires a moment early.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { ListeningNow } from '../../services/listeningStatus';

const mockFetch = jest.fn();
jest.mock('../../services/listeningStatus', () => ({
  fetchListeningNow: (...a: unknown[]) => mockFetch(...a),
  subscribeListeningChanges: () => () => {},
  extendListening: (e: unknown) => e,
}));

import { useListeningNow } from '../useListeningNow';

const riya = (expiresAtMs: number): ListeningNow => ({
  userId: 'riya',
  title: 'Kesariya',
  artistName: 'Arijit Singh',
  postId: 'p1',
  coverArtUrl: null,
  expiresAtMs,
});

function mount(token: { current: number }) {
  const out: { current: Map<string, ListeningNow> } = { current: new Map() };
  function Probe({ t }: { t: number }) {
    out.current = useListeningNow(['riya'], t);
    return null;
  }
  let r: TestRenderer.ReactTestRenderer;
  act(() => { r = TestRenderer.create(<Probe t={token.current} />); });
  return {
    out,
    focusAgain: () => {
      token.current += 1;
      act(() => { r.update(<Probe t={token.current} />); });
    },
  };
}

const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(1_000_000);
  mockFetch.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

it('re-reads on a new visit: a listener the server no longer has disappears at once', async () => {
  mockFetch.mockResolvedValueOnce([riya(Date.now() + 150_000)]);
  const { out, focusAgain } = mount({ current: 0 });
  await flush();
  expect(out.current.has('riya')).toBe(true);

  // Back on the chat list after opening the chat: the server says she stopped.
  mockFetch.mockResolvedValueOnce([]);
  focusAgain();
  await flush();
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(out.current.has('riya')).toBe(false);
});

it('does not read twice on mount', async () => {
  mockFetch.mockResolvedValue([]);
  mount({ current: 0 });
  await flush();
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('drops a listener once their window passes, even if the timer fired early', async () => {
  mockFetch.mockResolvedValueOnce([riya(Date.now() + 10_000)]);
  const { out } = mount({ current: 0 });
  await flush();
  expect(out.current.has('riya')).toBe(true);

  // The clock is set back 2 s (a clock correction), so when the timer fires nothing has
  // expired yet by Date.now(). It used to stop looking here for good.
  act(() => {
    jest.setSystemTime(Date.now() - 2_000);
    jest.advanceTimersByTime(10_250);
  });
  expect(out.current.has('riya')).toBe(true);

  // A few seconds later she must be gone, with no other event to wake the list.
  act(() => { jest.advanceTimersByTime(3_000); });
  expect(out.current.has('riya')).toBe(false);
});
