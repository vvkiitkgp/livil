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
  /**
   * How many DISTINCT people opened this track from search.
   *
   * People, not opens: one listener finding the same song five times is one person who
   * wanted it, and showing the bigger number would flatter the artist with their own
   * repeat visits. Filled in by `attachSearchOpens` — zero until it resolves, which is the
   * honest value for a track nobody has found yet.
   */
  searchOpens: number;
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
    searchOpens: 0,
  };
}

/**
 * Fill in how many people found each track through search.
 *
 * A SEPARATE CALL, not a join. `search_result_taps` has no SELECT policy — no client reads
 * its rows, by design — so the only way to a number is the aggregate function, which takes
 * ids and returns counts. That also means this cannot leak anything: an artist asks about
 * their own track ids and gets back totals, never who or when.
 *
 * Fail-safe. A catalogue that will not render because an analytics number was unavailable is
 * a worse trade than a column of zeroes, so any error resolves to the posts unchanged.
 */
export async function attachSearchOpens(posts: CreatorPost[]): Promise<CreatorPost[]> {
  const trackIds = [...new Set(posts.map(p => p.trackId))];
  if (trackIds.length === 0) return posts;

  try {
    const { data, error } = await supabase.rpc('search_result_popularity', {
      p_kind: 'track',
      p_ids: trackIds,
    });
    if (error || !data) return posts;

    const byTrack = new Map<string, number>();
    for (const row of data) byTrack.set(row.entity_id, Number(row.people) || 0);
    return posts.map(p => ({ ...p, searchOpens: byTrack.get(p.trackId) ?? 0 }));
  } catch {
    return posts;
  }
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
  tags: string[];
  lyrics: string | null;
  lyricsFormat: 'lrc' | 'plain' | null;
  /** The playable file — audio for audio posts, the video for video posts. */
  mediaUrl: string | null;
};

type DetailRow = PostRow & {
  caption: string | null;
  author_id: string;
  tracks:
    | (NonNullable<PostRow['tracks']> & {
        description: string | null;
        tags: string[] | null;
        lyrics: string | null;
        lyrics_format: string | null;
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
       tracks!inner ( id, title, description, tags, cover_art_url, thumbnail_url, media_kind,
                      duration_seconds, file_size_bytes, lyrics, lyrics_format,
                      audio_url, video_url )`,
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
    // NULL and "no tags" are the same thing to every reader; the column's one-representation
    // rule lives at the write side, so this flattens rather than preserving the distinction.
    tags: track?.tags ?? [],
    caption: row.caption,
    lyrics: track?.lyrics ?? null,
    lyricsFormat:
      track?.lyrics_format === 'lrc' || track?.lyrics_format === 'plain'
        ? track.lyrics_format
        : null,
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
