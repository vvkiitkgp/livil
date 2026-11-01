import { useCallback, useRef } from 'react';
import { usePlaybackIfAny } from '../contexts/PlaybackContext';
import { playerCommentsTarget } from '../utils/commentsDelta';

/**
 * Keeps the full-screen player's comment count in step with comments made OUTSIDE it — on a
 * feed or profile card, or a post's page. The player reads its counts from the now-playing
 * snapshot taken when the song started, and only its own comments sheet updated it, so a
 * comment from the Uploads list left the player showing 0 (owner report, 2026-11-02).
 *
 * Returns `sync(postId, delta)`: call it wherever such a screen applies a comment-count change.
 * A no-op when nothing is playing, when the change is for another post, or outside playback.
 */
export function useNowPlayingCommentsSync(): (postId: string, delta: number) => void {
  const playback = usePlaybackIfAny();
  // Read at event time, not render time: the sheet reports changes long after this render.
  const ref = useRef(playback);
  ref.current = playback;
  return useCallback((postId: string, delta: number) => {
    const p = ref.current;
    const target = p ? playerCommentsTarget(p.nowPlaying, postId) : null;
    if (p && target && delta !== 0) p.bumpCommentsCount(delta, target.isOriginal);
  }, []);
}
