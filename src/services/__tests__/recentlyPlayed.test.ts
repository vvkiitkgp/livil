/**
 * Recently Played = Livil plays + Spotify hand-offs, merged by time across pages. The merge
 * must never show a song twice, skip one at a page boundary, or let the Spotify half (a
 * newer server function) break the Livil list when it is missing.
 */
const mockRpc = jest.fn();
jest.mock('../../../lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

const mockLivilPage = jest.fn();
jest.mock('../tracks', () => ({
  listRecentTracksPage: (...args: unknown[]) => mockLivilPage(...args),
}));

const mockGetTrack = jest.fn();
jest.mock('../spotify', () => ({
  getSpotifyTrack: (id: string) => mockGetTrack(id),
  artistLine: (t: { artists: string[] }) => t.artists.join(', '),
}));

import { listRecentlyPlayedPage, mergeCutoff } from '../recentlyPlayed';

const A = 'AAAAAAAAAAAAAAAAAAAAAA';
const B = 'BBBBBBBBBBBBBBBBBBBBBB';

function livil(trackId: string, playedAt: string) {
  return { trackId, postId: `post-${trackId}`, title: trackId, artistLabel: 'Riya', coverArtUrl: null, playedAt };
}

beforeEach(() => {
  mockRpc.mockReset();
  mockLivilPage.mockReset();
  mockGetTrack.mockReset();
  mockGetTrack.mockImplementation(async (id: string) => ({
    id, title: `Song ${id[0]}`, artists: ['The Weeknd'], album: null, imageUrl: 'https://i.scdn.co/x', durationMs: null,
  }));
});

describe('mergeCutoff', () => {
  it('both lists done → no more pages', () => {
    expect(mergeCutoff(null, { lastAt: '2026-10-01T00:00:00Z', exhausted: true })).toBeNull();
  });
  it('stops at the NEWER of the two frontiers', () => {
    expect(mergeCutoff('2026-10-03T00:00:00Z', { lastAt: '2026-10-05T00:00:00Z', exhausted: false }))
      .toBe('2026-10-05T00:00:00Z');
  });
  it('a finished list does not hold the other back', () => {
    expect(mergeCutoff('2026-10-03T00:00:00Z', { lastAt: '2026-10-05T00:00:00Z', exhausted: true }))
      .toBe('2026-10-03T00:00:00Z');
  });
});

it('interleaves Spotify songs by time, as Spotify-tagged rows', async () => {
  mockLivilPage.mockResolvedValue({
    items: [livil('t1', '2026-10-05T10:00:00Z'), livil('t2', '2026-10-03T10:00:00Z')],
    nextBefore: null,
  });
  mockRpc.mockResolvedValue({ data: [{ spotify_track_id: A, opened_at: '2026-10-04T10:00:00Z' }], error: null });

  const { items, nextBefore } = await listRecentlyPlayedPage(24);

  expect(items.map(i => i.trackId)).toEqual(['t1', `spotify:${A}`, 't2']);
  expect(items[1]).toMatchObject({ spotifyTrackId: A, postId: null, title: 'Song A', artistLabel: 'The Weeknd' });
  expect(nextBefore).toBeNull();
  expect(mockRpc).toHaveBeenCalledWith('my_recent_spotify_opens', { p_limit: 24 });
});

it('holds back rows below the cutoff so the next page shows them in order, once', async () => {
  // Livil page is full (more history below 10-04); Spotify's single row is older than that.
  mockLivilPage.mockResolvedValueOnce({
    items: [livil('t1', '2026-10-05T10:00:00Z'), livil('t2', '2026-10-04T10:00:00Z')],
    nextBefore: '2026-10-04T10:00:00Z',
  });
  mockRpc.mockResolvedValueOnce({ data: [{ spotify_track_id: A, opened_at: '2026-10-02T10:00:00Z' }], error: null });

  const first = await listRecentlyPlayedPage(2);
  expect(first.items.map(i => i.trackId)).toEqual(['t1', 't2']);
  expect(first.nextBefore).toBe('2026-10-04T10:00:00Z');

  // Page two: the Livil play at 10-03 belongs ABOVE the Spotify one at 10-02.
  mockLivilPage.mockResolvedValueOnce({ items: [livil('t3', '2026-10-03T10:00:00Z')], nextBefore: null });
  mockRpc.mockResolvedValueOnce({ data: [{ spotify_track_id: A, opened_at: '2026-10-02T10:00:00Z' }], error: null });

  const second = await listRecentlyPlayedPage(2, first.nextBefore!);
  expect(second.items.map(i => i.trackId)).toEqual(['t3', `spotify:${A}`]);
  expect(second.nextBefore).toBeNull();
  expect(mockRpc).toHaveBeenLastCalledWith('my_recent_spotify_opens', { p_limit: 2, p_before: '2026-10-04T10:00:00Z' });
});

it('the Livil list alone when the Spotify function is not there yet', async () => {
  mockLivilPage.mockResolvedValue({ items: [livil('t1', '2026-10-05T10:00:00Z')], nextBefore: null });
  mockRpc.mockResolvedValue({ data: null, error: { message: 'function my_recent_spotify_opens does not exist' } });

  const { items, nextBefore } = await listRecentlyPlayedPage(24);
  expect(items.map(i => i.trackId)).toEqual(['t1']);
  expect(nextBefore).toBeNull();
});

it('leaves out a song Spotify no longer has', async () => {
  mockLivilPage.mockResolvedValue({ items: [], nextBefore: null });
  mockRpc.mockResolvedValue({
    data: [
      { spotify_track_id: A, opened_at: '2026-10-05T10:00:00Z' },
      { spotify_track_id: B, opened_at: '2026-10-04T10:00:00Z' },
    ],
    error: null,
  });
  mockGetTrack.mockImplementation(async (id: string) => (id === A ? null : {
    id, title: 'Song B', artists: ['SZA'], album: null, imageUrl: null, durationMs: null,
  }));

  const { items } = await listRecentlyPlayedPage(24);
  expect(items.map(i => i.spotifyTrackId)).toEqual([B]);
});
