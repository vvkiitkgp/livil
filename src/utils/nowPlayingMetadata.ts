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
  /**
   * Album name surfaced ONLY in the OS / car MediaSession (Android media3
   * MediaMetadata.albumTitle, iOS MPMediaItemPropertyAlbumTitle). Never read
   * by in-app UI — the Info card already hides itself when there is no
   * album. We default to `"Single"` when the track has no album so car HUs
   * never show a blank field.
   */
  album: string;
  imageUri?: string;
};

/** What we display in the car when a track has no album. Music-industry
 *  convention for an unaffiliated release. */
export const ALBUM_DEFAULT_FOR_METADATA = 'Single';

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
    // null AND undefined both fall back — see the NowPlayingInfo.albumTitle
    // tri-state comment.
    album: info.albumTitle && info.albumTitle.length > 0 ? info.albumTitle : ALBUM_DEFAULT_FOR_METADATA,
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
  const items = queue.map(t => {
    const active = t.clipStartSec != null && t.clipEndSec != null;
    return {
      id: t.postId,
      uri: t.audioUrl ?? t.videoUrl ?? '',
      title: t.title,
      artist: t.artistName,
      artwork: t.coverArtUrl ?? t.thumbnailUrl ?? undefined,
      clipStartMs: active ? Math.round(t.clipStartSec! * 1000) : 0,
      clipEndMs: active ? Math.round(t.clipEndSec! * 1000) : 0,
      // Explicit flag so the native side never infers "clipped" from start>0
      // (a clip can legitimately start at 0 with a non-full end).
      clipActive: active,
    };
  });
  return JSON.stringify({ index, items });
}

/**
 * Serialises the CURRENT track's clip window for react-native-video's
 * `currentClipJson` prop (Android). The playback service presents this as a
 * clip-relative "song" on the lock screen — duration `endMs-startMs`, position
 * `absolute-startMs`, scrubber seeks mapped back by `+startMs` — via a
 * ForwardingPlayer, and enforces clip-end natively (loop when `repeatOne`, else
 * advance) so it works while the app is backgrounded.
 *
 * `clipWindow` is the live, possibly user-dragged window in ABSOLUTE seconds
 * (PlaybackContext.clipWindowRef), or null when the track has no clip.
 */
export function buildCurrentClipJson(
  clipWindow: { start: number; end: number } | null,
  repeatMode: 'off' | 'all' | 'one',
): string {
  const active = clipWindow != null && clipWindow.end > clipWindow.start;
  return JSON.stringify({
    startMs: active ? Math.round(clipWindow!.start * 1000) : 0,
    endMs: active ? Math.round(clipWindow!.end * 1000) : 0,
    active,
    repeatOne: repeatMode === 'one',
  });
}

/**
 * Serialises the in-app shuffle/repeat state for react-native-video's
 * `mediaSessionStateJson` prop (Android). The playback service pushes this into
 * ClipForwardingPlayer's setRepeatMode / setShuffleModeEnabled, which forces
 * the MediaSession to republish PlaybackState — so a Bluetooth car HU, Wear OS,
 * Assistant, etc. show the correct shuffle/repeat icons.
 *
 * The reverse direction (a controller toggling shuffle/repeat on the car) comes
 * back through the onVideoRepeatModeChange / onVideoShuffleModeChange events.
 */
export function buildMediaSessionStateJson(
  repeatMode: 'off' | 'all' | 'one',
  shuffleEnabled: boolean,
): string {
  return JSON.stringify({ repeatMode, shuffleEnabled });
}
