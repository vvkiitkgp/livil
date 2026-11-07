import { useCallback, useSyncExternalStore } from 'react';
import { readLike, subscribeLike } from '../utils/likeStore';

/**
 * The likes on a repost's original upload, for the number on the repost's cover. `fetched` is
 * what the post's load read (attachOriginalLikes); the shared tally wins once any surface knows
 * the upload, so a like on it in the player shows here at once. 0 when there is nothing to show:
 * not a repost of a Livil upload, or the count is unknown.
 *
 * Reads the tally and never seeds it, unlike usePostLike: a repost card doesn't know whether the
 * viewer liked the upload, and a seeded guess would put the wrong heart on the upload itself.
 */
export function useOriginalLikes(originalPostId: string | null, fetched: number | undefined): number {
  const subscribe = useCallback(
    (notify: () => void) => (originalPostId ? subscribeLike(originalPostId, notify) : () => {}),
    [originalPostId],
  );
  const known = useSyncExternalStore(subscribe, () =>
    originalPostId ? readLike(originalPostId)?.count : undefined,
  );
  return known ?? fetched ?? 0;
}
