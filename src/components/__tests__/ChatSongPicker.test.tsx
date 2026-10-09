/**
 * The chat song popover is anchored to the composer and grows UPWARD with its content, so
 * emptying the result lists on every keystroke collapsed it to a spinner and regrew it a
 * moment later — once per letter typed. These pin "keep the rows until the new ones
 * arrive", and that keeping them never lets an OLDER query's answer win.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ActivityIndicator, Text } from 'react-native';

// Reanimated's real module (and its own mock) load the native worklet runtime; the popover
// animation is not under test, so the names ChatSongPicker uses are stubbed.
jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: { View },
    Easing: { in: (f: unknown) => f, out: (f: unknown) => f, quad: (x: number) => x },
    interpolate: () => 1,
    runOnJS: (fn: unknown) => fn,
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => false,
    useSharedValue: (v: number) => ({ value: v }),
    withSequence: () => 1,
    withSpring: (v: number) => v,
    withTiming: (v: number) => v,
  };
});
jest.mock('../Icon', () => ({ Icon: () => null }));
jest.mock('../SpotifyLogo', () => ({ SpotifyLogo: () => null }));

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

const mockSearchPosts = jest.fn();
jest.mock('../../services/posts', () => ({
  searchPosts: (...a: unknown[]) => mockSearchPosts(...a),
  isPlayableInLivil: () => true,
}));
jest.mock('../../services/tracks', () => ({
  listRecentTracksForLibrary: jest.fn(async () => []),
}));
const mockSearchSpotify = jest.fn();
jest.mock('../../services/spotify', () => ({
  artistLine: (t: { artists?: string[] }) => (t.artists ?? []).join(', '),
  searchSpotify: (...a: unknown[]) => mockSearchSpotify(...a),
  useSpotifyAvailability: () => ({ search: true, reposts: false }),
}));

import ChatSongPicker from '../ChatSongPicker';

const post = (id: string, title: string) => ({
  id,
  author: { username: 'riya', displayName: 'Riya' },
  track: { title, coverArtUrl: null, thumbnailUrl: null },
});
const spotifyTrack = (id: string, title: string) => ({ id, title, artists: ['Someone'], imageUrl: null });

function mount(query: string) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <ChatSongPicker open query={query} onPick={jest.fn()} bottom={64} originX={23} />,
    );
  });
  return tree;
}

function setQuery(tree: TestRenderer.ReactTestRenderer, query: string) {
  act(() => {
    tree.update(<ChatSongPicker open query={query} onPick={jest.fn()} bottom={64} originX={23} />);
  });
}

const texts = (t: TestRenderer.ReactTestRenderer) =>
  t.root.findAllByType(Text).map(n => n.props.children)
    .filter((c): c is string => typeof c === 'string');

async function advance(ms: number) {
  await act(async () => { jest.advanceTimersByTime(ms); });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockSearchPosts.mockReset();
  mockSearchSpotify.mockReset();
  mockSearchSpotify.mockResolvedValue([]);
});
afterEach(() => { jest.useRealTimers(); });

describe('ChatSongPicker results', () => {
  it('keeps the previous rows on screen while the next query loads, then replaces them', async () => {
    mockSearchPosts.mockResolvedValueOnce([post('a', 'Midnight Loop')]);
    const tree = mount('mi');
    await advance(500);
    expect(texts(tree)).toContain('Midnight Loop');

    const next = deferred<unknown[]>();
    mockSearchPosts.mockReturnValueOnce(next.promise);
    setQuery(tree, 'mid');
    await advance(500);
    // Still the old row — not collapsed to the full spinner.
    expect(texts(tree)).toContain('Midnight Loop');
    expect(texts(tree)).toContain('On Livil');

    await act(async () => { next.resolve([post('b', 'Midday Sun')]); });
    expect(texts(tree)).toContain('Midday Sun');
    expect(texts(tree)).not.toContain('Midnight Loop');
  });

  it('a slower answer for an OLDER query never overwrites the newer one', async () => {
    const older = deferred<unknown[]>();
    const newer = deferred<unknown[]>();
    mockSearchPosts.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    const tree = mount('mi');
    await advance(300); // the 'mi' request is out
    setQuery(tree, 'mid');
    await advance(300); // the 'mid' request is out

    await act(async () => { newer.resolve([post('n', 'Newer Song')]); });
    await act(async () => { older.resolve([post('o', 'Older Song')]); });
    expect(texts(tree)).toContain('Newer Song');
    expect(texts(tree)).not.toContain('Older Song');
  });

  it('shows the full spinner only while there is nothing to show yet', async () => {
    const first = deferred<unknown[]>();
    mockSearchPosts.mockReturnValueOnce(first.promise);
    const tree = mount('mi');
    await advance(300);
    expect(tree.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);
    expect(texts(tree)).not.toContain('On Livil');

    await act(async () => { first.resolve([post('a', 'Midnight Loop')]); });
    await advance(500); // Spotify answers (empty) too
    expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  });

  it('keeps Spotify rows the same way', async () => {
    mockSearchPosts.mockResolvedValue([]);
    mockSearchSpotify.mockResolvedValueOnce([spotifyTrack('s1', 'Blinding Lights')]);
    const tree = mount('bl');
    await advance(500);
    expect(texts(tree)).toContain('Blinding Lights');

    const next = deferred<unknown[]>();
    mockSearchSpotify.mockReturnValueOnce(next.promise);
    setQuery(tree, 'bli');
    await advance(500);
    expect(texts(tree)).toContain('Blinding Lights');

    await act(async () => { next.resolve([spotifyTrack('s2', 'Bliss')]); });
    expect(texts(tree)).toContain('Bliss');
    expect(texts(tree)).not.toContain('Blinding Lights');
  });

  it('dropping below two characters clears the results back to Recently played', async () => {
    mockSearchPosts.mockResolvedValueOnce([post('a', 'Midnight Loop')]);
    const tree = mount('mi');
    await advance(500);
    setQuery(tree, 'm');
    await advance(500);
    expect(texts(tree)).not.toContain('Midnight Loop');
    expect(texts(tree)).toContain('Recently played');
  });
});
