import { useCallback } from 'react';
import { usePlayback } from '../contexts/PlaybackContext';
import { useToast } from '../contexts/ToastContext';
import { usePlayFullScreen } from './usePlayFullScreen';
import { fetchPostsByIds, feedPostToNowPlaying } from '../services/posts';
import type { LibraryRecentTrack } from '../services/tracks';

/**
 * Tap a Recently Played row → play it, with the whole list queued in the SAME order
 * (the tapped song first; next/previous walk the list as shown). Each row plays through
 * the post it was last played from.
 *
 * Rows whose post is gone (deleted, blocked) are left out of the queue; tapping one of
 * those says so instead of playing something else.
 */
export function usePlayRecentlyPlayed() {
  const { setQueue, setNowPlaying, markSeekTarget, requestPlay } = usePlayback();
  const openFullScreen = usePlayFullScreen();
  const { showToast } = useToast();

  return useCallback(async (tracks: LibraryRecentTrack[], index: number) => {
    const tapped = tracks[index];
    if (!tapped?.postId) {
      showToast('That post is no longer available', { kind: 'info' });
      return;
    }
    try {
      const ids = tracks.map(t => t.postId).filter((id): id is string => !!id);
      const posts = await fetchPostsByIds(ids);
      const start = posts.findIndex(p => p.id === tapped.postId);
      if (start < 0) {
        showToast('That post is no longer available', { kind: 'info' });
        return;
      }
      const queue = posts.map(feedPostToNowPlaying);
      const first = queue[start]!;
      setQueue(queue, start, 'recently-played');
      setNowPlaying(first);
      markSeekTarget(first.clipStartSec ?? 0);
      requestPlay(first.postId);
      openFullScreen();
    } catch {
      showToast("Couldn't play that track", { kind: 'error' });
    }
  }, [setQueue, setNowPlaying, markSeekTarget, requestPlay, openFullScreen, showToast]);
}
