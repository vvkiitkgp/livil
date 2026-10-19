/**
 * A track that fails to load (GlobalAudioPlayer.handleError).
 *
 * One broken file skips to the next track. But offline EVERY track fails, and skipping raced
 * through the queue — a new song each second, an error buzz with each (owner report,
 * 2026-10-19). Offline — by NetInfo or by the error itself — or on a second failure with nothing
 * played between, the engine must stop on the track,
 * paused; and play must then load that track again (a failed source does not reload itself).
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { PlaybackProvider, usePlayback, type NowPlayingInfo } from '../../contexts/PlaybackContext';
import GlobalAudioPlayer from '../GlobalAudioPlayer';

type VideoProps = {
  source?: { uri?: string };
  paused?: boolean;
  onEnd?: () => void;
  onError?: (e: { error?: unknown }) => void;
  onProgress?: (d: { currentTime: number }) => void;
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
const mockShowToast = jest.fn();
jest.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ showToast: mockShowToast }) }));
let mockOfflineListener: (offline: boolean) => void = () => {};
jest.mock('../../services/network', () => ({
  subscribeToOffline: (l: (offline: boolean) => void) => { mockOfflineListener = l; return () => {}; },
}));
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
  mockShowToast.mockClear();
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


function fails(error: unknown = { domain: 'AVFoundationErrorDomain', code: -11828, localizedDescription: 'Cannot Open' }) {
  act(() => { mockLatest.props!.onError!({ error }); });
}
function plays(fromSec: number, toSec: number) {
  act(() => { mockLatest.props!.onProgress!({ currentTime: fromSec }); });
  act(() => { mockLatest.props!.onProgress!({ currentTime: toSec }); });
}

it('one broken track skips to the next', () => {
  playing([track('a'), track('b'), track('c')]);
  fails();
  expect(mockLatest.props).toMatchObject({ source: { uri: 'b.mp3' }, paused: false });
  expect(mockShowToast).toHaveBeenCalledWith('Could not play this track', { kind: 'error' });
});

it('offline (NetInfo): stops on the track, paused, without skipping or an error toast', () => {
  playing([track('a'), track('b'), track('c')]);
  act(() => { mockOfflineListener(true); });
  fails();
  expect(mockLatest.props).toMatchObject({ source: { uri: 'a.mp3' }, paused: true });
  expect(mockShowToast).not.toHaveBeenCalled();
});

it('a connection error stops at once, even before NetInfo has noticed', () => {
  playing([track('a'), track('b'), track('c')]);
  fails({ domain: 'NSURLErrorDomain', code: -1009, localizedDescription: 'The Internet connection appears to be offline.' });
  expect(mockLatest.props).toMatchObject({ source: { uri: 'a.mp3' }, paused: true });
  expect(mockShowToast).toHaveBeenCalledWith("Couldn't play. Check your connection.", { kind: 'info' });
  expect(mockShowToast).not.toHaveBeenCalledWith('Could not play this track', expect.anything());
});

it('two failures in a row: skips once, stops on the second', () => {
  playing([track('a'), track('b'), track('c'), track('d')]);
  fails(); // a → b
  fails(); // stops on b
  expect(mockLatest.props).toMatchObject({ source: { uri: 'b.mp3' }, paused: true });
  expect(mockShowToast).toHaveBeenLastCalledWith("Couldn't play. Check your connection.", { kind: 'info' });
});

it('a track that only LOADS does not reset the count (a cached track can load offline)', () => {
  playing([track('a'), track('b'), track('c'), track('d')]);
  fails(); // a → b
  act(() => { mockLatest.props!.onLoad!({ duration: 200 }); });
  fails(); // still the second in a row → stop on b
  expect(mockLatest.props).toMatchObject({ source: { uri: 'b.mp3' }, paused: true });
});

it('a track that really PLAYS resets the count', () => {
  playing([track('a'), track('b'), track('c'), track('d')]);
  fails(); // a → b
  act(() => { mockLatest.props!.onLoad!({ duration: 200 }); });
  plays(0, 1.5);
  fails(); // b → c: the first failure since something played
  expect(mockLatest.props).toMatchObject({ source: { uri: 'c.mp3' }, paused: false });
});

it('play after an offline stop loads the same track again', () => {
  const get = playing([track('a'), track('b')]);
  act(() => { mockOfflineListener(true); });
  fails();
  act(() => { mockOfflineListener(false); });
  act(() => { get().handlersRef.current!.play(); });
  expect(mockLatest.props).toMatchObject({ source: { uri: 'a.mp3#retry=1' }, paused: false });
});
