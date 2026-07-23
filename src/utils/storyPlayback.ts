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
 * `clipStartSec` / `clipEndSec` are deliberately NULL: we do NOT want GAP's
 * native Android clip-end watcher to auto-advance the queue mid-story (it would
 * jump into whatever queue is loaded). The story viewer's own timer governs
 * advance, and it seeks GAP to the clip start manually via `markSeekTarget`.
 *
 * Engagement counts are zeroed and `kind` is a plain `'upload'` — stories carry
 * no like/comment/repost surface, and the synthetic post id has no metrics row.
 */
export function storyToNowPlaying(story: Story): NowPlayingInfo {
  const t = story.track;
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
    clipStartSec: null,
    clipEndSec: null,
    kind: 'upload',
    originalPostId: null,
    knownDurationSec: 0,
  };
}
