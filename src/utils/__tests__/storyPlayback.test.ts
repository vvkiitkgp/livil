/**
 * Tests for story→GAP playback mapping.
 *
 * WHY
 *
 * A story's audio must play through the SINGLE GlobalAudioPlayer engine (ADR-0001),
 * not a second <Video>. The screen does that by feeding GAP a NowPlayingInfo built
 * here. Two properties are load-bearing and silent if wrong:
 *
 *   1. clip bounds are NULL — if a real clip window leaked through, GAP's native
 *      Android clip-end watcher would auto-advance the queue mid-story (jumping to
 *      a stale/wrong track). No crash, just the wrong track.
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
  it('passes NO clip window to GAP so native clip-end never advances the queue', () => {
    const info = storyToNowPlaying(makeStory({ clipStartSec: 12, clipEndSec: 27 }));
    // The story clip is 12→27, but GAP must load the full track with no clip —
    // the viewer seeks to the start itself and its own timer advances.
    expect(info.clipStartSec).toBeNull();
    expect(info.clipEndSec).toBeNull();
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
