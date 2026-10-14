/**
 * Home's two feeds share one loader (useHomeFeed). What must hold for BOTH tabs:
 *
 *  • each tab asks the server for its own feed — New on Livil must never get For you's rows;
 *  • every page of one pass sends the SAME session (the ranking stays still while scrolling)
 *    and a refresh mints a new one (pulling down actually re-ranks);
 *  • pages append without repeats, and pagination stops when the cursor runs out;
 *  • a failed first load says so instead of showing an empty feed.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockFetch = jest.fn();
jest.mock('../../services/posts', () => {
  let n = 0;
  return {
    fetchHomeFeedPage: (...a: unknown[]) => mockFetch(...a),
    newHomeFeedSession: () => ({ seed: ++n, startedAt: `2026-10-14T10:00:0${n}Z` }),
  };
});

import { useHomeFeed } from '../useHomeFeed';
import type { HomeFeedTab } from '../../services/posts';

type Api = ReturnType<typeof useHomeFeed>;

const post = (id: string) => ({ id, track: { id: `t-${id}` }, author: { id: 'a' } });

function mount(tab: HomeFeedTab, opts: Partial<Parameters<typeof useHomeFeed>[1]> = {}) {
  const api: { current: Api | null } = { current: null };
  function Probe() {
    api.current = useHomeFeed(tab, { pageSize: 2, ...opts });
    return null;
  }
  act(() => { TestRenderer.create(<Probe />); });
  return api as { current: Api };
}

beforeEach(() => mockFetch.mockReset());

it('asks the server for the tab it belongs to', async () => {
  mockFetch.mockResolvedValue({ posts: [], nextCursor: null });
  const newTab = mount('new_on_livil');
  const forYou = mount('for_you');
  await act(async () => { await newTab.current.appendFeedPage('initial'); });
  await act(async () => { await forYou.current.appendFeedPage('initial'); });

  expect(mockFetch.mock.calls[0][0]).toEqual(expect.objectContaining({ tab: 'new_on_livil' }));
  expect(mockFetch.mock.calls[1][0]).toEqual(expect.objectContaining({ tab: 'for_you' }));
});

it('keeps one session across a pass and mints a new one on refresh', async () => {
  const cursor = { bucket: 1, sortKey: 2, id: 'p2' };
  mockFetch
    .mockResolvedValueOnce({ posts: [post('p1'), post('p2')], nextCursor: cursor })
    .mockResolvedValueOnce({ posts: [post('p3')], nextCursor: null })
    .mockResolvedValueOnce({ posts: [post('p4')], nextCursor: null });
  const onNewPass = jest.fn();
  const feed = mount('new_on_livil', { onNewPass });

  await act(async () => { await feed.current.appendFeedPage('initial'); });
  await act(async () => { await feed.current.appendFeedPage('prefetch'); });
  const [first, second] = mockFetch.mock.calls.map(c => c[0]);
  expect(second.session).toEqual(first.session);
  expect(second.cursor).toEqual(cursor);
  expect(feed.current.posts.map(p => p.id)).toEqual(['p1', 'p2', 'p3']);
  expect(feed.current.endOfFeed).toBe(true);

  await act(async () => { await feed.current.appendFeedPage('refresh'); });
  const third = mockFetch.mock.calls[2][0];
  expect(third.session).not.toEqual(first.session);
  expect(third.cursor).toBeNull();
  expect(onNewPass).toHaveBeenCalledTimes(2);
});

it('does not page past the end, and drops a post the next page repeats', async () => {
  mockFetch
    .mockResolvedValueOnce({ posts: [post('p1'), post('p2')], nextCursor: { bucket: 1, sortKey: 1, id: 'p2' } })
    .mockResolvedValueOnce({ posts: [post('p2'), post('p3')], nextCursor: null });
  const feed = mount('for_you');
  await act(async () => { await feed.current.appendFeedPage('initial'); });
  await act(async () => { await feed.current.appendFeedPage('end'); });
  await act(async () => { await feed.current.appendFeedPage('end'); });

  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(feed.current.posts.map(p => p.id)).toEqual(['p1', 'p2', 'p3']);
});

it('says why when the first load fails', async () => {
  mockFetch.mockRejectedValueOnce(new Error('Could not find the function public.fetch_new_on_livil'));
  const feed = mount('new_on_livil');
  await act(async () => { await feed.current.appendFeedPage('initial'); });

  expect(feed.current.feedError).toMatch(/fetch_new_on_livil/);
  expect(feed.current.loadingInitial).toBe(false);
  expect(feed.current.posts).toEqual([]);
  // A missing function means the backend is not there yet: Home hides the tab.
  expect(feed.current.unavailable).toBe(true);
});

it('does not call an ordinary failure "unavailable"', async () => {
  mockFetch.mockRejectedValueOnce(new Error('Network request failed'));
  const feed = mount('new_on_livil');
  await act(async () => { await feed.current.appendFeedPage('initial'); });
  expect(feed.current.unavailable).toBe(false);
});

it('remembers whether it has been opened (New on Livil loads on first visit)', async () => {
  mockFetch.mockResolvedValue({ posts: [], nextCursor: null });
  const feed = mount('new_on_livil');
  expect(feed.current.startedRef.current).toBe(false);
  await act(async () => { await feed.current.appendFeedPage('initial'); });
  expect(feed.current.startedRef.current).toBe(true);
});
