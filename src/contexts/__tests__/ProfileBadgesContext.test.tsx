/**
 * Tests for the badge cache — specifically that it BATCHES.
 *
 * The rendering is trivial; the fetching is the whole feature. A feed of twenty posts must
 * cost one request, not twenty, and every way of getting that wrong is invisible on screen:
 * the badges still appear, just after N round trips instead of one. Nothing about the UI
 * would tell you, which is why these assert on the calls rather than the output.
 *
 * Four properties, each of which regresses silently:
 *
 *   1. Ids registered together become ONE call.
 *   2. An id already known is never asked about twice — including users with NO badges,
 *      who are the majority and would otherwise be re-requested forever.
 *   3. A resolved batch actually re-renders consumers. The cache is a ref, so a context
 *      value that did not change identity would leave the badge in memory and off screen.
 *   4. A failed fetch yields no badges rather than throwing, because a badge outage must
 *      never blank a feed.
 */

const mockFetch = jest.fn();
jest.mock('../../services/profileBadges', () => ({
  fetchProfileBadges: (ids: string[]) => mockFetch(ids),
  PROFILE_BADGES: ['first_100', 'verified'],
}));

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import { ProfileBadgesProvider, useBadgesFor } from '../ProfileBadgesContext';

/** Renders the badge list for one user as text, so a test can read what it resolved to. */
function Row({ userId }: { userId: string }) {
  const badges = useBadgesFor(userId);
  return <Text>{`${userId}:${badges.join(',')}`}</Text>;
}

function renderRows(ids: string[]) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ProfileBadgesProvider>
        {ids.map(id => <Row key={id} userId={id} />)}
      </ProfileBadgesProvider>,
    );
  });
  return tree;
}

const text = (tree: ReactTestRenderer.ReactTestRenderer) =>
  JSON.stringify(tree.toJSON());

beforeEach(() => {
  jest.useFakeTimers();
  mockFetch.mockReset().mockResolvedValue({});
});

afterEach(() => {
  jest.useRealTimers();
});

/** Let the debounce fire and the promise settle. */
async function settle() {
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(60);
    await Promise.resolve();
  });
}

describe('ProfileBadgesContext', () => {
  it('collapses a screenful of rows into ONE request', async () => {
    renderRows(['a', 'b', 'c', 'd', 'e']);
    await settle();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('asks nothing at all before the window closes', () => {
    renderRows(['a', 'b']);
    // The point of the debounce: a FlatList mounts rows across frames, and firing per
    // frame would be barely better than firing per row.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('renders the badges once the batch lands', async () => {
    mockFetch.mockResolvedValue({ a: ['first_100', 'verified'] });
    const tree = renderRows(['a', 'b']);

    // Before: nothing known yet.
    expect(text(tree)).toContain('a:');
    await settle();

    // After: the ref changed AND the consumer re-rendered. A context value that kept its
    // identity would fail here while the cache was perfectly correct.
    expect(text(tree)).toContain('a:first_100,verified');
  });

  it('never asks about the same user twice', async () => {
    const tree = renderRows(['a']);
    await settle();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    ReactTestRenderer.act(() => { tree.update(
      <ProfileBadgesProvider><Row userId="a" /></ProfileBadgesProvider>,
    ); });
    await settle();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('remembers that a user has NO badges, and stops asking', async () => {
    // The majority case. Caching only the users who came back would re-request everyone
    // else on every render — most of the traffic, for a permanently empty answer.
    mockFetch.mockResolvedValue({});
    const tree = renderRows(['a']);
    await settle();

    ReactTestRenderer.act(() => { tree.update(
      <ProfileBadgesProvider><Row userId="a" /><Row userId="b" /></ProfileBadgesProvider>,
    ); });
    await settle();

    // A second call, for 'b' ALONE — 'a' is settled as "no badges" and not re-asked.
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toEqual(['b']);
  });

  it('still works after a remount — the mounted flag must reset', async () => {
    // Fast Refresh remounts providers constantly in development, and React 18 StrictMode
    // mounts every effect twice. A `mounted` ref set false on cleanup and never back to
    // true would stay false forever: batches fetch correctly, discard the result at the
    // mounted check, and no badge ever appears again. Nothing is logged, and the cache
    // looks fine in isolation — which is exactly how this shipped past unit tests.
    mockFetch.mockResolvedValue({ a: ['verified'] });
    const tree = renderRows(['a']);

    // Force the cleanup-then-mount cycle by swapping the tree out and back.
    ReactTestRenderer.act(() => { tree.update(<Text>gone</Text>); });
    ReactTestRenderer.act(() => { tree.update(
      <ProfileBadgesProvider><Row userId="a" /></ProfileBadgesProvider>,
    ); });
    await settle();

    expect(text(tree)).toContain('a:verified');
  });

  it('survives a rejected fetch and RETRIES those users later', async () => {
    // fetchProfileBadges is documented as fail-safe, so this should be unreachable — but a
    // `void flush()` makes a future regression an unhandled rejection, and worse, ids left
    // marked "known" with nothing cached would never be asked about again. That is a whole
    // session with no badges for those users, from one bad request.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    const tree = renderRows(['a']);
    await settle();

    expect(text(tree)).toContain('a:');            // no badge, no crash

    // The retry: 'a' was un-known, so re-rendering asks again rather than staying blank.
    mockFetch.mockResolvedValue({ a: ['verified'] });
    ReactTestRenderer.act(() => { tree.update(
      <ProfileBadgesProvider><Row userId="a" /></ProfileBadgesProvider>,
    ); });
    await settle();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(text(tree)).toContain('a:verified');
    warn.mockRestore();
  });
});
