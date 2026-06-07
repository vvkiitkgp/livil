import { useCallback, useState } from 'react';
import type { FeedPost } from '../services/posts';

/**
 * Lets a feed screen open the CommentsSheet for one post at a time and apply
 * net commentsCount deltas (from optimistic creates / realtime inserts /
 * deletes) without refetching the feed. PostCard stays a controlled component
 * — the feed passes a `withDelta(post)` copy with the adjusted count.
 */
export function useCommentsCountDeltas() {
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [deltas, setDeltas] = useState<Record<string, number>>({});

  const openComments = useCallback((postId: string) => {
    setCommentsPostId(postId);
  }, []);

  const closeComments = useCallback(() => {
    setCommentsPostId(null);
  }, []);

  const applyDelta = useCallback((postId: string, delta: number) => {
    setDeltas(prev => {
      const next = (prev[postId] ?? 0) + delta;
      return { ...prev, [postId]: next };
    });
  }, []);

  const withDelta = useCallback(
    <T extends Pick<FeedPost, 'id' | 'commentsCount'>>(post: T): T => {
      const d = deltas[post.id];
      if (!d) { return post; }
      return { ...post, commentsCount: Math.max(post.commentsCount + d, 0) };
    },
    [deltas],
  );

  return {
    commentsPostId,
    openComments,
    closeComments,
    applyDelta,
    withDelta,
  };
}
