import type { NowPlayingInfo } from '../contexts/PlaybackContext';

/**
 * react-native-video `source.metadata` shape (VideoMetadata). These fields drive
 * the OS "now playing" surface: Android media3 MediaSession notification + lock
 * screen, and iOS MPNowPlayingInfoCenter (lock screen / Control Center / Dynamic
 * Island). Only the fields we populate are listed.
 */
export type NowPlayingMetadata = {
  title: string;
  artist: string;
  subtitle: string;
  imageUri?: string;
};

/**
 * Builds the lock-screen / notification metadata for the currently-playing track.
 *
 * `imageUri` MUST be a reachable remote URL (R2 / Supabase public bucket) — a
 * null/local value yields a blank artwork tile on the lock screen. Audio posts
 * carry `coverArtUrl`; video posts fall back to their `thumbnailUrl`; as a last
 * resort we use the author's avatar so the tile is never empty.
 */
export function buildNowPlayingMetadata(info: NowPlayingInfo): NowPlayingMetadata {
  const imageUri =
    info.coverArtUrl ?? info.thumbnailUrl ?? info.authorAvatarUrl ?? undefined;
  return {
    title: info.title,
    artist: info.artistName,
    subtitle: info.artistName,
    ...(imageUri ? { imageUri } : {}),
  };
}

/**
 * Serialises the play queue + current index for react-native-video's
 * `mediaQueueJson` prop (Android). The native playback service uses it to load
 * the next/previous track DIRECTLY on the ExoPlayer when the user taps the
 * notification while the app is backgrounded — where a React `source`-prop
 * change would be deferred until the app returns to the foreground.
 *
 * The queue must be in play order and `index` must be the position of the
 * currently-playing track within it, so the service's index stays in lock-step
 * with the JS queue.
 */
export function buildMediaQueueJson(
  queue: NowPlayingInfo[],
  index: number,
): string {
  const items = queue.map(t => ({
    id: t.postId,
    uri: t.audioUrl ?? t.videoUrl ?? '',
    title: t.title,
    artist: t.artistName,
    artwork: t.coverArtUrl ?? t.thumbnailUrl ?? undefined,
    clipStartMs: t.clipStartSec != null ? Math.round(t.clipStartSec * 1000) : 0,
    clipEndMs: t.clipEndSec != null ? Math.round(t.clipEndSec * 1000) : 0,
  }));
  return JSON.stringify({ index, items });
}
