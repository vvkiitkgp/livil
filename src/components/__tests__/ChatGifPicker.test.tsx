/**
 * Chat GIF search loads the next page by itself near the bottom (no "More GIFs" button).
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ScrollView } from 'react-native';

jest.mock('react-native-reanimated', () => {
  const { View: V } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: { View: V },
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
jest.mock('../Button', () => ({ Button: () => null }));
jest.mock('../../services/posts', () => ({ isPlayableInLivil: () => true, searchPosts: jest.fn(async () => []) }));
jest.mock('../../services/tracks', () => ({ listRecentTracksForLibrary: jest.fn(async () => []) }));
jest.mock('../../services/spotify', () => ({
  artistLine: () => '', searchSpotify: jest.fn(async () => []), useSpotifyAvailability: () => ({ search: false, reposts: false }),
}));
const mockSearch = jest.fn();
jest.mock('../../services/gifs', () => ({ searchGifs: (q: string, o?: number) => mockSearch(q, o) }));

import ChatGifPicker from '../ChatGifPicker';

const page = (p: string, next: number | null) => ({
  gifs: Array.from({ length: 18 }, (_, i) => ({ id: `${p}${i}`, previewUrl: `https://media.giphy.com/${p}${i}.gif`, title: '' })),
  next,
});

function scrollTo(r: TestRenderer.ReactTestRenderer, y: number, contentH: number) {
  const sv = r.root.findByType(ScrollView);
  act(() => {
    sv.props.onScroll({ nativeEvent: { contentOffset: { x: 0, y }, layoutMeasurement: { width: 360, height: 340 }, contentSize: { width: 360, height: contentH } } });
  });
}

beforeEach(() => { jest.useFakeTimers(); mockSearch.mockReset(); });
afterEach(() => jest.useRealTimers());

it('near the bottom, the next page loads', async () => {
  mockSearch.mockResolvedValueOnce(page('a', 18)).mockResolvedValueOnce(page('b', 36));
  let r!: TestRenderer.ReactTestRenderer;
  act(() => { r = TestRenderer.create(<ChatGifPicker open query="" onPick={() => {}} bottom={64} originX={10} />); });
  act(() => { jest.advanceTimersByTime(0); });
  await act(async () => { await Promise.resolve(); });
  expect(mockSearch).toHaveBeenCalledTimes(1);

  scrollTo(r, 300, 640);
  await act(async () => { await Promise.resolve(); });
  expect(mockSearch).toHaveBeenLastCalledWith('', 18);
});

it('a new search (a fresh grid of the same height) still loads more — the old height guard never did', async () => {
  mockSearch
    .mockResolvedValueOnce(page('a', 18)).mockResolvedValueOnce(page('b', 36))
    .mockResolvedValueOnce(page('c', 18)).mockResolvedValueOnce(page('d', 36));
  let r!: TestRenderer.ReactTestRenderer;
  const picker = (query: string) => <ChatGifPicker open query={query} onPick={() => {}} bottom={64} originX={10} />;
  act(() => { r = TestRenderer.create(picker('')); });
  act(() => { jest.advanceTimersByTime(0); });
  await act(async () => { await Promise.resolve(); });
  scrollTo(r, 300, 640);
  await act(async () => { await Promise.resolve(); });
  expect(mockSearch).toHaveBeenCalledTimes(2);

  act(() => { r.update(picker('cat')); });
  act(() => { jest.advanceTimersByTime(400); });
  await act(async () => { await Promise.resolve(); });
  expect(mockSearch).toHaveBeenCalledTimes(3);
  scrollTo(r, 300, 640);
  await act(async () => { await Promise.resolve(); });
  expect(mockSearch).toHaveBeenCalledTimes(4);
  expect(mockSearch).toHaveBeenLastCalledWith('cat', 18);
});

it('a failed "more" is not retried on every scroll', async () => {
  mockSearch.mockResolvedValueOnce(page('a', 18)).mockResolvedValueOnce(null);
  let r!: TestRenderer.ReactTestRenderer;
  act(() => { r = TestRenderer.create(<ChatGifPicker open query="" onPick={() => {}} bottom={64} originX={10} />); });
  act(() => { jest.advanceTimersByTime(0); });
  await act(async () => { await Promise.resolve(); });
  for (let i = 0; i < 4; i++) {
    scrollTo(r, 300 + i, 640);
    await act(async () => { await Promise.resolve(); });
  }
  expect(mockSearch).toHaveBeenCalledTimes(2);
});
