/**
 * Tests for story→GAP playback mapping.
 *
 * WHY
 *
 * A story's audio must play through the SINGLE GlobalAudioPlayer engine (ADR-0001),
 * not a second <Video>. The screen does that by feeding GAP a NowPlayingInfo built
 * here. Two properties are load-bearing and silent if wrong:
 *
 *   1. the REAL clip window is passed through (both bounds non-null) — setNowPlaying
 *      only arms positionRef = clipStart / clipWindowRef when BOTH are non-null, so
 *      the engine loads AT the clip start instead of 0:00 or the prior feed
 *      position. (Returning NULL bounds here was the LIV-31 device-test bug.) The
 *      viewer keeps a one-item queue with repeat forced OFF, so the native clip-end
 *      watcher can't advance into a stale queue.
 *   2. the post id is a SYNTHETIC, recognisable, non-uuid id — the play-count
 *      tracker keys off `isStoryViewerPostId` to skip a DB round-trip that would
 *      fail the uuid cast every time. If the prefix and the check drift apart the
 *      guard silently stops working.
 */

import {
  storyToNowPlaying,
  storyViewerPostId,
  isStoryViewerPostId,
} from '../storyPlayback';
import type { Story } from '../../services/stories';

function makeStory(overrides: Partial<Story> = {}): Story {
  return {
    id: 'story-abc',
    author: {
      id: 'user-1',
      username: 'nova',
      displayName: 'Nova Vibe',
      avatarUrl: 'https://cdn/av.png',
    },
    track: {
      id: 'track-9',
      title: 'Midnight',
      mediaKind: 'audio',
      audioUrl: 'https://cdn/audio.mp3',
      videoUrl: null,
      coverArtUrl: 'https://cdn/cover.png',
      thumbnailUrl: null,
      durationSeconds: null,
    },
    originalPostId: 'post-77',
    comment: null,
    clipStartSec: 12,
    clipEndSec: 27,
    createdAt: '2026-07-24T00:00:00Z',
    expiresAt: '2026-07-25T00:00:00Z',
    viewedAt: null,
    ...overrides,
  };
}

describe('storyViewerPostId / isStoryViewerPostId', () => {
  it('builds a synthetic id that the guard recognises', () => {
    const id = storyViewerPostId('story-abc');
    expect(id).toBe('story_viewer_story-abc');
    expect(isStoryViewerPostId(id)).toBe(true);
  });

  it('does NOT flag a real (uuid-like) post id', () => {
    // The guard must be tight — a false positive would silently stop recording
    // plays for a real post.
    expect(isStoryViewerPostId('b3f1c2d4-0000-4a00-8000-000000000000')).toBe(false);
    expect(isStoryViewerPostId('post-77')).toBe(false);
  });
});

describe('storyToNowPlaying', () => {
  it('passes the REAL clip window through so GAP loads at the clip start', () => {
    const info = storyToNowPlaying(makeStory({ clipStartSec: 12, clipEndSec: 27 }));
    // setNowPlaying's new-post branch only arms positionRef = clipStart /
    // clipWindowRef when BOTH bounds are non-null. Returning null (the old
    // behaviour) forced positionRef = 0 and played from 0:00 / the feed position.
    expect(info.clipStartSec).toBe(12);
    expect(info.clipEndSec).toBe(27);
  });

  it('always yields NON-NULL bounds, guarding legacy null clip rows', () => {
    // Both bounds must stay non-null or setNowPlaying will NOT arm the window.
    // A legacy null start falls back to 0; a null end to start + fallback length.
    const nullStart = storyToNowPlaying(
      makeStory({ clipStartSec: null as unknown as number, clipEndSec: 8 }),
    );
    expect(nullStart.clipStartSec).toBe(0);
    expect(nullStart.clipEndSec).toBe(8);

    const nullEnd = storyToNowPlaying(
      makeStory({ clipStartSec: 5, clipEndSec: null as unknown as number }),
    );
    expect(nullEnd.clipStartSec).toBe(5);
    expect(nullEnd.clipEndSec).not.toBeNull();
    expect(nullEnd.clipEndSec! > nullEnd.clipStartSec!).toBe(true);
  });

  it('uses the synthetic story post id (not a real posts row)', () => {
    const info = storyToNowPlaying(makeStory({ id: 'story-abc' }));
    expect(info.postId).toBe('story_viewer_story-abc');
    expect(isStoryViewerPostId(info.postId)).toBe(true);
  });

  it('maps the track media through for GAP to play', () => {
    const info = storyToNowPlaying(makeStory());
    expect(info.trackId).toBe('track-9');
    expect(info.mediaKind).toBe('audio');
    expect(info.audioUrl).toBe('https://cdn/audio.mp3');
    expect(info.title).toBe('Midnight');
  });

  it('prefers the author display name, falling back to username', () => {
    expect(storyToNowPlaying(makeStory()).artistName).toBe('Nova Vibe');
    const noDisplay = makeStory({
      author: { id: 'user-1', username: 'nova', displayName: null, avatarUrl: null },
    });
    expect(storyToNowPlaying(noDisplay).artistName).toBe('nova');
  });

  it('carries a video story\'s videoUrl (still played muted-frame + GAP audio)', () => {
    const video = makeStory({
      track: {
        id: 'track-v',
        title: 'Clip',
        mediaKind: 'video',
        audioUrl: null,
        videoUrl: 'https://cdn/clip.mp4',
        coverArtUrl: null,
        thumbnailUrl: null,
        durationSeconds: null,
      },
    });
    const info = storyToNowPlaying(video);
    expect(info.mediaKind).toBe('video');
    expect(info.videoUrl).toBe('https://cdn/clip.mp4');
    expect(info.audioUrl).toBeUndefined();
  });

  it('zeroes engagement — stories have no like/comment/repost surface', () => {
    const info = storyToNowPlaying(makeStory());
    expect(info.likesCount).toBe(0);
    expect(info.commentsCount).toBe(0);
    expect(info.repostsCount).toBe(0);
    expect(info.viewerHasLiked).toBe(false);
    expect(info.kind).toBe('upload');
    expect(info.originalPostId).toBeNull();
  });
});
