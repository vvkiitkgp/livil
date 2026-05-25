import { supabase } from '../../lib/supabase';

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
  track: {
    id: string;
    title: string;
    media_kind: 'audio' | 'video';
    audio_url: string | null;
    video_url: string | null;
    cover_art_url: string | null;
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
  track:tracks (
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
    };
  }
  return {
    id: row.id,
    title: row.title,
    mediaKind: row.media_kind,
    audioUrl: row.audio_url,
    videoUrl: row.video_url,
    coverArtUrl: row.cover_art_url,
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
  const byId = new Map((data ?? []).map(r => [(r as RawPostRow).id, r as RawPostRow]));
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
 * caption ("how I feel about this song"). The new post inherits `track_id` from
 * the original so feed cards can render the same media.
 */
export async function createRepost(
  originalPostId: string,
  caption: string,
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
    })
    .select('id')
    .single();

  if (insertError || !created) {
    throw new Error(insertError?.message ?? 'Failed to create repost.');
  }

  return { postId: created.id };
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
  return true;
}

/**
 * Record a view from the current viewer for a post. De-duplicated at the DB
 * level via the (post_id, user_id) primary key — re-inserting is a no-op for
 * counting purposes (we swallow the conflict).
 */
export async function recordView(postId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;
  if (!me) {return;}

  // `onConflict` would require a unique constraint name; we just call insert
  // and swallow the unique_violation (23505) — the row is already there.
  const { error } = await supabase
    .from('post_views')
    .insert({ post_id: postId, user_id: me });
  if (error && error.code !== '23505') {
    throw new Error(error.message);
  }
}
