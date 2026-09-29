/**
 * Jam listener guard (ADR-0023).
 *
 * While a user is a jam LISTENER (jamLocked), a "play this" from anywhere in the app
 * must never reach the engine — it becomes a jam suggestion instead. Before this, a
 * listener's tap played their own song until the host's next 2s heartbeat pulled them
 * back. The jam's OWN sync (loading the host's track) must still get through.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { PlaybackProvider, usePlayback, type NowPlayingInfo } from '../PlaybackContext';

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
    knownDurationSec: 0,
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

describe('jam listener guard', () => {
  it('diverts a listener tap to the suggestion handler and plays nothing', () => {
    const get = mountPlayback();
    const suggested: string[] = [];
    act(() => {
      get().setJamLocked(true);
      get().registerListenerTapHandler(info => { suggested.push(info.postId); });
    });

    act(() => {
      get().setQueue([track('a'), track('b')], 0, 'feed');
      get().setNowPlaying(track('a'));
      get().requestPlay('a');
      get().openFullScreenPlayer();
      get().addToQueue(track('b'));
    });

    expect(suggested).toEqual(['a', 'b']);
    expect(get().nowPlaying).toBeNull();
    expect(get().activePostId).toBeNull();
    expect(get().isFullScreenOpen).toBe(false);
    expect(get().queueRef.current).toHaveLength(0);
  });

  it('lets the jam sync load the host track through the guard', () => {
    const get = mountPlayback();
    const suggested: string[] = [];
    act(() => {
      get().setJamLocked(true);
      get().registerListenerTapHandler(info => { suggested.push(info.postId); });
    });

    act(() => {
      get().runAsJamSync(() => get().setNowPlaying(track('host')));
      get().runAsJamSync(() => get().requestPlay('host'));
    });

    expect(suggested).toEqual([]);
    expect(get().nowPlaying?.postId).toBe('host');
    expect(get().activePostId).toBe('host');
  });

  it('lets a patch of the SAME track through (album title, like counts) without suggesting it', () => {
    const get = mountPlayback();
    const suggested: string[] = [];
    act(() => {
      get().setJamLocked(true);
      get().registerListenerTapHandler(info => { suggested.push(info.postId); });
    });
    act(() => { get().runAsJamSync(() => get().setNowPlaying(track('host'))); });
    // GlobalAudioPlayer patches the loaded track once it knows its album.
    act(() => { get().setNowPlaying({ ...track('host'), albumTitle: 'Thriller' }); });

    expect(suggested).toEqual([]);
    expect(get().nowPlaying?.albumTitle).toBe('Thriller');
  });

  it('does nothing unusual for the host or outside a jam', () => {
    const get = mountPlayback();
    act(() => {
      get().setNowPlaying(track('mine'));
      get().requestPlay('mine');
    });
    expect(get().nowPlaying?.postId).toBe('mine');
    expect(get().activePostId).toBe('mine');
  });
});
