/**
 * The native player's play/pause reports reach JS late. A report that only ECHOES a `paused`
 * value the engine itself sent a moment ago must not be read as a lock-screen press — on an
 * iPhone video that turned two in-flight echoes into a ring: each one flipped the engine,
 * whose own command echoed back the other way, so the player flipped play / pause forever
 * (2026-11-08, device logs: `lock-screen PAUSE → sync` / `lock-screen PLAY → sync`
 * alternating, then "Maximum update depth exceeded").
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
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
const mockPause = jest.fn();

jest.mock('react-native-video', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const Video = R.forwardRef((props: VideoProps, ref) => {
    R.useImperativeHandle(ref, () => ({ seek: mockSeek, pause: mockPause, resume: jest.fn() }));
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
  mockPause.mockClear();
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


/** The native player's late report of what it is doing. */
function nativeReports(isPlaying: boolean) {
  act(() => { mockLatest.props!.onPlaybackStateChanged!({ isPlaying, isSeeking: false }); });
}

it('ignores the late echo of its own pause after an in-app pause → play', () => {
  const get = playing([track('a')]);
  act(() => { get().handlersRef.current!.pause(); });
  act(() => { jest.advanceTimersByTime(100); });
  act(() => { get().handlersRef.current!.play(); });
  act(() => { jest.advanceTimersByTime(600); });

  nativeReports(false); // the echo of the pause, arriving after the play

  expect(mockLatest.props?.paused).toBe(false);
  expect(get().activePostId).toBe('a');
});

it('holds the player paused on the late echo of its own play after play → pause', () => {
  const get = playing([track('a')]);
  act(() => { get().handlersRef.current!.pause(); });
  act(() => { jest.advanceTimersByTime(100); });
  act(() => { get().handlersRef.current!.play(); });
  act(() => { jest.advanceTimersByTime(100); });
  act(() => { get().handlersRef.current!.pause(); });
  act(() => { jest.advanceTimersByTime(600); });

  nativeReports(true); // the echo of the play, arriving after the second pause

  expect(mockLatest.props?.paused).toBe(true);
  expect(get().activePostId).toBeNull();
  expect(mockPause).toHaveBeenCalled();
});

it('settles instead of ringing when both echoes arrive out of order', () => {
  const get = playing([track('a')]);
  act(() => { get().handlersRef.current!.pause(); });
  act(() => { get().handlersRef.current!.play(); });
  act(() => { jest.advanceTimersByTime(700); });
  const from = mockRenders.length;

  for (let i = 0; i < 6; i++) { nativeReports(i % 2 === 1); }

  // Not one flip: before the fix, every report flipped the engine and the last one only
  // happened to land on "playing".
  expect(mockRenders.slice(from).filter(r => r.paused === true)).toEqual([]);
  expect(mockLatest.props?.paused).toBe(false);
  expect(get().activePostId).toBe('a');
});

it('still follows a real lock-screen pause once our own commands are old', () => {
  const get = playing([track('a')]);
  act(() => { get().handlersRef.current!.pause(); });
  act(() => { get().handlersRef.current!.play(); });
  act(() => { jest.advanceTimersByTime(5_000); });

  nativeReports(false);

  expect(mockLatest.props?.paused).toBe(true);
  expect(get().activePostId).toBeNull();
});
