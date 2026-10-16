import { supabase } from '../../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { notifyPostActivity } from './activity';

export type CommentAuthor = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

/** A song shared in a comment: a Livil upload (its post) or a Spotify track (ADR-0027). */
export type CommentSong =
  | { kind: 'livil'; postId: string }
  | { kind: 'spotify'; trackId: string };

export type CommentNode = {
  id: string;
  postId: string;
  authorId: string;
  author: CommentAuthor;
  /** As stored. With a song, its last line is `songLabel` — use `commentDisplayText`. */
  body: string;
  song: CommentSong | null;
  songLabel: string | null;
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
  /** Absent before migration 20261029000000 (see songColumnsMissing). */
  song_post_id?: string | null;
  song_spotify_track_id?: string | null;
  song_label?: string | null;
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

const COMMENT_SELECT_BASE = `
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

const COMMENT_SELECT_WITH_SONG = `${COMMENT_SELECT_BASE}, song_post_id, song_spotify_track_id, song_label`;

// ── Songs in comments, before and after the backend change ─────────────────
//
// The app can reach users before migration 20261029000000 is applied (or run against a
// backend where it is not). Selecting or inserting a column that does not exist fails the
// whole request — every comment sheet would come up empty. So the first such failure
// flips this switch and the request is retried without the song columns; a song comment
// still posts, as its body (which already ends with the song's label line).
let songColumnsMissing = false;

function isMissingSongColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) { return false; }
  // 42703: undefined column (select). PGRST204: column not in the schema cache (insert).
  return (error.code === '42703' || error.code === 'PGRST204')
    && /song_(post_id|spotify_track_id|label)/.test(error.message ?? '');
}

function commentSelect(): string {
  return songColumnsMissing ? COMMENT_SELECT_BASE : COMMENT_SELECT_WITH_SONG;
}

/** Test-only: reset the switch between cases. */
export function __resetSongColumnsMissingForTest(): void {
  songColumnsMissing = false;
}

/** The text a shared song carries in `body`: "🎵 Kesariya — Arijit Singh". */
export function songLabelFor(title: string, artist: string | null): string {
  const t = title.trim() || 'A song';
  const a = artist?.trim();
  return `🎵 ${a ? `${t} — ${a}` : t}`.slice(0, 200);
}

/**
 * What is stored as `body`: what was typed, then the song's label on its own last line —
 * or just the label when nothing was typed. Apps that predate songs in comments show it
 * as it is; this one strips the label back off (`commentDisplayText`).
 */
export function composeCommentBody(text: string, songLabel: string | null): string {
  const typed = text.trim();
  if (!songLabel) { return typed; }
  return typed ? `${typed}\n${songLabel}` : songLabel;
}

/**
 * The words to show above a comment's song card: the body without its label line. A
 * comment whose song has gone (the shared upload was deleted) shows its body whole, so the
 * label still says what was shared.
 */
export function commentDisplayText(node: Pick<CommentNode, 'body' | 'song' | 'songLabel'>): string {
  const { body, song, songLabel } = node;
  if (!song || !songLabel) { return body; }
  if (body === songLabel) { return ''; }
  const suffix = `\n${songLabel}`;
  return body.endsWith(suffix) ? body.slice(0, -suffix.length) : body;
}

function songOf(row: RawCommentRow): CommentSong | null {
  if (row.song_post_id) { return { kind: 'livil', postId: row.song_post_id }; }
  if (row.song_spotify_track_id) { return { kind: 'spotify', trackId: row.song_spotify_track_id }; }
  return null;
}

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
    song: songOf(row),
    songLabel: row.song_label ?? null,
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
  const query = () => supabase
    .from('post_comments')
    .select(commentSelect())
    .eq('post_id', postId)
    .order('like_count', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  let { data, error } = await query();
  if (isMissingSongColumn(error)) {
    songColumnsMissing = true;
    ({ data, error } = await query());
  }

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

/**
 * Post a comment. `song`, when given, is shared with it: `body` is then what was typed
 * (possibly nothing) and the song's label is added as its last line (composeCommentBody).
 */
export async function createComment(
  postId: string,
  body: string,
  parentCommentId: string | null = null,
  song: { song: CommentSong; label: string } | null = null,
): Promise<CommentNode> {
  const trimmed = composeCommentBody(body, song?.label ?? null);
  if (!trimmed) {
    throw new Error('Comment cannot be empty.');
  }
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    throw new Error('You must be signed in to comment.');
  }
  const me = userData.user.id;

  const base = {
    post_id: postId,
    author_id: me,
    body: trimmed,
    parent_comment_id: parentCommentId,
  };
  const songFields = song
    ? {
        song_post_id: song.song.kind === 'livil' ? song.song.postId : null,
        song_spotify_track_id: song.song.kind === 'spotify' ? song.song.trackId : null,
        song_label: song.label,
      }
    : {};
  const insert = () => supabase
    .from('post_comments')
    .insert(songColumnsMissing ? base : { ...base, ...songFields })
    .select(commentSelect())
    .single();
  let { data, error } = await insert();
  if (isMissingSongColumn(error)) {
    // The backend has no song columns yet: post it as its body, label line and all.
    songColumnsMissing = true;
    ({ data, error } = await insert());
  }

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
            .select(commentSelect())
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
