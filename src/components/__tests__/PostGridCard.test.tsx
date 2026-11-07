/**
 * The profile grid card (Reposts / Uploads, 2 a row).
 *
 * What is pinned is the product decision, because each half fails quietly: a repost NEVER
 * carries a play count (under someone else's song a number reads as that song's plays) but
 * shows its own likes on the picture, an upload shows its likes and its song's total only when
 * there are any, Spotify art carries the likes and nothing else, and a tap plays the post from its clip
 * and opens the player — the same as the list card's artwork — or only opens the player when
 * the post is already playing. Only the picture does that; the details open the post.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text, View } from 'react-native';

jest.mock('../Icon', () => ({ Icon: () => null }));
jest.mock('../CoverFallback', () => () => null);

const mockPlayback = {
  activePostId: null as string | null,
  nowPlaying: null as { postId: string } | null,
  handlersRef: { current: null as null | { seek: jest.Mock; play: jest.Mock } },
  setNowPlaying: jest.fn(),
  markSeekTarget: jest.fn(),
  requestPlay: jest.fn(),
};
jest.mock('../../contexts/PlaybackContext', () => ({ usePlayback: () => mockPlayback }));
const mockOpenFullScreen = jest.fn();
jest.mock('../../hooks/usePlayFullScreen', () => ({ usePlayFullScreen: () => mockOpenFullScreen }));
const mockOpenSpotify = jest.fn(async () => {});
jest.mock('../../hooks/useOpenInSpotify', () => ({ useOpenInSpotify: () => mockOpenSpotify }));
const mockMe = { current: 'me' as string | null };
jest.mock('../../contexts/RelationshipContext', () => ({ useRelationships: () => ({ meId: mockMe.current }) }));
const KESARIYA = { id: 's1', title: 'Kesariya', artists: ['Arijit Singh', 'Pritam'], album: null, imageUrl: 'https://i/a.jpg', durationMs: 1 };
const mockSpotifyState: { current: { status: string; track: typeof KESARIYA | null } } = {
  current: { status: 'ready', track: KESARIYA },
};
jest.mock('../../services/spotify', () => ({
  useSpotifyTrack: () => mockSpotifyState.current,
}));
jest.mock('../../services/posts', () => ({
  feedPostToNowPlaying: (p: { id: string }) => ({ postId: p.id, fromHelper: true }),
}));
jest.mock('../../utils/haptics', () => ({ haptics: { tap: jest.fn() } }));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));

import PostGridCard, { PostGridSkeleton } from '../PostGridCard';
import type { FeedPost } from '../../services/posts';
import { __resetLikeStoreForTest, writeLike } from '../../utils/likeStore';

const author = (id: string, name: string) => ({ id, username: id, displayName: name, avatarUrl: null });
const basePost = (over: Partial<FeedPost> = {}): FeedPost => ({
  id: 'p1',
  kind: 'upload',
  caption: null,
  createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
  viewsCount: 999,
  likesCount: 0,
  repostsCount: 0,
  commentsCount: 0,
  author: author('riya', 'Riya Sharma'),
  track: {
    id: 't1',
    title: 'Monsoon Letters',
    mediaKind: 'audio',
    audioUrl: 'https://a/song.mp3',
    videoUrl: null,
    coverArtUrl: 'https://a/cover.jpg',
    thumbnailUrl: null,
    durationSeconds: 200,
  } as FeedPost['track'],
  originalAuthor: null,
  originalPostId: null,
  viewerHasLiked: false,
  clipStartSec: null,
  clipEndSec: null,
  credits: [],
  spotifyTrackId: null,
  ...over,
});

const texts = (t: TestRenderer.ReactTestRenderer) =>
  t.root.findAllByType(Text).map(n => [n.props.children].flat().join(''));

/** The card's tap target (Pressable is a wrapped component, so it is found by its props). */
const tappables = (t: TestRenderer.ReactTestRenderer) =>
  t.root.findAll(n => typeof n.props.onPress === 'function' && n.props.accessibilityRole === 'button');
const tap = (t: TestRenderer.ReactTestRenderer) => act(() => { tappables(t)[0]!.props.onPress(); });
const detailsLink = (t: TestRenderer.ReactTestRenderer) =>
  t.root.findAll(n => typeof n.props.onPress === 'function' && /^Open the post/.test(n.props.accessibilityLabel ?? ''));
const tapDetails = (t: TestRenderer.ReactTestRenderer) => act(() => { detailsLink(t)[0]!.props.onPress(); });
const textsIn = (n: TestRenderer.ReactTestInstance) =>
  n.findAllByType(Text).map(x => [x.props.children].flat().join(''));
const chipStyle = (t: TestRenderer.ReactTestRenderer, text: string) => StyleSheet.flatten(
  t.root.findAll(n => n.type === View && n.props.pointerEvents === 'none')
    .find(n => textsIn(n).includes(text))!.props.style,
);

const repostOf = (over: Partial<FeedPost> = {}) => basePost({
  id: 'r1',
  kind: 'repost',
  originalPostId: 'p1',
  originalAuthor: author('dk', 'Dark Knight'),
  ...over,
});
const spotifyRepost = (over: Partial<FeedPost> = {}) => basePost({
  id: 'sp',
  kind: 'repost',
  spotifyTrackId: 's1',
  originalPostId: null,
  ...over,
});

function render(el: React.ReactElement) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(el); });
  return tree;
}

beforeEach(() => {
  mockSpotifyState.current = { status: 'ready', track: KESARIYA };
  mockPlayback.activePostId = null;
  mockPlayback.nowPlaying = null;
  mockPlayback.handlersRef.current = null;
  __resetLikeStoreForTest();
  jest.clearAllMocks();
});

describe('play counts', () => {
  it("shows an upload's song total on the card", () => {
    const tree = render(<PostGridCard post={basePost()} plays={12_400} />);
    expect(texts(tree)).toContain('12k');
    expect(texts(tree)).toContain('2d ago');
  });

  it('shows no number at zero, rather than "0"', () => {
    const tree = render(<PostGridCard post={basePost()} plays={0} />);
    expect(texts(tree)).not.toContain('0');
  });

  it("never shows one on a repost — not even the post's own views", () => {
    const repost = basePost({
      id: 'r1',
      kind: 'repost',
      originalPostId: 'p1',
      originalAuthor: author('dk', 'Dark Knight'),
      viewsCount: 864,
    });
    const tree = render(<PostGridCard post={repost} plays={864} />);
    expect(texts(tree)).not.toContain('864');
    // A repost credits the song's artist, not when it was reposted.
    expect(texts(tree)).toContain('Dark Knight');
  });
});

describe('likes', () => {
  it("shows a repost's own likes on the picture", () => {
    const tree = render(<PostGridCard post={repostOf({ likesCount: 12 })} />);
    expect(textsIn(tappables(tree)[0]!)).toContain('12');
    expect(textsIn(detailsLink(tree)[0]!)).not.toContain('12');
  });

  it('sits at the bottom right and is read-only: a tap goes to the cover', () => {
    const tree = render(<PostGridCard post={repostOf({ likesCount: 12 })} />);
    expect(chipStyle(tree, '12')).toMatchObject({ right: 8, bottom: 8 });
    tap(tree);
    expect(mockPlayback.requestPlay).toHaveBeenCalledWith('r1');
  });

  it('shows no number at zero, rather than "0"', () => {
    const tree = render(<PostGridCard post={repostOf({ likesCount: 0 })} />);
    expect(texts(tree)).not.toContain('0');
  });

  it('follows a like made on another surface', () => {
    const tree = render(<PostGridCard post={repostOf({ likesCount: 12 })} />);
    act(() => { writeLike('r1', { liked: true, count: 13 }); });
    expect(texts(tree)).toContain('13');
    expect(texts(tree)).not.toContain('12');
  });

  it("shows an upload's likes at the bottom right, across from its plays", () => {
    const tree = render(<PostGridCard post={basePost({ likesCount: 57 })} plays={12_400} />);
    expect(chipStyle(tree, '57')).toMatchObject({ right: 8, bottom: 8 });
    expect(chipStyle(tree, '12k')).toMatchObject({ left: 8, bottom: 8 });
  });

  it('an upload with likes and no plays shows only the likes', () => {
    const tree = render(<PostGridCard post={basePost({ likesCount: 57 })} plays={0} />);
    expect(texts(tree)).toContain('57');
    expect(texts(tree)).not.toContain('0');
  });
});

describe('two tap zones', () => {
  it('the picture plays and stays on the profile', () => {
    const tree = render(<PostGridCard post={repostOf({ clipStartSec: 42 })} />);
    tap(tree);
    expect(mockPlayback.requestPlay).toHaveBeenCalledWith('r1');
    expect(mockPlayback.markSeekTarget).toHaveBeenCalledWith(42);
    expect(mockOpenFullScreen).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("the details open the repost's own page, not the original's, without playing", () => {
    const tree = render(<PostGridCard post={repostOf()} />);
    tapDetails(tree);
    expect(mockNavigate).toHaveBeenCalledWith('PostDetail', { postId: 'r1' });
    expect(mockPlayback.requestPlay).not.toHaveBeenCalled();
    expect(mockOpenFullScreen).not.toHaveBeenCalled();
  });

  it('an upload has them too', () => {
    const tree = render(<PostGridCard post={basePost()} />);
    tapDetails(tree);
    expect(mockNavigate).toHaveBeenCalledWith('PostDetail', { postId: 'p1' });
    expect(mockPlayback.requestPlay).not.toHaveBeenCalled();
    tap(tree);
    expect(mockPlayback.requestPlay).toHaveBeenCalledWith('p1');
  });
});

describe('tap', () => {
  it('plays from the clip and opens the player', () => {
    const tree = render(<PostGridCard post={basePost({ clipStartSec: 42 })} />);
    tap(tree);
    expect(mockPlayback.setNowPlaying).toHaveBeenCalledWith({ postId: 'p1', fromHelper: true });
    expect(mockPlayback.markSeekTarget).toHaveBeenCalledWith(42);
    expect(mockPlayback.requestPlay).toHaveBeenCalledWith('p1');
    expect(mockOpenFullScreen).toHaveBeenCalledTimes(1);
  });

  it('only opens the player when this post is already playing', () => {
    mockPlayback.activePostId = 'p1';
    const tree = render(<PostGridCard post={basePost()} />);
    tap(tree);
    expect(mockPlayback.requestPlay).not.toHaveBeenCalled();
    expect(mockOpenFullScreen).toHaveBeenCalledTimes(1);
  });
});

describe('loading skeleton', () => {
  const artWidths = (t: TestRenderer.ReactTestRenderer) =>
    t.root.findAllByType(View)
      .map(n => StyleSheet.flatten(n.props.style))
      .filter(s => typeof s?.width === 'number' && s.width === s.height)
      .map(s => s.width);

  it('draws two rows of placeholders the size of the real cards', () => {
    const [realWidth] = artWidths(render(<PostGridCard post={basePost()} />));
    const skeleton = render(<PostGridSkeleton />);
    expect(artWidths(skeleton)).toEqual([realWidth, realWidth, realWidth, realWidth]);
    expect(texts(skeleton)).toEqual([]);
    expect(tappables(skeleton)).toHaveLength(0);
  });
});

describe('Spotify and removed originals', () => {
  it('draws no plays on Spotify art and hands the song to Spotify', () => {
    const tree = render(<PostGridCard post={basePost({ id: 'sp', kind: 'repost', spotifyTrackId: 's1', originalPostId: null })} plays={5} />);
    expect(texts(tree)).toEqual(['Kesariya', 'Arijit Singh, Pritam', 'Plays on Spotify']);
    tap(tree);
    // Riya's grid, not mine: the hand-off is followed by the "come back and like or comment" card.
    expect(mockOpenSpotify).toHaveBeenCalledWith('s1', { spotifyTrackId: 's1', postId: 'sp', authorName: 'Riya Sharma' });
    expect(mockPlayback.requestPlay).not.toHaveBeenCalled();
  });

  it('shows likes on Spotify art, the only thing drawn on it, and not in the details', () => {
    const tree = render(<PostGridCard post={spotifyRepost({ likesCount: 4 })} plays={5} />);
    expect(textsIn(tappables(tree)[0]!)).toEqual(['4']);
    expect(textsIn(detailsLink(tree)[0]!)).not.toContain('4');
  });

  it('the details open the post instead of Spotify', () => {
    const tree = render(<PostGridCard post={spotifyRepost()} />);
    tapDetails(tree);
    expect(mockNavigate).toHaveBeenCalledWith('PostDetail', { postId: 'sp' });
    expect(mockOpenSpotify).not.toHaveBeenCalled();
  });

  it('my own grid hands the song to Spotify with no card to come back to', () => {
    mockMe.current = 'riya';
    const tree = render(<PostGridCard post={basePost({ id: 'sp', kind: 'repost', spotifyTrackId: 's1', originalPostId: null })} />);
    tap(tree);
    expect(mockOpenSpotify).toHaveBeenCalledWith('s1', undefined);
    mockMe.current = 'me';
  });

  it("a song that didn't load says so, shows Spotify's mark, and still opens Spotify", () => {
    mockSpotifyState.current = { status: 'unavailable', track: null };
    const tree = render(<PostGridCard post={basePost({ id: 'sp', kind: 'repost', spotifyTrackId: 's1', originalPostId: null })} />);
    expect(texts(tree)[0]).toBe("Song didn't load");
    expect(tree.root.findAll(n => n.props.accessibilityLabel === 'Spotify')).not.toHaveLength(0);
    tap(tree);
    expect(mockOpenSpotify).toHaveBeenCalledWith('s1', expect.objectContaining({ postId: 'sp' }));
  });

  it('shows a deleted original as removed, with nothing to tap', () => {
    const orphan = basePost({ id: 'r2', kind: 'repost', originalPostId: null });
    const tree = render(<PostGridCard post={orphan} />);
    expect(texts(tree)).toContain('Removed upload');
    expect(tappables(tree)).toHaveLength(0);
  });
});
