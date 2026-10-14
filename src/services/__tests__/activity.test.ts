/**
 * listActivity — what the livil Bot thread's post cards can say.
 *
 * activity_list finds a post's title and artwork through its Livil track, returns only the
 * track's cover (never a video's thumbnail) and no artist. So a like on a Spotify repost
 * arrived as a blank "Your post" card, a like on a VIDEO upload drew a grey placeholder, and
 * every Livil card read "Tap to view". One batched lookup now fills all three in. These pin
 * what it fills, that it is ONE query, and that a failed lookup leaves the thread exactly as
 * activity_list returned it.
 */
const mockRpc = jest.fn();
/** The batched posts lookup: called with the post ids, resolves `{ data, error }`. */
const mockPostDetails = jest.fn();
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: () => ({ select: () => ({ in: (_col: string, ids: string[]) => mockPostDetails(ids) }) }),
  },
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
const VIDEO_LIKE = row({ post_id: 'post-video', post_title: 'Jamming live' });
const SPOTIFY_LIKE = row({ post_id: 'post-spotify' });
const SPOTIFY_COMMENT = row({ post_id: 'post-spotify', type: 'comment', id: 'n-comment' });
const NEW_FAN = row({ post_id: null, type: 'new_fan', id: 'n-fan' });

/** A posts row as the lookup returns it. */
function details(id: string, over: { spotify?: string; track?: Record<string, unknown> | null } = {}) {
  const track = over.track === undefined ? {} : over.track;
  return {
    id,
    spotify_track_id: over.spotify ?? null,
    track: track && { title: null, cover_art_url: null, thumbnail_url: null, uploader: null, ...track },
  };
}

type PostRef = { postId: string; title: string | null; coverArtUrl: string | null; artistName: string | null; spotifyTrackId: string | null };
function postOf(item: unknown) {
  return (item as { post?: PostRef }).post;
}

beforeEach(() => {
  mockRpc.mockReset();
  mockPostDetails.mockReset().mockResolvedValue({ data: [], error: null });
});

describe('Spotify reposts', () => {
  it('marks likes and comments on a Spotify repost with its Spotify id', async () => {
    mockRpc.mockResolvedValue({ data: [SPOTIFY_LIKE, SPOTIFY_COMMENT, LIVIL_LIKE, NEW_FAN], error: null });
    mockPostDetails.mockResolvedValue({
      data: [details('post-spotify', { spotify: SPOTIFY_ID, track: null }), details('post-livil')],
      error: null,
    });

    const items = await listActivity();

    expect(items.map(i => postOf(i)?.spotifyTrackId ?? null)).toEqual([SPOTIFY_ID, SPOTIFY_ID, null, null]);
    // A Spotify repost has no Livil track: no artist is invented for it.
    expect(postOf(items[0])?.artistName).toBeNull();
  });
});

describe('Livil posts — cover and artist', () => {
  it('uses the video thumbnail when the track has no cover', async () => {
    mockRpc.mockResolvedValue({ data: [VIDEO_LIKE], error: null });
    mockPostDetails.mockResolvedValue({
      data: [details('post-video', { track: { title: 'Jamming live', thumbnail_url: 'https://x/thumb.jpg', uploader: { username: 'arjun', display_name: 'Arjun' } } })],
      error: null,
    });

    const [item] = await listActivity();

    expect(postOf(item)).toMatchObject({ coverArtUrl: 'https://x/thumb.jpg', artistName: 'Arjun' });
  });

  it("keeps the track's own cover over the thumbnail", async () => {
    mockRpc.mockResolvedValue({ data: [LIVIL_LIKE], error: null });
    mockPostDetails.mockResolvedValue({
      data: [details('post-livil', { track: { cover_art_url: 'https://x/cover.jpg', thumbnail_url: 'https://x/thumb.jpg' } })],
      error: null,
    });

    const [item] = await listActivity();

    expect(postOf(item)).toEqual({
      postId: 'post-livil',
      title: 'Midnight Drive',
      coverArtUrl: 'https://x/cover.jpg',
      artistName: null,
      spotifyTrackId: null,
    });
  });

  it('names the uploader, falling back to the username when there is no display name', async () => {
    // On a repost the post's author is the reposter; the track's uploader made the song.
    mockRpc.mockResolvedValue({ data: [LIVIL_LIKE], error: null });
    mockPostDetails.mockResolvedValue({
      data: [details('post-livil', { track: { uploader: { username: 'sindhu', display_name: '  ' } } })],
      error: null,
    });

    const [item] = await listActivity();

    expect(postOf(item)?.artistName).toBe('sindhu');
  });
});

describe('the lookup', () => {
  it('is ONE query for every post in the page, each id once', async () => {
    mockRpc.mockResolvedValue({ data: [SPOTIFY_LIKE, SPOTIFY_COMMENT, LIVIL_LIKE, NEW_FAN], error: null });

    await listActivity();

    expect(mockPostDetails).toHaveBeenCalledTimes(1);
    expect(mockPostDetails.mock.calls[0][0].sort()).toEqual(['post-livil', 'post-spotify']);
  });

  it('is skipped when the caller only needs the text', async () => {
    mockRpc.mockResolvedValue({ data: [LIVIL_LIKE], error: null });

    await listActivity(undefined, { postDetails: false });

    expect(mockPostDetails).not.toHaveBeenCalled();
  });

  it('is skipped when no item has a post', async () => {
    mockRpc.mockResolvedValue({ data: [NEW_FAN], error: null });

    await listActivity();

    expect(mockPostDetails).not.toHaveBeenCalled();
  });

  it.each([
    ['finds nothing', () => mockPostDetails.mockResolvedValue({ data: [], error: null })],
    ['returns an error', () => mockPostDetails.mockResolvedValue({ data: null, error: { message: 'boom' } })],
    ['throws', () => mockPostDetails.mockRejectedValue(new Error('offline'))],
  ])('leaves the thread as activity_list returned it when it %s', async (_label, fail) => {
    mockRpc.mockResolvedValue({ data: [VIDEO_LIKE, SPOTIFY_LIKE], error: null });
    fail();

    const items = await listActivity();

    expect(items).toHaveLength(2);
    expect(postOf(items[0])).toMatchObject({ title: 'Jamming live', coverArtUrl: null, artistName: null, spotifyTrackId: null });
    expect(postOf(items[1])?.spotifyTrackId).toBeNull();
  });
});
