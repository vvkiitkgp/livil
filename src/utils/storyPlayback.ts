import type { Story } from '../services/stories';
import type { NowPlayingInfo } from '../contexts/PlaybackContext';

/**
 * Story playback helpers.
 *
 * A story's AUDIO plays through the single `GlobalAudioPlayer` engine (ADR-0001) —
 * never a second `<Video>`. To do that the story viewer feeds GAP a
 * `NowPlayingInfo` built from the story's track. These helpers own the synthetic
 * "post id" convention and that mapping so both the screen and the play-count
 * tracker agree on it (and so the mapping is unit-testable without the screen).
 *
 * Types are imported type-only, so this util has NO runtime dependency on the
 * services / context modules — no cycle.
 */

const STORY_VIEWER_POST_PREFIX = 'story_viewer_';

/**
 * Fallback clip length (seconds) applied only if a legacy story row has a null
 * `clipEndSec`. Stories are persisted with a non-null clip today (author-side
 * validation caps a clip at 10s), so this is purely defensive — it keeps the
 * end bound non-null so `setNowPlaying` still arms the clip window.
 */
const STORY_CLIP_FALLBACK_LEN = 10;

/**
 * The playback-slot id the story viewer assigns while a story drives GAP. It is
 * NOT a real `posts` row id — it is scoped so it can never collide with a feed
 * post's id, and so play-count recording can be skipped for it.
 */
export function storyViewerPostId(storyId: string): string {
  return `${STORY_VIEWER_POST_PREFIX}${storyId}`;
}

/**
 * True for a synthetic story-viewer playback id. Callers that hit the DB by
 * post id (e.g. the play-count tracker → `activity_record_play(uuid)`) must skip
 * these — the id is not a uuid and the cast fails every time.
 */
export function isStoryViewerPostId(postId: string): boolean {
  return postId.startsWith(STORY_VIEWER_POST_PREFIX);
}

/**
 * Build a `NowPlayingInfo` so a story's audio plays through GAP.
 *
 * The story's REAL clip window (`clipStartSec` / `clipEndSec`) is passed through.
 * `setNowPlaying`'s new-post branch only arms the clip window (positionRef =
 * clipStart, clipWindowRef = {start,end}) when BOTH bounds are non-null — so GAP
 * loads AT the clip start instead of 0:00, and the muted picture frame lines up.
 * The story viewer keeps a one-item queue AND forces `repeatMode` to 'off' for
 * the session (see StoryViewerScreen), so GAP's native clip-end watcher resolves
 * any advance to a no-op instead of looping/jumping into a stale queue; the
 * viewer's own timer governs the visible advance.
 *
 * (This previously returned NULL clip bounds. That forced positionRef = 0 in the
 * deferred `setNowPlaying` updater, which raced and overwrote the synchronous
 * `markSeekTarget(clipStart)` — so the viewer played the FULL track from 0:00 or
 * continued from the prior feed position. Fixed in LIV-31 round 2.)
 *
 * Bounds are guarded against legacy NULLs so both stay non-null (start → 0,
 * end → start + `STORY_CLIP_FALLBACK_LEN`); the `setNowPlaying` guard only arms
 * the window when both are non-null.
 *
 * Engagement counts are zeroed and `kind` is a plain `'upload'` — stories carry
 * no like/comment/repost surface, and the synthetic post id has no metrics row.
 */
export function storyToNowPlaying(story: Story): NowPlayingInfo {
  const t = story.track;
  const clipStartSec = story.clipStartSec ?? 0;
  const clipEndSec = story.clipEndSec ?? clipStartSec + STORY_CLIP_FALLBACK_LEN;
  return {
    postId: storyViewerPostId(story.id),
    trackId: t.id,
    title: t.title,
    artistName: story.author.displayName ?? story.author.username,
    authorId: story.author.id,
    authorUsername: story.author.username,
    authorAvatarUrl: story.author.avatarUrl,
    coverArtUrl: t.coverArtUrl,
    thumbnailUrl: t.thumbnailUrl,
    mediaKind: t.mediaKind,
    audioUrl: t.audioUrl ?? undefined,
    videoUrl: t.videoUrl ?? undefined,
    likesCount: 0,
    commentsCount: 0,
    repostsCount: 0,
    viewsCount: 0,
    viewerHasLiked: false,
    clipStartSec,
    clipEndSec,
    kind: 'upload',
    originalPostId: null,
    knownDurationSec: 0,
  };
}
