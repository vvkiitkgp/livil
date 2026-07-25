/**
 * Clip session (ADR-0013) — the first tests over the story/clip playback seam.
 *
 * These pin the behaviour that removes the story bug cluster: a declared clip
 * session where the JS clock owns advance and the native watcher is disarmed.
 * `PlaybackContext` imports only React, so it renders under react-test-renderer
 * with no native mocks. We assert the SEAM contract, not the native side:
 *  - entering opens the reactive `isStoryViewerOpen` signal GAP reads to null-out
 *    currentClipJson (disarming the native clip-end watcher);
 *  - `playNext` is inert during a session, so a native onNextTrack (or the
 *    naturalEndListener) can never cut a story short;
 *  - exiting restores the user's music.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { PlaybackProvider, usePlayback, type NowPlayingInfo } from '../PlaybackContext';

function track(postId: string, over: Partial<NowPlayingInfo> = {}): NowPlayingInfo {
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
    knownDurationSec: 0,
    ...over,
  };
}

type Ctx = ReturnType<typeof usePlayback>;

// exitClipSession defers the restore-seek via setTimeout(…, 0); fake timers keep
// it from firing after the test ends, and we flush it inside act().
beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => {
  act(() => { jest.runOnlyPendingTimers(); });
  jest.clearAllTimers();
  jest.useRealTimers();
});

function mountPlayback() {
  const ref: { current: Ctx | null } = { current: null };
  function Capture() {
    ref.current = usePlayback();
    return null;
  }
  act(() => {
    TestRenderer.create(
      <PlaybackProvider>
        <Capture />
      </PlaybackProvider>,
    );
  });
  return () => ref.current!;
}

describe('clip session lifecycle', () => {
  it('opens the story-viewer signal and returns the pre-session source url', () => {
    const get = mountPlayback();
    const prev = track('song', { audioUrl: 'song.mp3' });
    act(() => { get().setNowPlaying(prev); });

    let src: string | null = 'unset';
    act(() => { src = get().enterClipSession(prev); });

    expect(src).toBe('song.mp3');
    expect(get().isStoryViewerOpen).toBe(true);

    act(() => { get().exitClipSession(); });
    expect(get().isStoryViewerOpen).toBe(false);
  });

  it('restores the user\'s track on exit', () => {
    const get = mountPlayback();
    const userTrack = track('user', { audioUrl: 'user.mp3' });
    act(() => {
      get().setQueue([userTrack], 0, 'home');
      get().setNowPlaying(userTrack);
    });
    act(() => { get().enterClipSession(userTrack); });

    // A story drives the engine during the session.
    const story = track('story_viewer_1', { audioUrl: 'song.mp3', clipStartSec: 100, clipEndSec: 110 });
    act(() => {
      get().setQueue([story], 0, 'story');
      get().setNowPlaying(story);
    });
    expect(get().nowPlaying?.postId).toBe('story_viewer_1');

    act(() => { get().exitClipSession(); });
    expect(get().nowPlaying?.postId).toBe('user');
  });
});

describe('playNext during a clip session', () => {
  it('advances the queue when NOT in a clip session (baseline)', () => {
    const get = mountPlayback();
    const t0 = track('t0');
    const t1 = track('t1');
    act(() => {
      get().setQueue([t0, t1], 0, 'home');
      get().setNowPlaying(t0);
    });
    act(() => { get().playNext(); });
    expect(get().nowPlaying?.postId).toBe('t1');
  });

  it('is INERT in a clip session — a native onNextTrack cannot cut a story short', () => {
    const get = mountPlayback();
    const t0 = track('t0');
    const t1 = track('t1');
    act(() => {
      get().setQueue([t0, t1], 0, 'home');
      get().setNowPlaying(t0);
    });
    // Enter the session, then a story becomes the active item.
    act(() => { get().enterClipSession(t0); });
    act(() => { get().setNowPlaying(track('story_viewer_2', { audioUrl: 'song.mp3' })); });

    // The native clip-end watcher / naturalEndListener would fire this.
    act(() => { get().playNext(); });

    // The story is untouched — playNext did not advance or deactivate it.
    expect(get().nowPlaying?.postId).toBe('story_viewer_2');
  });
});
