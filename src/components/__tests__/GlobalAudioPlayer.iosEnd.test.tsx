/**
 * The natural end of a track on iOS (GlobalAudioPlayer.handleEnd).
 *
 * RNV's iOS player pauses ITSELF when an item ends and reports isPlaying=false right after
 * onEnd. Both events reach JS before React re-renders, so the pause-sync saw a playing
 * engine stop with no load guard armed and took it for a lock-screen pause: it set
 * paused=true in the same batch as the next track. The next track then rendered paused —
 * on a locked iPhone the music stopped and the lock-screen card went away (2026-10-14,
 * device logs: `onEnd → playNext` then `lock-screen PAUSE → sync`).
 *
 * The Video mock records every render's (source, paused), which is what the native player
 * is told; a single paused=true for the next track is the bug.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Platform } from 'react-native';
import { PlaybackProvider, usePlayback, type NowPlayingInfo } from '../../contexts/PlaybackContext';
import GlobalAudioPlayer from '../GlobalAudioPlayer';

type VideoProps = {
  source?: { uri?: string };
  paused?: boolean;
  onEnd?: () => void;
  onLoad?: (d: { duration: number }) => void;
  onPlaybackStateChanged?: (e: { isPlaying: boolean; isSeeking: boolean }) => void;
};

const mockRenders: Array<{ uri: string | undefined; paused: boolean | undefined }> = [];
const mockLatest: { props: VideoProps | null } = { props: null };
const mockSeek = jest.fn();

jest.mock('react-native-video', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const Video = R.forwardRef((props: VideoProps, ref) => {
    R.useImperativeHandle(ref, () => ({ seek: mockSeek, pause: jest.fn(), resume: jest.fn() }));
    mockRenders.push({ uri: props.source?.uri, paused: props.paused });
    mockLatest.props = props;
    return null;
  });
  return { __esModule: true, default: Video };
});
jest.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('../../utils/playTracker', () => ({ trackPlayProgress: jest.fn() }));
jest.mock('../../services/tracks', () => ({ backfillTrackDuration: jest.fn(() => Promise.resolve()) }));
const mockSetListeningTrack = jest.fn();
jest.mock('../../services/listeningStatus', () => ({
  listeningTick: jest.fn(),
  setListeningTrack: (...a: unknown[]) => mockSetListeningTrack(...a),
}));
jest.mock('../../services/jamHeartbeat', () => ({ jamHeartbeatTick: jest.fn() }));
jest.mock('../../services/albums', () => ({ fetchAlbumForTrack: jest.fn(() => Promise.resolve(null)) }));

function track(postId: string): NowPlayingInfo {
  return {
    postId,
    trackId: `t_${postId}`,
    title: postId,
    artistName: 'artist',
    authorId: 'author',
    authorUsername: 'author',
    authorAvatarUrl: null,
    coverArtUrl: null,
    thumbnailUrl: null,
    mediaKind: 'audio',
    audioUrl: `${postId}.mp3`,
    likesCount: 0,
    commentsCount: 0,
    repostsCount: 0,
    viewsCount: 0,
    viewerHasLiked: false,
    clipStartSec: null,
    clipEndSec: null,
    kind: 'upload',
    originalPostId: null,
    knownDurationSec: 200,
    albumTitle: null,
  };
}

type Ctx = ReturnType<typeof usePlayback>;
const T0 = Date.parse('2026-10-14T12:53:18Z');

beforeEach(() => {
  jest.useFakeTimers({ now: T0 });
  mockRenders.length = 0;
  mockLatest.props = null;
  mockSeek.mockClear();
  mockSetListeningTrack.mockClear();
});
afterEach(() => {
  act(() => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
});

/** Plays `queue[0]` from Home, loaded and a minute in — past every load guard. */
function playing(queue: NowPlayingInfo[]) {
  const ref: { current: Ctx | null } = { current: null };
  function Capture() {
    ref.current = usePlayback();
    return null;
  }
  act(() => {
    TestRenderer.create(
      <PlaybackProvider>
        <GlobalAudioPlayer />
        <Capture />
      </PlaybackProvider>,
    );
  });
  const get = () => ref.current!;
  act(() => {
    get().setNowPlaying(queue[0]!);
    get().requestPlay(queue[0]!.postId);
    get().setQueue(queue, 0, 'Home');
  });
  act(() => { mockLatest.props!.onLoad!({ duration: 200 }); });
  act(() => { jest.setSystemTime(T0 + 60_000); });
  expect(mockLatest.props).toMatchObject({ source: { uri: `${queue[0]!.postId}.mp3` }, paused: false });
  return get;
}

/** What the player does at the end of an item: onEnd, then its own stop. One batch. */
function trackEnds() {
  act(() => {
    mockLatest.props!.onEnd!();
    mockLatest.props!.onPlaybackStateChanged!({ isPlaying: false, isSeeking: false });
  });
}

it('runs on iOS (the path under test is iOS-only)', () => {
  expect(Platform.OS).toBe('ios');
});

it('starts the next track playing, never paused, when a track ends', () => {
  playing([track('a'), track('b')]);
  const from = mockRenders.length;

  trackEnds();

  const after = mockRenders.slice(from);
  expect(after.filter(r => r.uri === 'b.mp3')).not.toHaveLength(0);
  expect(after.filter(r => r.paused === true)).toEqual([]);
  expect(mockLatest.props).toMatchObject({ source: { uri: 'b.mp3' }, paused: false });
});

it('still pauses for a real lock-screen pause once the next track is playing', () => {
  const get = playing([track('a'), track('b')]);
  trackEnds();
  act(() => { mockLatest.props!.onLoad!({ duration: 200 }); });
  act(() => { jest.setSystemTime(T0 + 70_000); });

  act(() => { mockLatest.props!.onPlaybackStateChanged!({ isPlaying: false, isSeeking: false }); });

  expect(mockLatest.props?.paused).toBe(true);
  expect(get().activePostId).toBeNull();
});

it('stops and says so at the end of the queue', () => {
  const get = playing([track('a')]);

  trackEnds();

  expect(mockLatest.props).toMatchObject({ source: { uri: 'a.mp3' }, paused: true });
  expect(get().activePostId).toBeNull();
  expect(mockSetListeningTrack).toHaveBeenLastCalledWith(null);
});

it('loops on repeat-one without pausing', () => {
  const get = playing([track('a'), track('b')]);
  act(() => { get().setRepeatMode('one'); });
  const from = mockRenders.length;

  trackEnds();

  expect(mockSeek).toHaveBeenCalledWith(0);
  expect(mockRenders.slice(from).filter(r => r.paused === true)).toEqual([]);
  expect(mockLatest.props).toMatchObject({ source: { uri: 'a.mp3' }, paused: false });
});
