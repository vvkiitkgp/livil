/**
 * The song card in a comment. A Livil song plays right where it is (the comments stay open)
 * as a one-song queue, and a second tap pauses it; a Spotify song is handed to Spotify; a
 * song this viewer cannot see falls back to the comment's label line.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

jest.mock('../Icon', () => ({ Icon: () => null }));
jest.mock('../Logo', () => ({ Logo: () => null }));
jest.mock('../SpotifyLogo', () => ({ SpotifyLogo: () => null }));

const mockPlayback = {
  nowPlaying: null as null | { postId: string },
  activePostId: null as string | null,
  handlersRef: { current: { pause: jest.fn(), play: jest.fn() } },
  requestPlay: jest.fn(),
  setNowPlaying: jest.fn(),
  setQueue: jest.fn(),
  markSeekTarget: jest.fn(),
};
jest.mock('../../contexts/PlaybackContext', () => ({ usePlayback: () => mockPlayback }));

const mockOpenSpotify = jest.fn(async () => undefined);
jest.mock('../../hooks/useOpenInSpotify', () => ({ useOpenInSpotify: () => mockOpenSpotify }));

const mockFetchPostById = jest.fn();
jest.mock('../../services/posts', () => ({
  fetchPostById: (...a: unknown[]) => mockFetchPostById(...a),
  feedPostToNowPlaying: (p: { id: string }) => ({ postId: p.id }),
  isPlayableInLivil: (p: { spotifyTrackId?: string | null }) => !p.spotifyTrackId,
}));

jest.mock('../../services/share', () => ({
  toShareablePost: (p: { id: string; track: { title: string; coverArtUrl: string | null }; author: { displayName: string } }) => ({
    id: p.id, title: p.track.title, artistName: p.author.displayName, coverArtUrl: p.track.coverArtUrl,
  }),
}));

const mockSpotifyState = { current: { status: 'loading', track: null } as { status: string; track: unknown } };
jest.mock('../../services/spotify', () => ({
  artistLine: (t: { artists: string[] }) => t.artists.join(', '),
  useSpotifyTrack: () => mockSpotifyState.current,
}));

import CommentSongCard, { __clearCommentSongCacheForTest } from '../CommentSongCard';

const kesariya = {
  id: 'p9',
  kind: 'upload',
  spotifyTrackId: null,
  clipStartSec: null,
  author: { username: 'arijit', displayName: 'Arijit Singh' },
  originalAuthor: null,
  track: { id: 't9', title: 'Kesariya', coverArtUrl: 'https://cdn/k.jpg', thumbnailUrl: null },
};

function texts(r: TestRenderer.ReactTestRenderer): string[] {
  return r.root.findAllByType(Text).map(t => String(t.props.children));
}
function card(r: TestRenderer.ReactTestRenderer) {
  // By props: Pressable is a memo component, so matching on its type finds nothing.
  return r.root.findAll(n => n.props.testID === 'comment-song-card' && 'accessibilityLabel' in n.props)[0];
}
async function render(el: React.ReactElement) {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(el); });
  return r;
}

beforeEach(() => {
  __clearCommentSongCacheForTest();
  jest.clearAllMocks();
  mockPlayback.nowPlaying = null;
  mockPlayback.activePostId = null;
});

describe('a Livil song', () => {
  it('shows the song and plays it as a one-song queue, from the top', async () => {
    mockFetchPostById.mockResolvedValue(kesariya);
    const r = await render(<CommentSongCard song={{ kind: 'livil', postId: 'p9' }} label="🎵 Kesariya — Arijit Singh" />);
    expect(texts(r)).toEqual(expect.arrayContaining(['Kesariya', 'Arijit Singh']));

    act(() => { card(r).props.onPress(); });
    expect(mockPlayback.setQueue).toHaveBeenCalledWith([{ postId: 'p9' }], 0, 'comments');
    expect(mockPlayback.setNowPlaying).toHaveBeenCalledWith({ postId: 'p9' });
    expect(mockPlayback.markSeekTarget).toHaveBeenCalledWith(0);
    expect(mockPlayback.requestPlay).toHaveBeenCalledWith('p9');
  });

  it('pauses it when it is the song playing, and resumes it when paused', async () => {
    mockFetchPostById.mockResolvedValue(kesariya);
    mockPlayback.nowPlaying = { postId: 'p9' };
    mockPlayback.activePostId = 'p9';
    const r = await render(<CommentSongCard song={{ kind: 'livil', postId: 'p9' }} label="x" />);
    expect(card(r).props.accessibilityLabel).toBe('Pause Kesariya');
    act(() => { card(r).props.onPress(); });
    expect(mockPlayback.handlersRef.current.pause).toHaveBeenCalled();
    expect(mockPlayback.setQueue).not.toHaveBeenCalled();

    // Paused (e.g. by a Spotify hand-off): the engine itself must be told to play.
    // requestPlay alone marks it active and the engine, already holding it, stays silent.
    mockPlayback.activePostId = null;
    await act(async () => { r.update(<CommentSongCard song={{ kind: 'livil', postId: 'p9' }} label="x" />); });
    act(() => { card(r).props.onPress(); });
    expect(mockPlayback.handlersRef.current.play).toHaveBeenCalledTimes(1);
    expect(mockPlayback.requestPlay).not.toHaveBeenCalled();
    expect(mockPlayback.setQueue).not.toHaveBeenCalled();
  });

  it('a song this viewer cannot see shows the label line instead', async () => {
    mockFetchPostById.mockResolvedValue(null);
    const r = await render(<CommentSongCard song={{ kind: 'livil', postId: 'p9' }} label="🎵 Kesariya — Arijit Singh" />);
    expect(card(r)).toBeUndefined();
    expect(texts(r)).toEqual(['🎵 Kesariya — Arijit Singh']);
  });

  it('looks each shared post up once, however many comments share it', async () => {
    mockFetchPostById.mockResolvedValue(kesariya);
    await render(
      <>
        <CommentSongCard song={{ kind: 'livil', postId: 'p9' }} label="a" />
        <CommentSongCard song={{ kind: 'livil', postId: 'p9' }} label="b" />
      </>,
    );
    expect(mockFetchPostById).toHaveBeenCalledTimes(1);
  });
});

describe('a Spotify song', () => {
  it('opens in Spotify — Livil never plays it', async () => {
    mockSpotifyState.current = {
      status: 'ready',
      track: { id: '4uLU6hMCjMI75M1A2tKUQC', title: 'Song', artists: ['Artist'], imageUrl: null },
    };
    const r = await render(<CommentSongCard song={{ kind: 'spotify', trackId: '4uLU6hMCjMI75M1A2tKUQC' }} label="x" />);
    expect(texts(r)).toEqual(expect.arrayContaining(['Song', 'Artist']));
    act(() => { card(r).props.onPress(); });
    expect(mockOpenSpotify).toHaveBeenCalledWith('4uLU6hMCjMI75M1A2tKUQC');
    expect(mockPlayback.requestPlay).not.toHaveBeenCalled();
  });

  it('an unknown track shows the label line instead', async () => {
    mockSpotifyState.current = { status: 'unavailable', track: null };
    const r = await render(<CommentSongCard song={{ kind: 'spotify', trackId: '4uLU6hMCjMI75M1A2tKUQC' }} label="🎵 Song — Artist" />);
    expect(card(r)).toBeUndefined();
    expect(texts(r)).toEqual(['🎵 Song — Artist']);
  });
});
