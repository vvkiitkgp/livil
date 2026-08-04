/**
 * Reads for the creator dashboard.
 *
 * Deliberately local to `web/` for now. The right home is `shared/`, alongside `publishTrack`
 * — principal-client's recommendation is to move the READ half of `src/services/posts.ts`
 * there so both clients agree on what a post is. That is a real extraction touching the
 * mobile app, and it should not ride on a dashboard ticket. Until then these queries mirror
 * `POST_SELECT` in that file; if they drift, the extraction is overdue.
 */
import { supabase } from '../supabase';

export type CreatorProfile = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  followers: number;
  following: number;
};

export type CreatorPost = {
  postId: string;
  trackId: string;
  title: string;
  coverUrl: string | null;
  mediaKind: 'audio' | 'video';
  durationSeconds: number | null;
  publishedAt: string;
  /** Primary media object size. Null for tracks published before the column existed. */
  sizeBytes: number | null;
  plays: number;
  likes: number;
  reposts: number;
  comments: number;
};

export type CreatorTotals = {
  plays: number;
  tracks: number;
  likes: number;
  reposts: number;
};

export async function fetchCreatorProfile(userId: string): Promise<CreatorProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, bio, followers_count, following_count')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id,
    username: data.username,
    displayName: data.display_name,
    avatarUrl: data.avatar_url,
    bio: data.bio,
    followers: data.followers_count ?? 0,
    following: data.following_count ?? 0,
  };
}

type PostRow = {
  id: string;
  track_id: string;
  created_at: string;
  views_count: number | null;
  likes_count: number | null;
  reposts_count: number | null;
  comments_count: number | null;
  tracks: {
    id: string;
    title: string;
    cover_art_url: string | null;
    thumbnail_url: string | null;
    media_kind: string;
    duration_seconds: number | null;
    file_size_bytes: number | null;
  } | null;
};

const POST_SELECT = `
  id, track_id, created_at, views_count, likes_count, reposts_count, comments_count,
  tracks!inner ( id, title, cover_art_url, thumbnail_url, media_kind, duration_seconds,
                 file_size_bytes )
`;

function toCreatorPost(row: PostRow): CreatorPost {
  const track = row.tracks;
  return {
    postId: row.id,
    trackId: row.track_id,
    title: track?.title ?? 'Untitled',
    // Video posts carry their feed image in thumbnail_url, audio in cover_art_url.
    coverUrl: track?.cover_art_url ?? track?.thumbnail_url ?? null,
    mediaKind: track?.media_kind === 'video' ? 'video' : 'audio',
    durationSeconds: track?.duration_seconds ?? null,
    sizeBytes: track?.file_size_bytes ?? null,
    publishedAt: row.created_at,
    plays: row.views_count ?? 0,
    likes: row.likes_count ?? 0,
    reposts: row.reposts_count ?? 0,
    comments: row.comments_count ?? 0,
  };
}

/**
 * The artist's own uploads, newest first.
 *
 * Scoped to `kind = 'upload'` so reposts of other people's tracks do not appear in a
 * catalogue of "music I made". Bounded — an unbounded fetch is a defect waiting for the
 * artist who has 500 tracks.
 */
export async function fetchCreatorPosts(
  userId: string,
  limit = 50,
): Promise<CreatorPost[]> {
  const { data, error } = await supabase
    .from('posts')
    .select(POST_SELECT)
    .eq('author_id', userId)
    .eq('kind', 'upload')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return (data as unknown as PostRow[]).map(toCreatorPost);
}

/**
 * Headline numbers.
 *
 * Summed client-side from the artist's own rows, which is correct at this scale and honest
 * about it: with tens of uploads this is one small query. It becomes an RPC when a catalogue
 * is large enough that fetching every row to add four columns is wasteful — principal-data's
 * `creator_post_stats`. The shape of this function is designed so that swap is invisible to
 * callers.
 */
export async function fetchCreatorTotals(userId: string): Promise<CreatorTotals> {
  const { data, error } = await supabase
    .from('posts')
    .select('views_count, likes_count, reposts_count')
    .eq('author_id', userId)
    .eq('kind', 'upload');

  if (error || !data) return { plays: 0, tracks: 0, likes: 0, reposts: 0 };

  return data.reduce<CreatorTotals>(
    (acc, row) => ({
      plays: acc.plays + (row.views_count ?? 0),
      likes: acc.likes + (row.likes_count ?? 0),
      reposts: acc.reposts + (row.reposts_count ?? 0),
      tracks: acc.tracks + 1,
    }),
    { plays: 0, tracks: 0, likes: 0, reposts: 0 },
  );
}

/** One post, with everything the detail screen needs. */
export type PostDetail = CreatorPost & {
  description: string | null;
  caption: string | null;
  /** The playable file — audio for audio posts, the video for video posts. */
  mediaUrl: string | null;
};

type DetailRow = PostRow & {
  caption: string | null;
  author_id: string;
  tracks:
    | (NonNullable<PostRow['tracks']> & {
        description: string | null;
        audio_url: string | null;
        video_url: string | null;
      })
    | null;
};

export async function fetchPostDetail(
  postId: string,
  authorId: string,
): Promise<PostDetail | null> {
  const { data, error } = await supabase
    .from('posts')
    .select(
      `id, track_id, author_id, caption, created_at, views_count, likes_count,
       reposts_count, comments_count,
       tracks!inner ( id, title, description, cover_art_url, thumbnail_url, media_kind,
                      duration_seconds, file_size_bytes, audio_url, video_url )`,
    )
    .eq('id', postId)
    // Author-scoped. The writes fail at RLS anyway, but without this the screen renders an
    // edit form and an Unpublish button for a post you do not own — offering destructive
    // actions that can only error. Found by security review.
    .eq('author_id', authorId)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as unknown as DetailRow;
  const base = toCreatorPost(row);
  const track = row.tracks;

  return {
    ...base,
    description: track?.description ?? null,
    caption: row.caption,
    // A video post's picture and its audio are the same file; audio posts play audio_url.
    mediaUrl: base.mediaKind === 'video' ? track?.video_url ?? null : track?.audio_url ?? null,
  };
}

/**
 * Remove a post.
 *
 * Deletes the POST, not the track. The distinction matters: the track row and its storage
 * objects survive, so this is "unpublish" rather than "destroy my master". Deleting the track
 * as well would need the storage cleanup that account deletion already owns, and
 * reimplementing that here is exactly the duplication to avoid.
 */
export async function unpublishPost(postId: string): Promise<void> {
  const { error } = await supabase.from('posts').delete().eq('id', postId);
  if (error) throw new Error(error.message);
}

/**
 * A profile's links.
 *
 * Separate from `fetchCreatorProfile` because the shell loads that on every page and `links`
 * is only ever needed by the editor — no reason to carry an array through every render of
 * every screen for one form.
 */
export async function fetchProfileLinks(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('links')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return [];
  return (data.links as string[] | null) ?? [];
}
