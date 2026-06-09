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
