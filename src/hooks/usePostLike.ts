import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { likePost, unlikePost } from '../services/posts';
import { haptics } from '../utils/haptics';
import { likeCountAfterToggle } from '../utils/likeCount';
import { queueLikeWrite, readLike, seedLike, subscribeLike, writeLike, type LikeState } from '../utils/likeStore';

/**
 * A post's heart, on any surface — feed and profile cards, and all three hearts in the
 * full-screen player. The numbers live in ONE shared tally per post (src/utils/likeStore.ts),
 * so a like anywhere shows everywhere at once (owner, 2026-10-19: the player said 4, the
 * profile card still said 3).
 *
 * The `post` handed in is a snapshot taken when that surface loaded:
 *   - the FIRST time a surface shows a post, the snapshot only fills the tally if nothing is
 *     known — it may be older than what another surface already knows;
 *   - a CHANGED snapshot for the same post is a fresh read (a pull-to-refresh keeps the same
 *     card mounted, with new numbers), so it updates the tally for everyone.
 *
 * Taps send the intent the heart SHOWED — likePost or unlikePost — never a toggle of the
 * server's state, and they go out in order (queueLikeWrite).
 */
export function usePostLike(post: { id: string; viewerHasLiked: boolean; likesCount: number }) {
  // In render, so the very first paint already shows the shared tally. Idempotent.
  seedLike(post.id, { liked: post.viewerHasLiked, count: post.likesCount });
  const subscribe = useCallback((notify: () => void) => subscribeLike(post.id, notify), [post.id]);
  const state = useSyncExternalStore(subscribe, () => readLike(post.id)!);

  /** Goes up on every like (never an unlike) — what LikeHeart bounces on. */
  const [likePulse, setLikePulse] = useState(0);

  // A changed snapshot of the SAME post is a fresh read: newer than anything known.
  const lastSnapshot = useRef<{ id: string; liked: boolean; count: number } | null>(null);
  useEffect(() => {
    const before = lastSnapshot.current;
    lastSnapshot.current = { id: post.id, liked: post.viewerHasLiked, count: post.likesCount };
    if (before && before.id === post.id && (before.liked !== post.viewerHasLiked || before.count !== post.likesCount)) {
      writeLike(post.id, { liked: post.viewerHasLiked, count: post.likesCount });
    }
  }, [post.id, post.viewerHasLiked, post.likesCount]);

  /** Optimistic: shown at once everywhere; put back only if nothing newer happened since. */
  const send = useCallback(async (from: LikeState, nextLiked: boolean) => {
    writeLike(post.id, { liked: nextLiked, count: likeCountAfterToggle(from.count, from.liked, nextLiked) });
    try {
      await queueLikeWrite(post.id, () => (nextLiked ? likePost(post.id) : unlikePost(post.id)));
    } catch {
      if (readLike(post.id)?.liked === nextLiked) { writeLike(post.id, from); }
    }
  }, [post.id]);

  const toggle = useCallback(async () => {
    const from = readLike(post.id) ?? state;
    const nextLiked = !from.liked;
    // Only on the way ON: unliking is not an achievement, and bouncing or buzzing both
    // directions turns an accidental double tap into a rattle.
    if (nextLiked) {
      setLikePulse(n => n + 1);
      haptics.toggleOn();
    }
    await send(from, nextLiked);
  }, [post.id, state, send]);

  /**
   * Double-tap on the artwork: only ever LIKES. A second double tap on a liked post is an
   * acknowledgement (the heart pops again), never an undo — undoing is the heart's job.
   */
  const like = useCallback(async () => {
    setLikePulse(n => n + 1);
    const from = readLike(post.id) ?? state;
    if (from.liked) { return; }
    haptics.toggleOn();
    await send(from, true);
  }, [post.id, state, send]);

  return { liked: state.liked, likesCount: state.count, likePulse, toggleLike: toggle, like };
}
