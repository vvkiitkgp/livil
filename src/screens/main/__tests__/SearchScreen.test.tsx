/**
 * Search used to swap its results list for a full-screen spinner whenever a search was
 * loading — and `loading` goes true synchronously on every keystroke, before the 200 ms
 * debounce. So while anyone typed there was no list to scroll, and every answer remounted
 * it at the top. These pin "keep the rows until the new ones arrive": the full spinner only
 * when there is nothing to show, a Spotify-only query never claims "Nothing matches", and
 * an OLDER query's answer never replaces a newer one's.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ActivityIndicator, FlatList, Text, TextInput } from 'react-native';

// The real module loads the native worklet runtime. Only the recent-search pills animate,
// so the names SearchScreen imports are stubbed; builders chain (`.delay().duration()`).
jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual('react-native');
  const builder: Record<string, unknown> = {};
  builder.delay = () => builder;
  builder.duration = () => builder;
  return {
    __esModule: true,
    default: { View },
    FadeInDown: builder,
    FadeOut: builder,
    LinearTransition: builder,
  };
});
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
// Stable across renders: the screen re-subscribes `tabPress` whenever `navigation` changes.
const mockNavigation = { navigate: jest.fn(), addListener: jest.fn(() => () => {}) };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));

jest.mock('../../../components/Icon', () => ({ Icon: () => null }));
jest.mock('../../../components/SpotifyLogo', () => ({ SpotifyLogo: () => null }));
jest.mock('../../../components/SpotifyTrackSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../components/AddBadge', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../components/UsernameBadges', () => ({ __esModule: true, default: () => null }));
// Only the height is imported; the real module would pull in the whole player.
jest.mock('../../../components/FloatingPlayer', () => ({ FLOATING_PLAYER_HEIGHT: 64 }));

const mockSearchPosts = jest.fn();
jest.mock('../../../services/posts', () => ({
  searchPosts: (...a: unknown[]) => mockSearchPosts(...a),
  feedPostToNowPlaying: jest.fn(),
  fetchPostsByIds: async () => [],
  listNewestUploads: async () => [],
}));
jest.mock('../../../services/tracks', () => ({ searchProfiles: async () => [] }));
jest.mock('../../../services/albums', () => ({
  searchAlbums: async () => [],
  fetchAlbumsByIds: async () => [],
}));
jest.mock('../../../services/searchDiscover', () => ({
  fetchDiscoverPeople: async () => ({ friends: [], people: [], artists: [] }),
  dismissSuggestion: async () => {},
}));
jest.mock('../../../services/searchAnalytics', () => ({
  recordSearchTap: () => {},
  fetchSearchPopularity: async () => ({}),
}));
const mockSearchSpotify = jest.fn();
jest.mock('../../../services/spotify', () => ({
  artistLine: (t: { artists?: string[] }) => (t.artists ?? []).join(', '),
  rememberSpotifyTrack: () => {},
  searchSpotify: (...a: unknown[]) => mockSearchSpotify(...a),
  useSpotifyAvailability: () => ({ search: true, reposts: false }),
}));
jest.mock('../../../../lib/supabase', () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: { id: 'me' } } }) } },
}));

jest.mock('../../../contexts/PlaybackContext', () => ({
  usePlayback: () => ({
    nowPlaying: null,
    setQueue: () => {},
    setNowPlaying: () => {},
    requestPlay: () => {},
    markSeekTarget: () => {},
    handlersRef: { current: null },
  }),
}));
jest.mock('../../../hooks/usePlayFullScreen', () => ({ usePlayFullScreen: () => () => {} }));
jest.mock('../../../hooks/useRecentSearches', () => ({
  useRecentSearches: () => ({ recents: [], remember: () => {}, forget: () => {} }),
}));
jest.mock('../../../hooks/useRecentSearchOpens', () => {
  // One array for every render: `recentOpens` is an effect dependency, and a fresh `[]`
  // each render would re-run that effect (and its setState) forever.
  const none: never[] = [];
  return { useRecentSearchOpens: () => ({ recentOpens: none, rememberOpen: () => {} }) };
});
jest.mock('../../../hooks/useOpenInSpotify', () => ({ useOpenInSpotify: () => async () => {} }));
jest.mock('../../../hooks/useRunAfterDismiss', () => ({
  useRunAfterDismiss: () => ({ runAfterDismiss: (fn: () => void) => fn(), onDismiss: () => {} }),
}));

import SearchScreen from '../SearchScreen';
import FormInput from '../../../components/FormInput';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

const post = (id: string, title: string) => ({
  id,
  clipStartSec: null,
  author: { id: 'u-riya', username: 'riya', displayName: 'Riya', avatarUrl: null },
  track: { id: `t-${id}`, title, coverArtUrl: null, thumbnailUrl: null, durationSeconds: 200 },
});
const spotifyTrack = (id: string, title: string) => ({ id, title, artists: ['The Weeknd'], imageUrl: null });

async function mount() {
  let tree!: TestRenderer.ReactTestRenderer;
  // Async so `getUser` settles first: `meId` arriving later would restart the search.
  await act(async () => { tree = TestRenderer.create(<SearchScreen />); });
  return tree;
}

function type(tree: TestRenderer.ReactTestRenderer, text: string) {
  act(() => { tree.root.findByType(TextInput).props.onChangeText(text); });
}

async function advance(ms: number) {
  await act(async () => { jest.advanceTimersByTime(ms); });
}

/** Every Text's own string content, so `Nothing matches "{q}".` reads as one string. */
const texts = (t: TestRenderer.ReactTestRenderer) =>
  t.root.findAllByType(Text).map(n => [n.props.children].flat()
    .filter(c => typeof c === 'string').join(''));

/** The spinner that REPLACES the list, vs the small one in the field's trailing slot. */
function spinners(t: TestRenderer.ReactTestRenderer) {
  const inField = t.root.findByType(FormInput).findAllByType(ActivityIndicator).length;
  return { full: t.root.findAllByType(ActivityIndicator).length - inField, inField };
}

const titlesInList = (list: TestRenderer.ReactTestInstance) =>
  (list.props.data as { post: { track: { title: string } } }[]).map(r => r.post.track.title);

// The first test mounts the whole SearchScreen cold. On a GitHub runner that alone ran past
// jest's default 5 s (the file took 8.3 s there; well under 1 s locally), failing a test
// whose assertions all hold. Nothing here waits on real time — the timers are fake.
jest.setTimeout(20_000);

beforeEach(() => {
  jest.useFakeTimers();
  mockSearchPosts.mockReset();
  mockSearchSpotify.mockReset();
  mockSearchSpotify.mockResolvedValue([]);
});
afterEach(() => { jest.useRealTimers(); });

describe('SearchScreen while a search is loading', () => {
  it('keeps the previous rows mounted, and scrollable, while the next query loads', async () => {
    mockSearchPosts.mockResolvedValueOnce([post('p1', 'Midnight Drive')]);
    const tree = await mount();
    type(tree, 'mid');
    await advance(500); // past both debounces (200 ms Livil, 450 ms Spotify)
    expect(texts(tree)).toContain('Midnight Drive');
    const list = tree.root.findByType(FlatList);

    const next = deferred<unknown[]>();
    mockSearchPosts.mockReturnValueOnce(next.promise);
    type(tree, 'midn');
    await advance(500); // the 'midn' request is out and unanswered
    // The same list instance, still holding the old row — not a spinner in its place.
    expect(tree.root.findAllByType(FlatList)).toHaveLength(1);
    expect(tree.root.findByType(FlatList).instance).toBe(list.instance);
    expect(texts(tree)).toContain('Midnight Drive');
    // "Still searching" is the small cue beside the clear button.
    expect(spinners(tree)).toEqual({ full: 0, inField: 1 });

    await act(async () => { next.resolve([post('p2', 'Midnight Train')]); });
    expect(texts(tree)).toContain('Midnight Train');
    expect(texts(tree)).not.toContain('Midnight Drive');
    expect(spinners(tree)).toEqual({ full: 0, inField: 0 });
  });

  it('kept rows stay in the order of the query they answer, not the one being typed', async () => {
    // For 'mid', "Mid" is exact and "Midnight Drive" a prefix. Ranked by the live 'midn',
    // "Midnight Drive" would jump above "Mid" under the finger.
    mockSearchPosts.mockResolvedValueOnce([post('p1', 'Midnight Drive'), post('p2', 'Mid')]);
    const tree = await mount();
    type(tree, 'mid');
    await advance(500);
    expect(titlesInList(tree.root.findByType(FlatList))).toEqual(['Mid', 'Midnight Drive']);

    mockSearchPosts.mockReturnValueOnce(deferred<unknown[]>().promise);
    type(tree, 'midn');
    await advance(500);
    expect(titlesInList(tree.root.findByType(FlatList))).toEqual(['Mid', 'Midnight Drive']);
  });

  it('shows the full spinner only while there is nothing to show yet', async () => {
    const first = deferred<unknown[]>();
    mockSearchPosts.mockReturnValueOnce(first.promise);
    const tree = await mount();
    type(tree, 'mid');
    await advance(500);
    expect(spinners(tree)).toEqual({ full: 1, inField: 0 });
    expect(tree.root.findAllByType(FlatList)).toHaveLength(0);

    await act(async () => { first.resolve([post('p1', 'Midnight Drive')]); });
    expect(spinners(tree)).toEqual({ full: 0, inField: 0 });
    expect(texts(tree)).toContain('Midnight Drive');
  });

  it('a Spotify-only query spins, never says "Nothing matches", until Spotify answers', async () => {
    mockSearchPosts.mockResolvedValue([]);
    const answer = deferred<unknown[]>();
    mockSearchSpotify.mockReturnValueOnce(answer.promise);
    const tree = await mount();
    type(tree, 'blinding');
    const nothingMatches = () => texts(tree).some(s => s.startsWith('Nothing matches'));

    await advance(300); // Livil answered (empty); Spotify's 450 ms debounce still running
    expect(spinners(tree)).toEqual({ full: 1, inField: 0 });
    expect(nothingMatches()).toBe(false);
    await advance(300); // Spotify's request is out and unanswered
    expect(spinners(tree)).toEqual({ full: 1, inField: 0 });
    expect(nothingMatches()).toBe(false);

    await act(async () => { answer.resolve([spotifyTrack('s1', 'Blinding Lights')]); });
    expect(texts(tree)).toContain('On Spotify');
    expect(texts(tree)).toContain('Blinding Lights');
    expect(nothingMatches()).toBe(false);
    expect(spinners(tree)).toEqual({ full: 0, inField: 0 });
  });

  it("an older query's slower answer never replaces the newer query's rows", async () => {
    const older = deferred<unknown[]>();
    const newer = deferred<unknown[]>();
    mockSearchPosts.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const tree = await mount();
    type(tree, 'mi');
    await advance(300); // the 'mi' request is out
    type(tree, 'mid');
    await advance(300); // the 'mid' request is out
    expect(mockSearchPosts.mock.calls.map(c => c[0])).toEqual(['mi', 'mid']);

    await act(async () => { newer.resolve([post('n', 'Midday Sun')]); });
    await act(async () => { older.resolve([post('o', 'Mirror Mirror')]); });
    expect(texts(tree)).toContain('Midday Sun');
    expect(texts(tree)).not.toContain('Mirror Mirror');
  });

  it('keeps Spotify-only rows mounted while the next query loads', async () => {
    // Spotify rows used to be cleared on every keystroke, so when they were all there was,
    // the list unmounted for the spinner — the same bug, through the other section.
    mockSearchPosts.mockResolvedValue([]);
    mockSearchSpotify.mockResolvedValueOnce([spotifyTrack('s1', 'Blinding Lights')]);
    const tree = await mount();
    type(tree, 'blinding');
    await advance(600);
    expect(texts(tree)).toContain('Blinding Lights');
    const list = tree.root.findByType(FlatList);

    const next = deferred<unknown[]>();
    mockSearchSpotify.mockReturnValueOnce(next.promise);
    type(tree, 'blinding l');
    await advance(600); // Livil answered (empty), Spotify's request out and unanswered
    expect(tree.root.findByType(FlatList).instance).toBe(list.instance);
    expect(texts(tree)).toContain('Blinding Lights');
    expect(spinners(tree)).toEqual({ full: 0, inField: 1 });

    await act(async () => { next.resolve([spotifyTrack('s2', 'Blinding Lights (Remix)')]); });
    expect(texts(tree)).toContain('Blinding Lights (Remix)');
    expect(texts(tree)).not.toContain('Blinding Lights');
  });

  it("never shows the previous query's Spotify rows under the new query's Livil rows", async () => {
    mockSearchPosts.mockResolvedValueOnce([post('p1', 'Midnight Drive')]);
    mockSearchSpotify.mockResolvedValueOnce([spotifyTrack('s1', 'Mid Air')]);
    const tree = await mount();
    type(tree, 'mid');
    await advance(600);
    expect(texts(tree)).toEqual(expect.arrayContaining(['Midnight Drive', 'Mid Air']));

    const spotifyNext = deferred<unknown[]>();
    mockSearchPosts.mockResolvedValueOnce([post('p2', 'Midnight Train')]);
    mockSearchSpotify.mockReturnValueOnce(spotifyNext.promise);
    type(tree, 'midn');
    await advance(300); // Livil answered 'midn'; Spotify still on its debounce
    expect(texts(tree)).toContain('Midnight Train');
    expect(texts(tree)).not.toContain('Mid Air');

    await advance(300);
    await act(async () => { spotifyNext.resolve([spotifyTrack('s2', 'Midnight City')]); });
    expect(texts(tree)).toEqual(expect.arrayContaining(['Midnight Train', 'Midnight City']));
  });
});
