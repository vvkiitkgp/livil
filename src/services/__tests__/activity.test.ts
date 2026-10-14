/**
 * listActivity — Spotify reposts in the livil Bot thread.
 *
 * activity_list finds a post's title and artwork through its Livil track. A Spotify repost
 * has no track (ADR-0027), so a like or comment on one used to arrive as a blank "Your post"
 * card. These pin that such a post is now marked with its Spotify id — and that nothing else
 * changes, including when the lookup fails.
 */
const mockRpc = jest.fn();
const mockFetchSpotifyTrackIds = jest.fn();
/** The batched posts → track lookup: called with the post ids, resolves `{ data, error }`. */
const mockPostDetails = jest.fn();
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: () => ({ select: () => ({ in: (_col: string, ids: string[]) => mockPostDetails(ids) }) }),
  },
}));
jest.mock('../spotify', () => ({
  fetchSpotifyTrackIds: (...a: unknown[]) => mockFetchSpotifyTrackIds(...a),
}));
jest.mock('../pushDispatch', () => ({ sendPush: jest.fn() }));

import { listActivity } from '../activity';

const SPOTIFY_ID = 'AAAAAAAAAAAAAAAAAAAAAA';

function row(over: Record<string, unknown>) {
  return {
    id: `n-${String(over.post_id)}`,
    type: 'like',
    actor_id: 'actor-1',
    agg_count: 1,
    is_read: false,
    created_at: '2026-10-13T10:00:00Z',
    updated_at: '2026-10-13T10:00:00Z',
    payload: null,
    actor_username: 'riya',
    actor_display_name: 'Riya',
    actor_avatar_url: null,
    post_title: null,
    post_cover_art_url: null,
    ...over,
  };
}

const LIVIL_LIKE = row({ post_id: 'post-livil', post_title: 'Midnight Drive', post_cover_art_url: 'https://x/cover.jpg' });
const SPOTIFY_LIKE = row({ post_id: 'post-spotify' });
const SPOTIFY_COMMENT = row({ post_id: 'post-spotify', type: 'comment', id: 'n-comment' });
const NEW_FAN = row({ post_id: null, type: 'new_fan', id: 'n-fan' });

beforeEach(() => {
  mockRpc.mockReset();
  mockFetchSpotifyTrackIds.mockReset();
  mockPostDetails.mockReset().mockResolvedValue({ data: [], error: null });
});

type PostRef = { title: string | null; coverArtUrl: string | null; artistName: string | null; spotifyTrackId: string | null };
function postOf(item: unknown) {
  return (item as { post?: PostRef }).post;
}

function details(id: string, track: Record<string, unknown> | null) {
  return { id, track: track && { title: null, cover_art_url: null, thumbnail_url: null, uploader: null, ...track } };
}

it('marks likes and comments on a Spotify repost with its Spotify id', async () => {
  mockRpc.mockResolvedValue({ data: [SPOTIFY_LIKE, SPOTIFY_COMMENT, LIVIL_LIKE, NEW_FAN], error: null });
  mockFetchSpotifyTrackIds.mockResolvedValue(new Map([['post-spotify', SPOTIFY_ID]]));

  const items = await listActivity();

  expect(items.map(i => postOf(i)?.spotifyTrackId ?? null)).toEqual([SPOTIFY_ID, SPOTIFY_ID, null, null]);
  // Asked once, and only about the post that came back without a title or artwork.
  expect(mockFetchSpotifyTrackIds).toHaveBeenCalledTimes(1);
  expect(mockFetchSpotifyTrackIds).toHaveBeenCalledWith(['post-spotify']);
});

it('does not look anything up when every post has its Livil details', async () => {
  mockRpc.mockResolvedValue({ data: [LIVIL_LIKE, NEW_FAN], error: null });

  const items = await listActivity();

  expect(mockFetchSpotifyTrackIds).not.toHaveBeenCalled();
  expect(postOf(items[0])).toEqual({
    postId: 'post-livil',
    title: 'Midnight Drive',
    coverArtUrl: 'https://x/cover.jpg',
    artistName: null,
    spotifyTrackId: null,
  });
});

it('leaves the thread as it was when the lookup finds nothing', async () => {
  mockRpc.mockResolvedValue({ data: [SPOTIFY_LIKE], error: null });
  mockFetchSpotifyTrackIds.mockResolvedValue(new Map());

  const items = await listActivity();

  expect(items).toHaveLength(1);
  expect(postOf(items[0])?.spotifyTrackId).toBeNull();
});

describe('Livil posts — cover and artist', () => {
  // activity_list returns only the track's cover_art_url and no artist. A like on a VIDEO
  // upload (thumbnail, no cover) drew the grey placeholder, and every Livil card read
  // "Tap to view" instead of who made the song.

  it('uses the video thumbnail when the track has no cover', async () => {
    const videoLike = row({ post_id: 'post-video', post_title: 'Jamming live' });
    mockRpc.mockResolvedValue({ data: [videoLike], error: null });
    mockPostDetails.mockResolvedValue({
      data: [details('post-video', { title: 'Jamming live', thumbnail_url: 'https://x/thumb.jpg', uploader: { username: 'arjun', display_name: 'Arjun' } })],
      error: null,
    });

    const [item] = await listActivity();

    expect(postOf(item)).toMatchObject({ coverArtUrl: 'https://x/thumb.jpg', artistName: 'Arjun' });
  });

  it("keeps the track's own cover over the thumbnail", async () => {
    mockRpc.mockResolvedValue({ data: [LIVIL_LIKE], error: null });
    mockPostDetails.mockResolvedValue({
      data: [details('post-livil', { cover_art_url: 'https://x/cover.jpg', thumbnail_url: 'https://x/thumb.jpg' })],
      error: null,
    });

    const [item] = await listActivity();

    expect(postOf(item)?.coverArtUrl).toBe('https://x/cover.jpg');
  });

  it('names the uploader, falling back to the username when there is no display name', async () => {
    // On a repost the post's author is the reposter; the track's uploader made the song.
    mockRpc.mockResolvedValue({ data: [LIVIL_LIKE], error: null });
    mockPostDetails.mockResolvedValue({
      data: [details('post-livil', { uploader: { username: 'sindhu', display_name: '  ' } })],
      error: null,
    });

    const [item] = await listActivity();

    expect(postOf(item)?.artistName).toBe('sindhu');
  });

  it('asks once, for Livil posts only — never about a Spotify repost', async () => {
    mockRpc.mockResolvedValue({ data: [SPOTIFY_LIKE, LIVIL_LIKE, NEW_FAN], error: null });
    mockFetchSpotifyTrackIds.mockResolvedValue(new Map([['post-spotify', SPOTIFY_ID]]));

    await listActivity();

    expect(mockPostDetails).toHaveBeenCalledTimes(1);
    expect(mockPostDetails).toHaveBeenCalledWith(['post-livil']);
  });

  it.each([
    ['an error response', () => mockPostDetails.mockResolvedValue({ data: null, error: { message: 'boom' } })],
    ['a thrown error', () => mockPostDetails.mockRejectedValue(new Error('offline'))],
  ])('renders the card as before on %s', async (_label, fail) => {
    const videoLike = row({ post_id: 'post-video', post_title: 'Jamming live' });
    mockRpc.mockResolvedValue({ data: [videoLike], error: null });
    fail();

    const [item] = await listActivity();

    expect(postOf(item)).toMatchObject({ title: 'Jamming live', coverArtUrl: null, artistName: null });
  });
});
