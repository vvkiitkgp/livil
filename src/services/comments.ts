import { supabase } from '../../lib/supabase';
import { noUserError } from './session';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { notifyCommentActivity, notifyMentions, notifyPostActivity } from './activity';
import { GIF_ID_RE } from '../utils/gifIds';

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

/**
 * A GIF shared in a comment (ADR-0031): the provider's id and its size only. Its media URL
 * is looked up fresh by id (services/gifs.ts), because GIPHY's terms forbid storing it.
 */
export type CommentGif = {
  provider: 'giphy';
  id: string;
  width: number;
  height: number;
};

export type CommentNode = {
  id: string;
  postId: string;
  authorId: string;
  author: CommentAuthor;
  /**
   * As stored. With a song its last line is `songLabel`, with a GIF it is `GIF_LABEL` —
   * use `commentDisplayText`.
   */
  body: string;
  song: CommentSong | null;
  songLabel: string | null;
  /** A comment carries a song or a GIF, never both (post_comments_one_attachment). */
  gif: CommentGif | null;
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
  /** Absent before migration 20261030000000 (see gifColumnsMissing). */
  gif_provider?: string | null;
  gif_id?: string | null;
  gif_width?: number | null;
  gif_height?: number | null;
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

const SONG_COLUMNS = 'song_post_id, song_spotify_track_id, song_label';
const GIF_COLUMNS = 'gif_provider, gif_id, gif_width, gif_height';

// ── Songs and GIFs in comments, before and after the backend change ─────────
//
// The app can reach a backend without migration 20261029000000 (songs) or 20261030000000
// (GIFs). A missing column fails the whole request, so the first such failure flips that
// migration's switch and the request is retried without its columns. A song still posts
// as its body's label line; a GIF is refused instead, since '🎞 GIF' alone says nothing.
let songColumnsMissing = false;
let gifColumnsMissing = false;

/** Postgres/PostgREST named a column this app selects or inserts and the table lacks. */
function missingColumnIn(
  error: { code?: string; message?: string } | null,
): 'song' | 'gif' | null {
  // 42703: undefined column (select). PGRST204: column not in the schema cache (insert).
  if (!error || (error.code !== '42703' && error.code !== 'PGRST204')) { return null; }
  const message = error.message ?? '';
  if (/song_(post_id|spotify_track_id|label)/.test(message)) { return 'song'; }
  if (/gif_(provider|id|width|height)/.test(message)) { return 'gif'; }
  return null;
}

/** Flip the switch for whichever columns the error named. False when it named none. */
function noteMissingColumns(error: { code?: string; message?: string } | null): boolean {
  const missing = missingColumnIn(error);
  if (missing === 'song') { songColumnsMissing = true; }
  if (missing === 'gif') { gifColumnsMissing = true; }
  return missing !== null;
}

function commentSelect(): string {
  return [
    COMMENT_SELECT_BASE,
    songColumnsMissing ? null : SONG_COLUMNS,
    gifColumnsMissing ? null : GIF_COLUMNS,
  ].filter(Boolean).join(', ');
}

/**
 * False once this backend has shown it has no GIF columns — the GIF button hides, rather
 * than offering a GIF that every send would refuse.
 */
export function gifCommentsSupported(): boolean {
  return !gifColumnsMissing;
}

/** Test-only: reset both switches between cases. */
export function __resetSongColumnsMissingForTest(): void {
  songColumnsMissing = false;
  gifColumnsMissing = false;
}

/**
 * The fixed text a shared GIF carries in `body`, for apps that predate GIFs in comments.
 * NEVER change it: comments already posted end with exactly this line, and the strip in
 * `commentDisplayText` matches it exactly.
 */
export const GIF_LABEL = '🎞 GIF';

/** Shown when a GIF comment cannot be posted because the backend has no GIF columns. */
export const GIFS_NOT_READY_MESSAGE = "GIFs aren't available yet. Try again later.";

/** The text a shared song carries in `body`: "🎵 Kesariya — Arijit Singh". */
export function songLabelFor(title: string, artist: string | null): string {
  const t = title.trim() || 'A song';
  const a = artist?.trim();
  return `🎵 ${a ? `${t} — ${a}` : t}`.slice(0, 200);
}

/**
 * What is stored as `body`: what was typed, then the attachment's label (a song's, or
 * `GIF_LABEL`) on its own last line — or just the label when nothing was typed. Apps that
 * predate attachments show it as it is; this one strips the label back off
 * (`commentDisplayText`).
 */
export function composeCommentBody(text: string, label: string | null): string {
  const typed = text.trim();
  if (!label) { return typed; }
  return typed ? `${typed}\n${label}` : label;
}

/**
 * The words to show above a comment's song card or GIF: the body without its label line.
 * A comment whose song has gone (the shared upload was deleted) shows its body whole, so
 * the label still says what was shared.
 */
export function commentDisplayText(
  node: Pick<CommentNode, 'body' | 'song' | 'songLabel'> & { gif?: CommentGif | null },
): string {
  const { body, song, songLabel, gif } = node;
  const label = gif ? GIF_LABEL : song ? songLabel : null;
  if (!label) { return body; }
  if (body === label) { return ''; }
  const suffix = `\n${label}`;
  return body.endsWith(suffix) ? body.slice(0, -suffix.length) : body;
}

function songOf(row: RawCommentRow): CommentSong | null {
  if (row.song_post_id) { return { kind: 'livil', postId: row.song_post_id }; }
  if (row.song_spotify_track_id) { return { kind: 'spotify', trackId: row.song_spotify_track_id }; }
  return null;
}

function gifOf(row: RawCommentRow): CommentGif | null {
  const { gif_provider: provider, gif_id: id, gif_width: width, gif_height: height } = row;
  if (provider !== 'giphy' || !id || !GIF_ID_RE.test(id) || !width || !height) { return null; }
  return { provider, id, width, height };
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
    gif: gifOf(row),
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
  // At most twice: once per migration that may be missing.
  for (let retry = 0; retry < 2 && noteMissingColumns(error); retry++) {
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
 * Post a comment. A `song` or a `gif`, when given, is shared with it (never both): `body`
 * is then what was typed (possibly nothing) and the song's label, or `GIF_LABEL`, is added
 * as its last line (composeCommentBody).
 */
export async function createComment(
  postId: string,
  body: string,
  parentCommentId: string | null = null,
  song: { song: CommentSong; label: string } | null = null,
  gif: CommentGif | null = null,
): Promise<CommentNode> {
  if (song && gif) {
    throw new Error('A comment can share a song or a GIF, not both.');
  }
  if (gif && gifColumnsMissing) {
    throw new Error(GIFS_NOT_READY_MESSAGE);
  }
  const trimmed = composeCommentBody(body, song?.label ?? (gif ? GIF_LABEL : null));
  if (!trimmed) {
    throw new Error('Comment cannot be empty.');
  }
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    throw noUserError(userError, 'You must be signed in to comment.');
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
  const gifFields = gif
    ? { gif_provider: gif.provider, gif_id: gif.id, gif_width: gif.width, gif_height: gif.height }
    : {};
  const insert = () => supabase
    .from('post_comments')
    .insert({
      ...base,
      ...(songColumnsMissing ? {} : songFields),
      ...(gifColumnsMissing ? {} : gifFields),
    })
    .select(commentSelect())
    .single();
  let { data, error } = await insert();
  for (let retry = 0; retry < 2 && noteMissingColumns(error); retry++) {
    // The backend has no GIF columns yet: '🎞 GIF' alone would say nothing, so refuse.
    if (gif && gifColumnsMissing) { throw new Error(GIFS_NOT_READY_MESSAGE); }
    // No song columns yet: post it as its body, label line and all.
    ({ data, error } = await insert());
  }

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create comment.');
  }
  // Fan out activity notifications (self-notification is filtered server-side).
  // Fire-and-forget — never block the comment. A reply tells the parent comment's author
  // first; when that is ALSO the post's author they have been told, so the post's own
  // "commented on your post" is skipped — one notification, not two.
  const created = data as unknown as RawCommentRow;
  void (async () => {
    const reply = parentCommentId ? await notifyCommentActivity(created.id, 'comment_reply') : null;
    if (reply?.recipientIsPostAuthor) { return; }
    await notifyPostActivity(postId, 'comment', {
      commentText: trimmed,
      commentId: created.id,
    });
  })();
  // People @-tagged in it (the server reads the stored comment and decides who).
  if (trimmed.includes('@')) { void notifyMentions({ commentId: created.id }); }
  return rowToNode(created, false);
}

/**
 * Delete a comment — your own, or any on a post that is yours (20261101000000). A delete
 * the database refuses does not error, it just matches no row; that is reported as a
 * failure, so the sheet puts the comment back instead of showing it gone until a reload.
 */
export async function deleteComment(commentId: string): Promise<void> {
  const { data, error } = await supabase
    .from('post_comments')
    .delete()
    .eq('id', commentId)
    .select('id');
  if (error) {
    throw new Error(error.message);
  }
  if (!data || data.length === 0) {
    throw new Error("Couldn't delete the comment.");
  }
}

/**
 * Toggle the viewer's like on a comment. Returns the resulting liked state.
 * Mirrors `toggleLike` in src/services/posts.ts.
 */
export async function toggleCommentLike(commentId: string): Promise<boolean> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    throw noUserError(userError, 'You must be signed in to like a comment.');
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
  // "Liked your comment" — fire-and-forget, never blocks the like.
  void notifyCommentActivity(commentId, 'comment_like');
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
    throw noUserError(userError, 'You must be signed in to report.');
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

/**
 * People to suggest after `@`: by username OR by name, like Instagram (owner, 2026-10-19:
 * typing a friend's name found nothing). Whatever matched, the tag inserted is always the
 * @username — usernames never change, so a stored tag always points at the same person.
 *
 * Ranked: username starts with it, then a name that starts with it, then a later word of the
 * name ("Riya Shah" for "sha"). Friends (`isFriend`, from MentionSuggestions) float up within
 * that order. The partial is [a-z0-9_] only (detectMentionTrigger), so
 * nothing in it can break the ilike pattern beyond the escaped % and _.
 */
export async function searchUsernamesForMention(
  query: string,
  limit: number = 6,
  isFriend?: (userId: string) => boolean,
): Promise<MentionProfile[]> {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return [];
  }
  const esc = trimmed.replace(/[%_\\]/g, '\\$&');
  const columns = 'id, username, display_name, avatar_url';
  const ask = (column: 'username' | 'display_name', pattern: string) =>
    supabase.from('profiles').select(columns).ilike(column, pattern).order(column, { ascending: true }).limit(limit);
  const [byUsername, byNameStart, byLaterWord] = await Promise.all([
    ask('username', `${esc}%`),
    ask('display_name', `${esc}%`),
    ask('display_name', `% ${esc}%`),
  ]);
  if (byUsername.error) {
    throw new Error(byUsername.error.message);
  }
  type Row = { id: string; username: string; display_name: string | null; avatar_url: string | null };
  const seen = new Set<string>();
  const ranked: Row[] = [];
  // A name lookup failing only loses those rows; the username ones still come back.
  for (const res of [byUsername, byNameStart, byLaterWord]) {
    for (const row of ((res.error ? [] : res.data) ?? []) as Row[]) {
      if (seen.has(row.id) || !row.username) { continue; }
      seen.add(row.id);
      ranked.push(row);
    }
  }
  const friendsFirst = isFriend
    ? [...ranked.filter(r => isFriend(r.id)), ...ranked.filter(r => !isFriend(r.id))]
    : ranked;
  return friendsFirst.slice(0, limit).map(p => ({
    id: p.id,
    username: p.username,
    displayName: p.display_name ?? null,
    avatarUrl: p.avatar_url ?? null,
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
