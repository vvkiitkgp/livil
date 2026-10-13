import { useCallback, useEffect, useState } from 'react';
import { toggleLike } from '../services/posts';
import { haptics } from '../utils/haptics';
import { likeCountAfterToggle } from '../utils/likeCount';

/**
 * A post card's heart: optimistic like/unlike, settled on the server's answer.
 *
 * The card keeps its own copy of the numbers so a tap shows at once. That copy is replaced
 * whenever the post it is given carries different numbers — a pull-to-refresh keeps the same
 * card mounted (same key), so a copy taken only at mount survived every refresh, wrong count
 * and all. The same stale numbers handed back on a re-render change nothing, so they never
 * undo a tap made since.
 */
export function usePostLike(post: { id: string; viewerHasLiked: boolean; likesCount: number }) {
  const [liked, setLiked] = useState(post.viewerHasLiked);
  const [likesCount, setLikesCount] = useState(post.likesCount);

  useEffect(() => {
    setLiked(post.viewerHasLiked);
    setLikesCount(post.likesCount);
  }, [post.id, post.viewerHasLiked, post.likesCount]);

  const toggle = useCallback(async () => {
    // Optimistic update — flip immediately, revert on failure.
    const prevLiked = liked;
    const prevCount = likesCount;
    const nextLiked = !prevLiked;
    // Only on the way ON — unliking is not an achievement, and buzzing both
    // directions turns an accidental double-tap into a rattle.
    if (nextLiked) { haptics.toggleOn(); }
    setLiked(nextLiked);
    setLikesCount(likeCountAfterToggle(prevCount, prevLiked, nextLiked));
    try {
      const serverLiked = await toggleLike(post.id);
      if (serverLiked !== nextLiked) {
        // Server disagreed (the like was changed on another screen) — trust the server.
        setLiked(serverLiked);
        setLikesCount(likeCountAfterToggle(prevCount, prevLiked, serverLiked));
      }
    } catch {
      setLiked(prevLiked);
      setLikesCount(prevCount);
    }
  }, [liked, likesCount, post.id]);

  return { liked, likesCount, toggleLike: toggle };
}
