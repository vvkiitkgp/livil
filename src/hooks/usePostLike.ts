import { useCallback, useEffect, useState } from 'react';
import { likePost, toggleLike } from '../services/posts';
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
  /** Goes up on every like (never an unlike) — what LikeHeart bounces on. */
  const [likePulse, setLikePulse] = useState(0);

  useEffect(() => {
    setLiked(post.viewerHasLiked);
    setLikesCount(post.likesCount);
  }, [post.id, post.viewerHasLiked, post.likesCount]);

  const toggle = useCallback(async () => {
    // Optimistic update — flip immediately, revert on failure.
    const prevLiked = liked;
    const prevCount = likesCount;
    const nextLiked = !prevLiked;
    // The heart bounces on the way ON only — unliking is not an achievement either.
    if (nextLiked) { setLikePulse(n => n + 1); }
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

  /**
   * Double-tap on the artwork: only ever LIKES. A second double tap on a liked post is an
   * acknowledgement (the heart pops again), never an undo — undoing is the heart's job.
   *
   * Calls `likePost`, not the toggle: this card's `liked` can be stale (liked on another
   * screen), and a toggle would then remove the like. When it was stale, the count shown
   * was stale too — missing that like — so the +1 below lands on the right number.
   */
  const like = useCallback(async () => {
    setLikePulse(n => n + 1);
    if (liked) { return; }
    const prevCount = likesCount;
    haptics.toggleOn();
    setLiked(true);
    setLikesCount(likeCountAfterToggle(prevCount, false, true));
    try {
      await likePost(post.id);
    } catch {
      setLiked(false);
      setLikesCount(prevCount);
    }
  }, [liked, likesCount, post.id]);

  return { liked, likesCount, likePulse, toggleLike: toggle, like };
}
