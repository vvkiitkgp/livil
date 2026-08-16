import { supabase } from '../../lib/supabase';
import { normalizeTag } from '../../shared/constants/tags';
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
  /** Track length in whole seconds (from DB). NULL until captured/backfilled.
   *  Lets the feed seek bar place clip markers and park the progress handle at
   *  clip-start *before* playback loads the real duration. */
  durationSeconds: number | null;
};

/**
 * Just enough of a credit to draw a face on the card.
 *
 * Deliberately NOT the full `TrackCollaboratorInfo`: the card shows an avatar row that
 * opens the player's Info tab, and the names, roles and role glyphs live there. Carrying
 * roles in every feed row would pay for data the card never renders.
 */
export type CreditFace = {
  userId: string | null;
  avatarUrl: string | null;
  name: string | null;
  pending: boolean;
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
  /** Credited artists, for the avatar row on the card. Empty for an uncredited track. */
  credits: CreditFace[];
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
    duration_seconds: number | null;
    uploader_id?: string | null;
    collaborators?: Array<{
      user_id: string | null;
      status: string | null;
      profile: {
        avatar_url: string | null;
        display_name: string | null;
        username: string | null;
      } | null;
    }> | null;
  } | null;
  author: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
};

// NOTE: do NOT add `waveform_peaks` to the tracks sub-select here (or in
// SEARCH_POST_SELECT). It's a large per-row jsonb (~100 KB for a long track) and
// these feed queries pull dozens of rows — including it would balloon every feed
// payload into megabytes. The visualizer fetches it lazily for the ACTIVE track
// only, via getOrAnalyzeWaveform (see src/services/tracks.ts).
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
    thumbnail_url,
    duration_seconds,
    uploader_id,
    collaborators:track_collaborators (
      user_id,
      status,
      profile:profiles ( avatar_url, display_name, username )
    )
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

/**
 * Credits reduced to faces.
 *
 * Declined rows are dropped — the named artist said this is not them. Typed-in names are
 * dropped too, but for a different reason: they have no avatar and no profile to open, so
 * a face row would be initials that go nowhere. They still appear in full on the Info tab.
 *
 * The UPLOADER is dropped as well: their avatar is already at the top of the card, and
 * "with <the person whose post this is>" is not a sentence. Matched on the TRACK's
 * uploader rather than the post's author, so a repost still hides the original uploader
 * (who is credited) and not the reposter (who is not).
 */
function toCreditFaces(row: RawPostRow['track']): CreditFace[] {
  return (row?.collaborators ?? [])
    .filter(c => c.user_id && c.status !== 'declined' && c.user_id !== row?.uploader_id)
    .map(c => ({
      userId: c.user_id,
      avatarUrl: c.profile?.avatar_url ?? null,
      name: c.profile?.display_name ?? c.profile?.username ?? null,
      pending: c.status !== 'accepted',
    }));
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
      durationSeconds: null,
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
    durationSeconds: row.duration_seconds,
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
    credits: toCreditFaces(r.track),
  }));
}

/**
 * Shape of the `post` jsonb returned by the consolidated `fetch_home_feed` RPC:
 * exactly RawPostRow plus the resolved original author and the viewer's liked
 * flag. The RPC hydrates track + author + original author server-side so the
 * feed needs a SINGLE round-trip (no separate posts / originals / post_likes
 * fetches).
 */
type RpcFeedPostJson = RawPostRow & {
  original_author: RawPostRow['author'];
  viewer_has_liked: boolean | null;
};

function mapRpcFeedPost(raw: RpcFeedPostJson): FeedPost {
  return {
    id: raw.id,
    kind: raw.kind,
    caption: raw.caption,
    createdAt: raw.created_at,
    viewsCount: raw.views_count,
    likesCount: raw.likes_count,
    repostsCount: raw.reposts_count,
    commentsCount: raw.comments_count,
    author: toAuthor(raw.author),
    track: toTrack(raw.track),
    originalAuthor:
      raw.original_post_id && raw.original_author ? toAuthor(raw.original_author) : null,
    originalPostId: raw.original_post_id,
    viewerHasLiked: Boolean(raw.viewer_has_liked),
    clipStartSec: raw.clip_start_sec ?? null,
    clipEndSec: raw.clip_end_sec ?? null,
    credits: toCreditFaces(raw.track),
  };
}

export type HomeFeedCursor = {
  bucket: number;
  sortKey: number;
  id: string;
};

/**
 * One pass through the feed (PROP-0010 phase 2).
 *
 * `seed` keys a deterministic per-post nudge, and `startedAt` freezes the instant the
 * decay is measured from. Sending both with every page is what lets the ranking be STABLE
 * while the viewer scrolls and DIFFERENT the next time they pull down — the two things a
 * plain `ORDER BY random()` cannot be at once.
 *
 * Freezing the origin is also a pagination fix on its own: with a live `now()` the scores
 * move between page 1 and page 3, so the cursor is compared against numbers it was never
 * issued from and rows can be skipped or repeated.
 */
export type HomeFeedSession = {
  seed: number;
  /** ISO 8601. Clamped server-side to the last hour — it is untrusted input there. */
  startedAt: string;
};

/**
 * Mint a session. Call on cold open and on every pull-to-refresh; keep it for every page
 * in between.
 *
 * Seed 0 is reserved by the RPC to mean "no jitter" (the pre-session ordering), so it is
 * excluded here — a session that rolled 0 would silently be an unseeded one.
 */
export function newHomeFeedSession(): HomeFeedSession {
  return {
    seed: 1 + Math.floor(Math.random() * 2147483646),
    startedAt: new Date().toISOString(),
  };
}

type RpcHomeFeedRow = {
  feed_bucket: number;
  sort_key: number;
  post_id: string;
  /** Fully-hydrated post (track + author + original author + liked flag). */
  post: RpcFeedPostJson;
};

/**
 * Home ranking is computed in Postgres (`fetch_home_feed`): mutual friends →
 * starred friends → global trending (time-decayed engagement) → already-seen.
 * Pagination is keyset-based so feeds stay cheap at large scale.
 *
 * Pass the SAME `session` for every page of one pass through the feed, and a fresh one on
 * refresh — see `HomeFeedSession`. Omitting it falls back to the unseeded ordering, which
 * is stable but identical on every refresh.
 */
export async function fetchHomeFeedPage(options: {
  limit?: number;
  cursor?: HomeFeedCursor | null;
  session?: HomeFeedSession | null;
}): Promise<{ posts: FeedPost[]; nextCursor: HomeFeedCursor | null }> {
  const limit = options.limit ?? 12;
  const c = options.cursor ?? null;
  const session = options.session ?? null;

  // Cast via unknown: the generated Supabase types still describe the pre-session RPC
  // signature. Regenerate types after the migration lands.
  const rpc = supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;

  const { data, error } = await rpc('fetch_home_feed', {
    p_limit: limit,
    p_cursor_bucket: c?.bucket ?? undefined,
    p_cursor_sort_key: c?.sortKey ?? undefined,
    p_cursor_id: c?.id ?? undefined,
    p_seed: session?.seed ?? undefined,
    p_session_started_at: session?.startedAt ?? undefined,
  });
  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as unknown as RpcHomeFeedRow[];

  if (rows.length === 0) {
    return { posts: [], nextCursor: null };
  }

  const posts = rows.map(r => mapRpcFeedPost(r.post));

  const last = rows[rows.length - 1]!;
  const nextCursor: HomeFeedCursor | null =
    rows.length >= limit
      ? { bucket: last.feed_bucket, sortKey: last.sort_key, id: last.post_id }
      : null;

  return { posts, nextCursor };
}

export type ListPostsOptions = {
  kind?: 'upload' | 'repost';
  before?: string; // ISO date for pagination cursor
  limit?: number;
};

/**
 * Track ids this user is a CONFIRMED collaborator on.
 *
 * Accepted only, deliberately. A pending credit is somebody else's claim about you that
 * you have not answered — putting the track on your profile would publish the claim on
 * your behalf, which is the exact thing confirmation exists to prevent.
 */
async function acceptedCreditTrackIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('track_collaborators')
    .select('track_id')
    .eq('user_id', userId)
    .eq('status', 'accepted');
  if (error) {throw new Error(error.message);}
  return [...new Set(((data ?? []) as Array<{ track_id: string }>).map(r => r.track_id))];
}

/**
 * Fetch posts authored by a user, newest first. When `kind` is set we
 * filter to that kind only (e.g. `upload` for the Uploads tab, `repost` for
 * the Reposts tab). Otherwise we return all posts (uploads + reposts).
 * For reposts we also resolve the original uploader's profile so the UI can
 * show a "Creator" tag.
 *
 * UPLOADS ALSO INCLUDE TRACKS THIS USER WAS CREDITED ON. A credit is co-authorship of
 * that upload, not a separate kind of thing, so the drummer's profile lists the record
 * they drummed on rather than hiding it behind its own tab. The post still belongs to
 * whoever uploaded it — this is a second place it is listed, not a copy.
 *
 * Two queries rather than one: PostgREST cannot express "author_id = me OR track_id in
 * (subquery)" without an RPC, and a merge here keeps the shape honest at the cost of one
 * extra round trip on a profile.
 */
export async function listPostsForUser(
  userId: string,
  options: ListPostsOptions = {},
): Promise<FeedPost[]> {
  const limit = options.limit ?? 10;

  const build = () => {
    let q = supabase
      .from('posts')
      .select(POST_SELECT)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (options.kind) {q = q.eq('kind', options.kind);}
    if (options.before) {q = q.lt('created_at', options.before);}
    return q;
  };

  // Credits only ever attach to uploads, so the Reposts tab has nothing to gain from the
  // second query and should not pay for it.
  const wantsCredits = options.kind !== 'repost';
  const creditTrackIds = wantsCredits ? await acceptedCreditTrackIds(userId) : [];

  const [own, credited] = await Promise.all([
    build().eq('author_id', userId),
    creditTrackIds.length > 0
      ? build().eq('kind', 'upload').in('track_id', creditTrackIds).neq('author_id', userId)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (own.error) {throw new Error(own.error.message);}
  if (credited.error) {throw new Error(credited.error.message);}

  // Merged, deduped by post id, and re-sorted: two newest-first pages interleave, and the
  // limit applies to the combined result so a page is the size the caller asked for.
  const byId = new Map<string, RawPostRow>();
  for (const row of [
    ...((own.data ?? []) as unknown as RawPostRow[]),
    ...((credited.data ?? []) as unknown as RawPostRow[]),
  ]) {
    byId.set(row.id, row);
  }
  const rows = [...byId.values()]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    .slice(0, limit);

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
    cover_art_url,
    duration_seconds
  ),
  author:profiles!posts_author_id_fkey (
    id,
    username,
    display_name,
    avatar_url
  )
` as const;

/**
 * Same again, but the AUTHOR is inner-joined so the search can filter on their name.
 *
 * A second select rather than a flag, because the two searches cannot be one query.
 * PostgREST applies a `.or` to a single embedded resource, and filters on two different
 * embedded tables are AND-ed together — so "the track matches OR its uploader matches" is
 * not expressible, and asking for it in one query silently returns the intersection instead.
 */
const SEARCH_POST_BY_AUTHOR_SELECT = SEARCH_POST_SELECT.replace(
  'author:profiles!posts_author_id_fkey (',
  'author:profiles!posts_author_id_fkey!inner (',
);

/**
 * Same again, reaching through to the ALBUM so the search can filter on its title.
 *
 * Searching a record's name should return the record's songs. Only the title track usually
 * carries the album's name — "Dhurandhar" is 11 tracks of which exactly one is called
 * "Dhurandhar Title Track" — so matching track text finds the album and one song, and the
 * other ten are invisible to somebody searching the only name they know.
 *
 * `!inner` at BOTH hops: a track with no album must not come back from this query, and an
 * album whose title does not match must not drag its tracks in.
 */
const SEARCH_POST_BY_ALBUM_SELECT = SEARCH_POST_SELECT.replace(
  `    duration_seconds
  ),`,
  `    duration_seconds,
    album_tracks!inner (
      albums!inner ( title )
    )
  ),`,
);

/**
 * Search upload posts by track title, description, tag, OR the uploader's name.
 * Reposts are intentionally excluded so each track appears once.
 *
 * The uploader match is why this runs two queries. Searching an artist and getting only their
 * profile — none of their music — is the obvious thing to expect and the obvious thing to be
 * missing; "vvk" should find the person AND what they made. PostgREST cannot express it in
 * one request (see `SEARCH_POST_BY_AUTHOR_SELECT`), so the two run in parallel and are merged
 * here. A track matching both ways appears once.
 *
 * `limit` therefore caps each MATCH PATH, not the merged result: up to `limit` by track text
 * and up to `limit` by uploader, so at most 2×. Capping the union instead would mean an exact
 * title match could be cut by twenty newer tracks from an artist whose name also matched,
 * which is the one result the searcher was most likely after. Ranking (see
 * `src/utils/searchRanking.ts`) puts the merged set in order.
 *
 * Tags participate in two different ways, and the difference is the leading '#':
 *
 *   · `lofi`  — matches title OR description OR an exact tag. Prose search, widened.
 *   · `#lofi` — matches the tag and nothing else. Typing the '#' is how someone says
 *     they mean the tag rather than the word, and honouring that is the whole reason
 *     the prefix is worth reading instead of stripping.
 *
 * The tag term goes through `normalizeTag`, the same function both upload screens use.
 * That is not tidiness — a search box that normalizes differently from the writer cannot
 * find what the writer stored, and nothing about the failure looks like a failure. It also
 * means the term reaching the PostgREST filter contains only letters, digits and
 * underscores, so it cannot carry the commas or parentheses that would break out of the
 * `or=(...)` grouping.
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

  const tagOnly = trimmed.startsWith('#');
  const tag = normalizeTag(trimmed);

  // A '#' query with nothing usable after it ("#", "#!") would otherwise fall through to a
  // prose search for the literal text, which is not what was asked for and returns noise.
  if (tagOnly && !tag) {
    return [];
  }

  const terms = tagOnly
    ? [`tags.cs.{${tag}}`]
    : [
        `title.ilike.${pattern}`,
        `description.ilike.${pattern}`,
        // Only when the query could BE a tag. A two-word query normalizes to one joined
        // token that no honest tag would match, and adding it costs a GIN probe per search.
        ...(tag ? [`tags.cs.{${tag}}`] : []),
      ];

  const byTrackText = supabase
    .from('posts')
    .select(SEARCH_POST_SELECT)
    .eq('kind', 'upload')
    .or(terms.join(','), { foreignTable: 'tracks' })
    .order('created_at', { ascending: false })
    .limit(limit);

  // Skipped entirely for a '#tag' query: a tag search means "tracks filed under this word",
  // and an artist whose handle happens to be that word has not filed anything under it.
  const byUploader = tagOnly
    ? null
    : supabase
        .from('posts')
        .select(SEARCH_POST_BY_AUTHOR_SELECT)
        .eq('kind', 'upload')
        .or(`username.ilike.${pattern},display_name.ilike.${pattern}`, { foreignTable: 'author' })
        .order('created_at', { ascending: false })
        .limit(limit);

  // Skipped for a '#tag' query for the same reason as the uploader path: a tag search means
  // "tracks filed under this word", and an album whose name happens to be that word has not
  // filed anything under it.
  const byAlbum = tagOnly
    ? null
    : supabase
        .from('posts')
        .select(SEARCH_POST_BY_ALBUM_SELECT)
        .eq('kind', 'upload')
        .ilike('tracks.album_tracks.albums.title', pattern)
        .order('created_at', { ascending: false })
        .limit(limit);

  const [textResult, uploaderResult, albumResult] = await Promise.all([
    byTrackText, byUploader, byAlbum,
  ]);

  if (textResult.error) {
    throw new Error(textResult.error.message);
  }
  // The uploader half is best-effort. It is an enhancement to a search that already works,
  // so a failure there should narrow the results rather than replace them with an error.
  const rows = [
    ...((textResult.data ?? []) as unknown as RawPostRow[]),
    ...(uploaderResult && !uploaderResult.error
      ? ((uploaderResult.data ?? []) as unknown as RawPostRow[])
      : []),
    ...(albumResult && !albumResult.error
      ? ((albumResult.data ?? []) as unknown as RawPostRow[])
      : []),
  ];

  // A track whose title AND uploader both match came back from both queries.
  const seen = new Set<string>();
  const deduped = rows.filter(row => {
    if (seen.has(row.id)) { return false; }
    seen.add(row.id);
    return true;
  });

  return hydrateRawPostRows(deduped);
}

export async function getProfileStats(userId: string): Promise<ProfileStats> {
  // Credited uploads count toward `uploads`, because they are listed in that tab — a tab
  // whose number disagrees with its contents reads as a bug in the number.
  const creditTrackIds = await acceptedCreditTrackIds(userId);

  const [
    { count: total, error: totalError },
    { count: uploads, error: uploadsError },
    { count: credited, error: creditedError },
  ] = await Promise.all([
    supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('author_id', userId),
    supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('author_id', userId)
      .eq('kind', 'upload'),
    creditTrackIds.length > 0
      ? supabase
          .from('posts')
          .select('id', { count: 'exact', head: true })
          .eq('kind', 'upload')
          .in('track_id', creditTrackIds)
          .neq('author_id', userId)
      : Promise.resolve({ count: 0, error: null }),
  ]);

  if (totalError) {throw new Error(totalError.message);}
  if (uploadsError) {throw new Error(uploadsError.message);}
  if (creditedError) {throw new Error(creditedError.message);}

  const credits = credited ?? 0;
  return { posts: (total ?? 0) + credits, uploads: (uploads ?? 0) + credits };
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

export type PostLiker = {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  /** When this user liked the post (ISO). Doubles as the pagination cursor. */
  likedAt: string;
};

type RawPostLikerRow = {
  user_id: string;
  created_at: string;
  user: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
};

/**
 * List the users who liked a post, newest first. Paginated by liked_at — pass
 * the previous page's last `likedAt` as `before` to fetch the next page.
 */
export async function listPostLikers(
  postId: string,
  options: { limit?: number; before?: string } = {},
): Promise<PostLiker[]> {
  const limit = options.limit ?? 30;
  let query = supabase
    .from('post_likes')
    .select(
      `
        user_id,
        created_at,
        user:profiles!post_likes_user_id_fkey (
          id,
          username,
          display_name,
          avatar_url
        )
      `,
    )
    .eq('post_id', postId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (options.before) {
    query = query.lt('created_at', options.before);
  }

  const { data, error } = await query;
  if (error) { throw new Error(error.message); }

  const rows = (data ?? []) as unknown as RawPostLikerRow[];
  return rows
    .filter(r => r.user)
    .map<PostLiker>(r => ({
      userId: r.user!.id,
      username: r.user!.username,
      displayName: r.user!.display_name,
      avatarUrl: r.user!.avatar_url,
      likedAt: r.created_at,
    }));
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
 * FK behavior on delete:
 *   - post_comments (and their likes/reports via comment cascade) — CASCADE
 *   - post_likes — CASCADE
 *   - post_views — CASCADE
 *   - playlist_posts (removed from all playlists that contained this post) — CASCADE
 *   - post_reports — CASCADE
 *   - activity_notifications — CASCADE
 *   - stories.original_post_id → stories sharing this post are also deleted — CASCADE
 *   - posts.original_post_id → reposts are NOT deleted. The FK is ON DELETE
 *     SET NULL, so reposts survive as orphans (original_post_id → null) with
 *     their own engagement intact and track_id still pointing at the track.
 *
 * Orphaned reposts are kept deliberately: the reposter sees a tombstone on
 * their profile and can remove it. They are excluded from the home feed
 * (`fetch_home_feed`) and stripped from play queues
 * (`PlaybackContext.setQueue`), so a deleted upload can never resurface in the
 * feed or play via next/prev.
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
    knownDurationSec: post.track.durationSeconds ?? 0,
  };
}
