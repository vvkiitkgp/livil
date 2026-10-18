import { act, create } from 'react-test-renderer';
import React from 'react';
import type { FeedPost } from '../../../services/posts';
import {
  PICK_COUNT,
  fullSongClip,
  pickFromPost,
  pickFromSpotify,
  togglePick,
  uniquePicks,
  usePickThree,
  type GuidePick,
} from '../pickSongs';

const mockCreateRepost = jest.fn();
const mockCreateSpotifyRepost = jest.fn();
jest.mock('../../../services/posts', () => ({
  createRepost: (...args: unknown[]) => mockCreateRepost(...args),
  createSpotifyRepost: (...args: unknown[]) => mockCreateSpotifyRepost(...args),
  isPlayableInLivil: (p: { spotifyTrackId: string | null; track: { audioUrl: string | null } }) =>
    p.spotifyTrackId == null && Boolean(p.track.audioUrl),
}));
jest.mock('../../../services/spotify', () => ({
  artistLine: (t: { artists: string[] }) => t.artists.join(', '),
}));
const mockGetWaveformPeaks = jest.fn();
jest.mock('../../../services/tracks', () => ({
  getWaveformPeaks: (...args: unknown[]) => mockGetWaveformPeaks(...args),
}));

function post(over: Partial<FeedPost> & { id: string }): FeedPost {
  return {
    kind: 'upload',
    originalPostId: null,
    spotifyTrackId: null,
    clipStartSec: 30,
    clipEndSec: 75,
    author: { id: 'u-riya', username: 'riya.sings', displayName: 'Riya Sharma', avatarUrl: null },
    originalAuthor: null,
    track: { id: `t-${over.id}`, title: 'Full Moon, Pune', durationSeconds: 120, audioUrl: 'https://cdn/full-moon.mp3', videoUrl: null, coverArtUrl: 'https://cdn/c.jpg', thumbnailUrl: null },
    ...over,
  } as unknown as FeedPost;
}

const spotifyTrack = { id: '0VjIjW4GlUZAMYd2vXMi3b', title: 'Blinding Lights', artists: ['The Weeknd'], album: null, imageUrl: null, durationMs: null };

describe('pickFromPost', () => {
  it('an upload is picked as itself', () => {
    expect(pickFromPost(post({ id: 'p-upload' }))).toEqual(expect.objectContaining({
      kind: 'livil', key: 'livil:p-upload', uploadPostId: 'p-upload', trackId: 't-p-upload', durationSec: 120,
      artist: 'Riya Sharma',
    }));
  });

  it('a repost is picked as the UPLOAD it reposts, credited to the uploader', () => {
    const p = pickFromPost(post({
      id: 'p-repost',
      kind: 'repost',
      originalPostId: 'p-upload',
      originalAuthor: { id: 'u-riya', username: 'riya.sings', displayName: null, avatarUrl: null },
      author: { id: 'u-arjun', username: 'arjun', displayName: 'Arjun', avatarUrl: null },
    } as Partial<FeedPost> & { id: string }));
    expect(p).toEqual(expect.objectContaining({ key: 'livil:p-upload', uploadPostId: 'p-upload', artist: '@riya.sings' }));
  });

  it('skips a repost whose upload was deleted, and anything Livil cannot play', () => {
    expect(pickFromPost(post({ id: 'p1', kind: 'repost', originalPostId: null }))).toBeNull();
    expect(pickFromPost(post({ id: 'p2', spotifyTrackId: spotifyTrack.id }))).toBeNull();
  });
});

describe('fullSongClip', () => {
  it('is the whole song, as an explicit window so the feed highlights it', () => {
    expect(fullSongClip(101, null)).toEqual({ start: 0, end: 101 });
  });

  it('reads the length from the loudness map when the track has none, else gives up', () => {
    expect(fullSongClip(0, { hz: 10, peaks: new Array(905).fill(0.5) })).toEqual({ start: 0, end: 90.5 });
    expect(fullSongClip(0, null)).toBeNull();
  });
});

describe('uniquePicks', () => {
  it('keeps one row per song, first one wins', () => {
    const a = pickFromPost(post({ id: 'p-upload' }));
    const b = pickFromPost(post({ id: 'p-repost', kind: 'repost', originalPostId: 'p-upload' }));
    expect(uniquePicks([a, null, b, pickFromSpotify(spotifyTrack)]).map(p => p.key))
      .toEqual(['livil:p-upload', `spotify:${spotifyTrack.id}`]);
  });
});

describe('togglePick', () => {
  const songs = ['a', 'b', 'c', 'd'].map(id => pickFromPost(post({ id }))!) as GuidePick[];
  const none = new Set<string>();

  it('adds up to three, then refuses a fourth', () => {
    let picks: GuidePick[] = [];
    for (const s of songs.slice(0, PICK_COUNT)) {
      const r = togglePick(picks, s, none);
      expect(r.result).toBe('added');
      picks = r.picks;
    }
    const full = togglePick(picks, songs[3], none);
    expect(full.result).toBe('full');
    expect(full.picks).toBe(picks);
  });

  it('a second tap removes — unless the song is already reposted', () => {
    const picks = [songs[0], songs[1]];
    expect(togglePick(picks, songs[0], none)).toEqual({ picks: [songs[1]], result: 'removed' });
    expect(togglePick(picks, songs[0], new Set([songs[0].key]))).toEqual({ picks, result: 'locked' });
  });
});

describe('usePickThree', () => {
  function mount() {
    const ref: { current: ReturnType<typeof usePickThree> | null } = { current: null };
    function Probe() { ref.current = usePickThree(); return null; }
    act(() => { create(React.createElement(Probe)); });
    return ref;
  }

  beforeEach(() => {
    mockCreateRepost.mockReset();
    mockCreateSpotifyRepost.mockReset();
    mockGetWaveformPeaks.mockReset().mockResolvedValue(null);
  });

  it('reposts the three without a caption, each Livil song highlighted whole, then is done', async () => {
    mockCreateRepost.mockResolvedValue({ postId: 'new' });
    mockCreateSpotifyRepost.mockResolvedValue({ postId: 'new' });
    const h = mount();
    act(() => { h.current!.toggle(pickFromPost(post({ id: 'a' }))!); });
    act(() => { h.current!.toggle(pickFromSpotify(spotifyTrack)); });
    act(() => { h.current!.toggle(pickFromPost(post({ id: 'b' }))!); });

    let failed: GuidePick | null = null;
    await act(async () => { failed = await h.current!.submit(); });

    expect(failed).toBeNull();
    expect(h.current!.status).toBe('done');
    // The clip the found post played is ignored: a guide repost is always the whole song.
    expect(mockCreateRepost.mock.calls).toEqual([['a', '', 0, 120], ['b', '', 0, 120]]);
    expect(mockGetWaveformPeaks).not.toHaveBeenCalled();
    expect(mockCreateSpotifyRepost.mock.calls).toEqual([[spotifyTrack.id, '']]);
  });

  it('when one fails, a retry posts only what is left — never a song twice', async () => {
    mockCreateRepost
      .mockResolvedValueOnce({ postId: '1' })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ postId: 'n' });
    const h = mount();
    for (const id of ['a', 'b', 'c']) {
      act(() => { h.current!.toggle(pickFromPost(post({ id }))!); });
    }

    let failed: GuidePick | null = null;
    await act(async () => { failed = await h.current!.submit(); });
    expect(failed).toEqual(expect.objectContaining({ uploadPostId: 'b' }));
    expect(h.current!.status).toBe('picking');
    expect([...h.current!.posted]).toEqual(['livil:a']);

    await act(async () => { failed = await h.current!.submit(); });
    expect(failed).toBeNull();
    expect(h.current!.status).toBe('done');
    expect(mockCreateRepost.mock.calls.map(c => c[0])).toEqual(['a', 'b', 'b', 'c']);
  });
});
