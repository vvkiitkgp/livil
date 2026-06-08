import { supabase } from '../../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { notifyPostActivity } from './activity';

export type CommentAuthor = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export type CommentNode = {
  id: string;
  postId: string;
  authorId: string;
  author: CommentAuthor;
  body: string;
  parentCommentId: string | null;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
  replies: CommentNode[];
};

type RawCommentRow = {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  parent_comment_id: string | null;
  created_at: string;
  like_count: number;
  author: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
};

const COMMENT_SELECT = `
  id,
  post_id,
  author_id,
  body,
  parent_comment_id,
  created_at,
  like_count,
  author:profiles!post_comments_author_id_fkey (
    id,
    username,
    display_name,
    avatar_url
  )
` as const;

function toAuthor(row: RawCommentRow['author']): CommentAuthor {
  if (!row) {
    return { id: '', username: 'unknown', displayName: null, avatarUrl: null };
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
  };
}

function rowToNode(row: RawCommentRow, likedByMe: boolean): CommentNode {
  return {
    id: row.id,
    postId: row.post_id,
    authorId: row.author_id,
    author: toAuthor(row.author),
    body: row.body,
    parentCommentId: row.parent_comment_id,
    createdAt: row.created_at,
    likeCount: row.like_count ?? 0,
    likedByMe,
    replies: [],
  };
}

/**
 * Fetch every comment on a post in one round-trip (up to `limit` rows, default
 * 100). Top-level comments come back sorted by likes desc, recency desc;
 * replies inherit the same order within their parent. The tree is built
 * client-side because v1 caps total threads at ~100 — once posts routinely
 * exceed that, switch to paginated top-level fetch + lazy reply expansion.
 */
export async function fetchPostComments(
  postId: string,
  limit: number = 100,
): Promise<CommentNode[]> {
  const { data, error } = await supabase
    .from('post_comments')
    .select(COMMENT_SELECT)
    .eq('post_id', postId)
    .order('like_count', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as unknown as RawCommentRow[];
  if (rows.length === 0) {
    return [];
  }

  let likedSet = new Set<string>();
  const { data: userData } = await supabase.auth.getUser();
  const viewerId = userData?.user?.id ?? null;
  if (viewerId) {
    const { data: likes } = await supabase
      .from('post_comment_likes')
      .select('comment_id')
      .eq('user_id', viewerId)
      .in('comment_id', rows.map(r => r.id));
    likedSet = new Set((likes ?? []).map(l => l.comment_id));
  }

  const nodes: CommentNode[] = rows.map(r => rowToNode(r, likedSet.has(r.id)));
  return buildTree(nodes);
}

function buildTree(nodes: CommentNode[]): CommentNode[] {
  const byId = new Map<string, CommentNode>();
  for (const n of nodes) {
    byId.set(n.id, n);
  }
  const roots: CommentNode[] = [];
  for (const n of nodes) {
    if (n.parentCommentId && byId.has(n.parentCommentId)) {
      byId.get(n.parentCommentId)!.replies.push(n);
    } else {
      roots.push(n);
    }
  }
  return roots;
}

export async function createComment(
  postId: string,
  body: string,
  parentCommentId: string | null = null,
): Promise<CommentNode> {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new Error('Comment cannot be empty.');
  }
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    throw new Error('You must be signed in to comment.');
  }
  const me = userData.user.id;

  const { data, error } = await supabase
    .from('post_comments')
    .insert({
      post_id: postId,
      author_id: me,
      body: trimmed,
      parent_comment_id: parentCommentId,
    })
    .select(COMMENT_SELECT)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create comment.');
  }
  // Fan out an activity notification to the post author (self-comment is
  // filtered server-side). Fire-and-forget — never block the comment.
  const created = data as unknown as RawCommentRow;
  void notifyPostActivity(postId, 'comment', {
    commentText: trimmed,
    commentId: created.id,
  });
  return rowToNode(created, false);
}

export async function deleteComment(commentId: string): Promise<void> {
  const { error } = await supabase
    .from('post_comments')
    .delete()
    .eq('id', commentId);
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Toggle the viewer's like on a comment. Returns the resulting liked state.
 * Mirrors `toggleLike` in src/services/posts.ts.
 */
export async function toggleCommentLike(commentId: string): Promise<boolean> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    throw new Error('You must be signed in to like a comment.');
  }
  const me = userData.user.id;

  const { data: existing, error: selError } = await supabase
    .from('post_comment_likes')
    .select('comment_id')
    .eq('comment_id', commentId)
    .eq('user_id', me)
    .maybeSingle();
  if (selError) {
    throw new Error(selError.message);
  }

  if (existing) {
    const { error: delError } = await supabase
      .from('post_comment_likes')
      .delete()
      .eq('comment_id', commentId)
      .eq('user_id', me);
    if (delError) {
      throw new Error(delError.message);
    }
    return false;
  }

  const { error: insError } = await supabase
    .from('post_comment_likes')
    .insert({ comment_id: commentId, user_id: me });
  if (insError) {
    throw new Error(insError.message);
  }
  return true;
}

export type ReportReason = 'spam' | 'harassment' | 'hate' | 'misinformation' | 'other';

export async function reportComment(
  commentId: string,
  reason: ReportReason,
  details?: string,
): Promise<void> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    throw new Error('You must be signed in to report.');
  }
  const me = userData.user.id;

  const trimmed = details?.trim();
  const { error } = await supabase.from('post_comment_reports').insert({
    comment_id: commentId,
    reporter_id: me,
    reason,
    details: trimmed && trimmed.length > 0 ? trimmed : null,
  });
  if (error) {
    throw new Error(error.message);
  }
}

export type MentionProfile = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export async function searchUsernamesForMention(
  query: string,
  limit: number = 6,
): Promise<MentionProfile[]> {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return [];
  }
  const pattern = `${trimmed.replace(/[%_]/g, '\\$&')}%`;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .ilike('username', pattern)
    .order('username', { ascending: true })
    .limit(limit);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map(p => ({
    id: p.id as string,
    username: p.username as string,
    displayName: (p.display_name as string | null) ?? null,
    avatarUrl: (p.avatar_url as string | null) ?? null,
  }));
}

// ── Realtime ────────────────────────────────────────────────────────────────

const activeChannels: Map<string, RealtimeChannel> = new Map();

export type CommentRealtimeHandlers = {
  /** Called when another user inserts a comment on this post. Own inserts are skipped (already optimistic). */
  onInsert: (node: CommentNode) => void;
  /** Called when a comment is deleted (cascade descendants are pruned on the client). */
  onDelete: (commentId: string) => void;
  /** Called when a comment's like_count changes (from any user's like/unlike). */
  onLikeCountChange: (commentId: string, likeCount: number) => void;
};

export function subscribeToPostComments(
  postId: string,
  handlers: CommentRealtimeHandlers,
): RealtimeChannel {
  const key = `post-comments:${postId}`;
  activeChannels.get(key)?.unsubscribe();

  const channel = supabase
    .channel(key)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'post_comments',
        filter: `post_id=eq.${postId}`,
      },
      async payload => {
        try {
          const newId = (payload.new as { id?: string })?.id;
          if (!newId) { return; }
          const { data: userData } = await supabase.auth.getUser();
          const myId = userData?.user?.id ?? '';
          const insertedAuthor = (payload.new as { author_id?: string })?.author_id;
          // Skip echo for the local viewer — handled by optimistic insert.
          if (insertedAuthor === myId) { return; }
          const { data, error } = await supabase
            .from('post_comments')
            .select(COMMENT_SELECT)
            .eq('id', newId)
            .single();
          if (error || !data) { return; }
          handlers.onInsert(rowToNode(data as unknown as RawCommentRow, false));
        } catch {
          // swallow — realtime hydration failures are best-effort
        }
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'post_comments',
        filter: `post_id=eq.${postId}`,
      },
      payload => {
        const oldId = (payload.old as { id?: string })?.id;
        if (oldId) { handlers.onDelete(oldId); }
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'post_comments',
        filter: `post_id=eq.${postId}`,
      },
      payload => {
        const row = payload.new as { id?: string; like_count?: number };
        if (row?.id && typeof row.like_count === 'number') {
          handlers.onLikeCountChange(row.id, row.like_count);
        }
      },
    )
    .subscribe();

  activeChannels.set(key, channel);
  return channel;
}

export function unsubscribeFromPostComments(postId: string): void {
  const key = `post-comments:${postId}`;
  activeChannels.get(key)?.unsubscribe();
  activeChannels.delete(key);
}
