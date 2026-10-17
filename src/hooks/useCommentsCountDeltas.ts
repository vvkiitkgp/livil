import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeedPost } from '../services/posts';
import {
  addCommentsDelta,
  withCommentsDelta,
  type PendingCommentsDeltas,
} from '../utils/commentsDelta';

/**
 * Lets a feed screen open the CommentsSheet for one post at a time and apply
 * net commentsCount deltas (from optimistic creates / realtime inserts /
 * deletes) without refetching the feed. PostCard stays a controlled component
 * — the feed passes a `withDelta(post)` copy with the adjusted count.
 *
 * `posts` is the list the feed renders. Each delta remembers the count it was
 * made against, so a refresh that already includes it does not add it twice
 * (see utils/commentsDelta).
 */
export function useCommentsCountDeltas(posts: ReadonlyArray<Pick<FeedPost, 'id' | 'commentsCount'>>) {
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [deltas, setDeltas] = useState<PendingCommentsDeltas>({});

  // Read when a delta is applied — always from an event, after the render that
  // showed the sheet has committed.
  const postsRef = useRef(posts);
  useEffect(() => { postsRef.current = posts; }, [posts]);

  const openComments = useCallback((postId: string) => {
    setCommentsPostId(postId);
  }, []);

  const closeComments = useCallback(() => {
    setCommentsPostId(null);
  }, []);

  const applyDelta = useCallback((postId: string, delta: number) => {
    const base = postsRef.current.find(p => p.id === postId)?.commentsCount ?? null;
    setDeltas(prev => addCommentsDelta(prev, postId, delta, base));
  }, []);

  /**
   * After a pull-to-refresh: the counts just fetched include every change, so forget them.
   * The `base` check alone cannot tell — a count that changed and changed BACK (1 comment
   * added here, then deleted on another phone) reads as "server has not seen it", and the
   * stale +1 was re-applied to the fresh 0 on every refresh.
   */
  const clearDeltas = useCallback(() => setDeltas({}), []);

  const withDelta = useCallback(
    <T extends Pick<FeedPost, 'id' | 'commentsCount'>>(post: T): T =>
      withCommentsDelta(post, deltas[post.id]),
    [deltas],
  );

  return {
    commentsPostId,
    openComments,
    closeComments,
    applyDelta,
    clearDeltas,
    withDelta,
  };
}
