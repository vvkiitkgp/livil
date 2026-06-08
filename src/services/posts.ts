import { supabase } from '../../lib/supabase';
import type { NowPlayingInfo } from '../contexts/PlaybackContext';
import { notifyPostActivity } from './activity';
import { sendPush } from './pushDispatch';

export type AuthorRef = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export type TrackMedia = {
  id: string;
  title: string;
  mediaKind: 'audio' | 'video';
  audioUrl: string | null;
  videoUrl: string | null;
  coverArtUrl: string | null;
  /** Video tracks only — user-uploaded thumbnail shown in feed PostCard. NULL on
   *  audio tracks and on video tracks uploaded before the field existed. */
  thumbnailUrl: string | null;
};

export type FeedPost = {
  id: string;
  kind: 'upload' | 'repost';
  caption: string | null;
  createdAt: string;
  viewsCount: number;
  likesCount: number;
  repostsCount: number;
  commentsCount: number;
  author: AuthorRef;
  track: TrackMedia;
  /** Set when kind === 'repost' — points to the author of the underlying upload. */
  originalAuthor: AuthorRef | null;
  /** Set when kind === 'repost' — id of the original upload post (needed for navigation). */
  originalPostId: string | null;
  /** True if the currently signed-in viewer has liked this post. */
  viewerHasLiked: boolean;
  /** Optional clip window selected during repost (seconds). */
  clipStartSec: number | null;
  clipEndSec: number | null;
};

export type ProfileStats = {
  posts: number;
  uploads: number;
};

type RawPostRow = {
  id: string;
  kind: 'upload' | 'repost';
  caption: string | null;
  created_at: string;
  views_count: number;
  likes_count: number;
  reposts_count: number;
  comments_count: number;
  author_id: string;
  original_post_id: string | null;
  clip_start_sec: number | null;
  clip_end_sec: number | null;
  track: {
    id: string;
    title: string;
    media_kind: 'audio' | 'video';
    audio_url: string | null;
    video_url: string | null;
    cover_art_url: string | null;
    thumbnail_url: string | null;
  } | null;
  author: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
};

const POST_SELECT = `
  id,
  kind,
  caption,
  created_at,
  views_count,
  likes_count,
  reposts_count,
  comments_count,
  author_id,
  original_post_id,
  clip_start_sec,
  clip_end_sec,
  track:tracks (
    id,
    title,
    media_kind,
    audio_url,
    video_url,
    cover_art_url,
    thumbnail_url
  ),
  author:profiles!posts_author_id_fkey (
    id,
    username,
    display_name,
    avatar_url
  )
` as const;

function toAuthor(row: RawPostRow['author']): AuthorRef {
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

function toTrack(row: RawPostRow['track']): TrackMedia {
  if (!row) {
    return {
      id: '',
      title: 'Untitled',
      mediaKind: 'audio',
      audioUrl: null,
      videoUrl: null,
      coverArtUrl: null,
      thumbnailUrl: null,
    };
  }
  return {
    id: row.id,
    title: row.title,
    mediaKind: row.media_kind,
    audioUrl: row.audio_url,
    videoUrl: row.video_url,
    coverArtUrl: row.cover_art_url,
    thumbnailUrl: row.thumbnail_url,
  };
}

type HydratePostsOptions = {
  /** When provided, skips an extra `post_likes` round-trip for these ids. */
  viewerLikedByPostId?: Map<string, boolean>;
};

/**
 * Shared enrichment path for feed-shaped post rows (original author resolve +
 * viewer liked state).
 */
async function hydrateRawPostRows(
  rows: RawPostRow[],
  options?: HydratePostsOptions,
): Promise<FeedPost[]> {
  if (rows.length === 0) {
    return [];
  }

  const originalIds = Array.from(
    new Set(rows.filter(r => r.kind === 'repost' && r.original_post_id).map(r => r.original_post_id!)),
  );

  let originalAuthorByPostId = new Map<string, AuthorRef>();
  if (originalIds.length > 0) {
    const { data: origs, error: origError } = await supabase
      .from('posts')
      .select(
        `
          id,
          author:profiles!posts_author_id_fkey ( id, username, display_name, avatar_url )
        `,
      )
      .in('id', originalIds);
    if (origError) {
      throw new Error(origError.message);
    }
    originalAuthorByPostId = new Map(
      (origs ?? []).map((o: { id: string; author: RawPostRow['author'] }) => [o.id, toAuthor(o.author)]),
    );
  }

  let likedSet = new Set<string>();
  const forced = options?.viewerLikedByPostId;
  if (!forced) {
    const { data: viewerData } = await supabase.auth.getUser();
    const viewerId = viewerData?.user?.id ?? null;
    if (viewerId) {
      const { data: likes } = await supabase
        .from('post_likes')
        .select('post_id')
        .eq('user_id', viewerId)
        .in('post_id', rows.map(r => r.id));
      likedSet = new Set((likes ?? []).map(l => l.post_id));
    }
  }

  return rows.map<FeedPost>(r => ({
    id: r.id,
    kind: r.kind,
    caption: r.caption,
    createdAt: r.created_at,
    viewsCount: r.views_count,
    likesCount: r.likes_count,
    repostsCount: r.reposts_count,
    commentsCount: r.comments_count,
    author: toAuthor(r.author),
    track: toTrack(r.track),
    originalAuthor: r.original_post_id ? originalAuthorByPostId.get(r.original_post_id) ?? null : null,
    originalPostId: r.original_post_id,
    viewerHasLiked: forced ? Boolean(forced.get(r.id)) : likedSet.has(r.id),
    clipStartSec: r.clip_start_sec ?? null,
    clipEndSec: r.clip_end_sec ?? null,
  }));
}

async function hydratePostsByIds(
  orderedIds: string[],
  viewerLikedByPostId: Map<string, boolean>,
): Promise<FeedPost[]> {
  if (orderedIds.length === 0) {
    return [];
  }
  const { data, error } = await supabase.from('posts').select(POST_SELECT).in('id', orderedIds);
  if (error) {
    throw new Error(error.message);
  }
  const rows = (data ?? []) as unknown as RawPostRow[];
  const byId = new Map(rows.map(r => [r.id, r]));
  const ordered = orderedIds.map(id => byId.get(id)).filter(Boolean) as RawPostRow[];
  return hydrateRawPostRows(ordered, { viewerLikedByPostId });
}

export type HomeFeedCursor = {
  bucket: number;
  sortKey: number;
  id: string;
};

type RpcHomeFeedRow = {
  post_id: string;
  feed_bucket: number;
  sort_key: number;
  viewer_has_liked: boolean;
};

/**
 * Home ranking is computed in Postgres (`fetch_home_feed`): mutual friends →
 * starred friends → global trending (time-decayed engagement). Pagination is
 * keyset-based so feeds stay cheap at large scale.
 */
export async function fetchHomeFeedPage(options: {
  limit?: number;
  cursor?: HomeFeedCursor | null;
}): Promise<{ posts: FeedPost[]; nextCursor: HomeFeedCursor | null }> {
  const limit = options.limit ?? 12;
  const c = options.cursor ?? null;

  const { data, error } = await supabase.rpc('fetch_home_feed', {
    p_limit: limit,
    p_cursor_bucket: c?.bucket ?? undefined,
    p_cursor_sort_key: c?.sortKey ?? undefined,
    p_cursor_id: c?.id ?? undefined,
  });
  if (error) {
    throw new Error(error.message);
  }

  const rpcRows = (data ?? []) as RpcHomeFeedRow[];
  if (rpcRows.length === 0) {
    return { posts: [], nextCursor: null };
  }

  const ids = rpcRows.map(r => r.post_id);
  const liked = new Map(rpcRows.map(r => [r.post_id, r.viewer_has_liked]));
  const posts = await hydratePostsByIds(ids, liked);

  const last = rpcRows[rpcRows.length - 1]!;
  const nextCursor: HomeFeedCursor | null =
    rpcRows.length >= limit
      ? { bucket: last.feed_bucket, sortKey: last.sort_key, id: last.post_id }
      : null;

  return { posts, nextCursor };
}

export type ListPostsOptions = {
  kind?: 'upload';
  before?: string; // ISO date for pagination cursor
  limit?: number;
};

/**
 * Fetch posts authored by a user, newest first. When `kind: 'upload'` is set we
 * only return their original uploads (the Creator tab). Otherwise we return all
 * posts (uploads + reposts). For reposts we also resolve the original
 * uploader's profile so the UI can show a "Creator" tag.
 */
export async function listPostsForUser(
  userId: string,
  options: ListPostsOptions = {},
): Promise<FeedPost[]> {
  const limit = options.limit ?? 10;

  let query = supabase
    .from('posts')
    .select(POST_SELECT)
    .eq('author_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (options.kind === 'upload') {
    query = query.eq('kind', 'upload');
  }
  if (options.before) {
    query = query.lt('created_at', options.before);
  }

  const { data, error } = await query;
  if (error) {throw new Error(error.message);}

  const rows = (data ?? []) as unknown as RawPostRow[];
  return hydrateRawPostRows(rows);
}

// Same shape as POST_SELECT but forces an inner join on tracks so we can apply
// `.or` filters against track columns (title/description) without losing the row.
const SEARCH_POST_SELECT = `
  id,
  kind,
  caption,
  created_at,
  views_count,
  likes_count,
  reposts_count,
  comments_count,
  author_id,
  original_post_id,
  clip_start_sec,
  clip_end_sec,
  track:tracks!inner (
    id,
    title,
    media_kind,
    audio_url,
    video_url,
    cover_art_url
  ),
  author:profiles!posts_author_id_fkey (
    id,
    username,
    display_name,
    avatar_url
  )
` as const;

/**
 * Search upload posts by track title or description (case-insensitive). Reposts
 * are intentionally excluded so each track appears once. Results are newest
 * first and capped at `limit` (default 20).
 */
export async function searchPosts(
  query: string,
  options: { limit?: number } = {},
): Promise<FeedPost[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const limit = options.limit ?? 20;
  const pattern = `%${trimmed.replace(/[%_]/g, '\\$&')}%`;

  const { data, error } = await supabase
    .from('posts')
    .select(SEARCH_POST_SELECT)
    .eq('kind', 'upload')
    .or(`title.ilike.${pattern},description.ilike.${pattern}`, { foreignTable: 'tracks' })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as unknown as RawPostRow[];
  return hydrateRawPostRows(rows);
}

export async function getProfileStats(userId: string): Promise<ProfileStats> {
  // Two head:true count queries — cheap and accurate.
  const [{ count: total, error: totalError }, { count: uploads, error: uploadsError }] =
    await Promise.all([
      supabase
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('author_id', userId),
      supabase
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('author_id', userId)
        .eq('kind', 'upload'),
    ]);

  if (totalError) {throw new Error(totalError.message);}
  if (uploadsError) {throw new Error(uploadsError.message);}

  return { posts: total ?? 0, uploads: uploads ?? 0 };
}

/**
 * Create a repost of an existing upload post. The reposter supplies their own
 * caption ("how I feel about this song") and an optional clip window.
 * The new post inherits `track_id` from the original so feed cards can render
 * the same media.
 */
export async function createRepost(
  originalPostId: string,
  caption: string,
  clipStartSec?: number,
  clipEndSec?: number,
): Promise<{ postId: string }> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    throw new Error('You must be signed in to repost.');
  }
  const me = userData.user.id;

  const { data: original, error: origError } = await supabase
    .from('posts')
    .select('id, kind, track_id')
    .eq('id', originalPostId)
    .maybeSingle();

  if (origError) {throw new Error(origError.message);}
  if (!original) {throw new Error('Original post not found.');}
  if (original.kind !== 'upload') {
    throw new Error('You can only repost an upload, not another repost.');
  }

  const { data: created, error: insertError } = await supabase
    .from('posts')
    .insert({
      author_id: me,
      kind: 'repost',
      track_id: original.track_id,
      original_post_id: originalPostId,
      caption: caption.trim() ? caption.trim() : null,
      clip_start_sec: clipStartSec ?? null,
      clip_end_sec: clipEndSec ?? null,
    })
    .select('id')
    .single();

  if (insertError || !created) {
    throw new Error(insertError?.message ?? 'Failed to create repost.');
  }

  // Notify the original post's author (self-repost is filtered server-side).
  void notifyPostActivity(originalPostId, 'repost');

  return { postId: created.id };
}

export type PostMetrics = {
  likesCount: number;
  commentsCount: number;
  repostsCount: number;
  viewerHasLiked: boolean;
};

/**
 * Lightweight counts-only fetch for a post — used by FullScreenPlayer when the
 * currently-playing item is a repost: engagement in the player surface targets
 * the *original* post, so we re-read its counters without rehydrating the full
 * FeedPost shape.
 */
export async function fetchPostMetrics(postId: string): Promise<PostMetrics> {
  const { data, error } = await supabase
    .from('posts')
    .select('likes_count, comments_count, reposts_count')
    .eq('id', postId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  const likesCount = (data?.likes_count as number | undefined) ?? 0;
  const commentsCount = (data?.comments_count as number | undefined) ?? 0;
  const repostsCount = (data?.reposts_count as number | undefined) ?? 0;

  let viewerHasLiked = false;
  const { data: userData } = await supabase.auth.getUser();
  const viewerId = userData?.user?.id ?? null;
  if (viewerId) {
    const { data: like } = await supabase
      .from('post_likes')
      .select('post_id')
      .eq('post_id', postId)
      .eq('user_id', viewerId)
      .maybeSingle();
    viewerHasLiked = Boolean(like);
  }
  return { likesCount, commentsCount, repostsCount, viewerHasLiked };
}

/**
 * Fetch a single post by id — used by RepostScreen to load the original post
 * (cover art, track details, author) before the user writes their repost.
 */
export async function fetchPostById(postId: string): Promise<FeedPost | null> {
  const { data, error } = await supabase
    .from('posts')
    .select(POST_SELECT)
    .eq('id', postId)
    .maybeSingle();
  if (error) {throw new Error(error.message);}
  if (!data) {return null;}
  const rows = await hydrateRawPostRows([data as unknown as RawPostRow]);
  return rows[0] ?? null;
}

/**
 * Return the total cumulative plays (sum of views_count) across every post that
 * uses the given track — displayed as a badge on the cover art in RepostScreen.
 */
export async function fetchTrackPlaysTotal(trackId: string): Promise<number> {
  const { data, error } = await supabase
    .from('posts')
    .select('views_count')
    .eq('track_id', trackId);
  if (error) {throw new Error(error.message);}
  return (data ?? []).reduce((sum, r) => sum + (r.views_count ?? 0), 0);
}

/**
 * Toggle the viewer's like on a post. Returns the resulting liked state.
 * Idempotent: clicking twice rapidly will end where it started.
 */
export async function toggleLike(postId: string): Promise<boolean> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    throw new Error('You must be signed in to like a post.');
  }
  const me = userData.user.id;

  const { data: existing, error: selError } = await supabase
    .from('post_likes')
    .select('post_id')
    .eq('post_id', postId)
    .eq('user_id', me)
    .maybeSingle();

  if (selError) {throw new Error(selError.message);}

  if (existing) {
    const { error: delError } = await supabase
      .from('post_likes')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', me);
    if (delError) {throw new Error(delError.message);}
    return false;
  }

  const { error: insError } = await supabase
    .from('post_likes')
    .insert({ post_id: postId, user_id: me });
  if (insError) {throw new Error(insError.message);}
  // Notify the post author on a NEW like only — aggregated per post
  // server-side. Self-like is filtered in the RPC.
  void notifyPostActivity(postId, 'like');
  return true;
}

/**
 * Record a play for a post. Each call inserts a new row in `post_views`; the
 * AFTER-INSERT trigger increments `posts.views_count`. Multiple plays per user
 * per post are allowed (loops, replays, etc).
 *
 * The "when to call this" decision lives in `src/utils/playTracker.ts` —
 * service-layer code just writes the row, no quota or dedup logic.
 */
export async function recordPlay(postId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;
  if (!me) {return;}
  // The RPC does the real post_views insert (so trg_post_views_count still
  // fires) and, if this play crosses a milestone on an original post, writes
  // the activity row and returns the author + threshold so we can push.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('activity_record_play', { p_post_id: postId });
  if (error) {
    throw new Error(error.message);
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { milestone_recipient: string | null; milestone_threshold: number | null }
    | undefined;
  if (row?.milestone_recipient && row.milestone_threshold) {
    const t = row.milestone_threshold;
    const label = t >= 1000 ? `${Number.isInteger(t / 1000) ? t / 1000 : (t / 1000).toFixed(1)}K` : String(t);
    void sendPush({
      recipientUserId: row.milestone_recipient,
      kind: 'activity_milestone',
      title: 'Livil',
      body: `Your track hit ${label} plays 🎉`,
      data: { route: 'ActivityCenter' },
    });
  }
}

export type PostReportReason = 'spam' | 'harassment' | 'hate' | 'misinformation' | 'other';

/**
 * Report a post. Mirrors `reportComment` in src/services/comments.ts —
 * inserts into `post_reports`; RLS guarantees `reporter_id = auth.uid()`.
 */
export async function reportPost(
  postId: string,
  reason: PostReportReason,
  details?: string,
): Promise<void> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    throw new Error('You must be signed in to report.');
  }
  const me = userData.user.id;
  const trimmed = details?.trim();
  const { error } = await supabase.from('post_reports').insert({
    post_id: postId,
    reporter_id: me,
    reason,
    details: trimmed && trimmed.length > 0 ? trimmed : null,
  });
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Delete a post. RLS enforces ownership (only the author can delete).
 *
 * FK cascades (all ON DELETE CASCADE):
 *   - post_comments (and their likes/reports via comment cascade)
 *   - post_likes
 *   - post_views
 *   - playlist_posts (removed from all playlists that contained this post)
 *   - posts.original_post_id → reposts of this post are also deleted
 *   - stories.original_post_id → stories sharing this post are also deleted
 *   - post_reports (this table)
 *
 * The repost cascade is intentionally aggressive: deleting an upload removes
 * every repost of it across the platform. If we want to keep reposts as
 * orphans (still playable since `track_id` still points at the tracks table),
 * switch posts_original_post_id_fkey to ON DELETE SET NULL in a follow-up.
 */
export async function deletePost(postId: string): Promise<void> {
  const { error } = await supabase
    .from('posts')
    .delete()
    .eq('id', postId);
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Convert a FeedPost to NowPlayingInfo for the playback engine.
 * For reposts, the author shown is the original uploader.
 */
export function feedPostToNowPlaying(post: FeedPost): NowPlayingInfo {
  const displayAuthor =
    post.kind === 'repost' && post.originalAuthor
      ? post.originalAuthor
      : post.author;
  return {
    postId: post.id,
    trackId: post.track.id,
    title: post.track.title,
    artistName: displayAuthor.displayName ?? displayAuthor.username,
    authorId: displayAuthor.id,
    authorUsername: displayAuthor.username,
    authorAvatarUrl: displayAuthor.avatarUrl,
    coverArtUrl: post.track.coverArtUrl,
    thumbnailUrl: post.track.thumbnailUrl,
    mediaKind: post.track.mediaKind,
    audioUrl: post.track.audioUrl ?? undefined,
    videoUrl: post.track.videoUrl ?? undefined,
    likesCount: post.likesCount,
    commentsCount: post.commentsCount,
    repostsCount: post.repostsCount,
    viewsCount: post.viewsCount,
    viewerHasLiked: post.viewerHasLiked,
    clipStartSec: post.clipStartSec,
    clipEndSec: post.clipEndSec,
    kind: post.kind,
    originalPostId: post.originalPostId,
    knownDurationSec: 0,
  };
}
