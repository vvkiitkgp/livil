/**
 * closePlayer: the user held the floating player on the X. Everything the player holds has
 * to go, because GlobalAudioPlayer loads `queueRef[currentIndexRef]` whenever the active post
 * changes: a queue left behind is music that can come back on its own.
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

function mountPlaying() {
  const get = mountPlayback();
  const songs = [track('a'), track('b'), track('c')];
  const pause = jest.fn();
  act(() => {
    get().registerHandlers({ play: jest.fn(), pause, seek: jest.fn() });
    get().setQueue(songs, 0, 'home');
    get().setNowPlaying(songs[0]!);
    get().requestPlay('a');
    get().addToQueue(track('queued'));
  });
  return { get, pause };
}

describe('closePlayer', () => {
  it('stops the engine and drops the track', () => {
    const { get, pause } = mountPlaying();
    act(() => { get().closePlayer(); });
    expect(pause).toHaveBeenCalledTimes(1);
    expect(get().nowPlaying).toBeNull();
    expect(get().activePostId).toBeNull();
    expect(get().pendingPlayId).toBeNull();
  });

  it('forgets the whole queue, including songs added by hand', () => {
    const { get } = mountPlaying();
    act(() => { get().closePlayer(); });
    expect(get().queueRef.current).toEqual([]);
    expect(get().currentIndexRef.current).toBe(-1);
    let advanced: boolean | undefined;
    act(() => { advanced = get().playNext(); });
    expect(advanced).toBe(false);
    expect(get().nowPlaying).toBeNull();
  });

  it('collapses full screen', () => {
    const { get } = mountPlaying();
    act(() => { get().openFullScreenPlayer(); });
    expect(get().isFullScreenOpen).toBe(true);
    act(() => { get().closePlayer(); });
    expect(get().isFullScreenOpen).toBe(false);
  });

  it('lets a feed tap rebuild the queue afterwards', () => {
    const { get } = mountPlaying();
    act(() => {
      get().playSourceRef.current = 'queue';
      get().closePlayer();
    });
    // Home, Profile and UserProfile only build a queue when the source is 'user'.
    expect(get().playSourceRef.current).toBe('user');
  });

  it('plays the same song again from its start', () => {
    const { get } = mountPlaying();
    act(() => { get().positionRef.current = 42; });
    act(() => { get().closePlayer(); });
    expect(get().positionRef.current).toBe(0);

    const again = track('a', { clipStartSec: 10, clipEndSec: 40 });
    act(() => {
      get().setNowPlaying(again);
      get().requestPlay('a');
    });
    expect(get().nowPlaying?.postId).toBe('a');
    expect(get().activePostId).toBe('a');
    expect(get().positionRef.current).toBe(10);
  });
});
