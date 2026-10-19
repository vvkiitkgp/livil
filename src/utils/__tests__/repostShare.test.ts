import { repostLabel, repostSharePayload, sharedRepostIdFrom } from '../repostShare';

const REPOST_ID = '8f14e45f-ceea-4d1a-9c0f-1f2a3b4c5d6e';
const UPLOAD_ID = '1b4e28ba-2fa1-4d2e-8b3a-9f6c1d2e3f40';

const riya = { id: 'u-riya', username: 'riya', displayName: 'Riya Kapoor', avatarUrl: null };
const arijit = { id: 'u-arijit', username: 'arijit', displayName: '  ', avatarUrl: null };

const track = {
  id: 't-1',
  title: 'Kesariya',
  coverArtUrl: null,
  thumbnailUrl: 'https://cdn.example/thumb.jpg',
};

const livilRepost = {
  id: REPOST_ID,
  kind: 'repost' as const,
  originalPostId: UPLOAD_ID,
  originalAuthor: arijit,
  author: riya,
  spotifyTrackId: null,
  track,
} as unknown as Parameters<typeof repostSharePayload>[0];

describe('repostSharePayload', () => {
  it('sends a Livil repost as a track_share of its ORIGINAL upload, plus the repost id', () => {
    expect(repostSharePayload(livilRepost)).toEqual({
      kind: 'track_share',
      metadata: {
        track_id: 't-1',
        // An older build plays and reposts post_id, and Repost needs an original upload.
        post_id: UPLOAD_ID,
        title: 'Kesariya',
        // The song's maker, not the reposter; a blank display name falls back to the handle.
        artist_name: 'arijit',
        cover_art_url: 'https://cdn.example/thumb.jpg',
        repost_post_id: REPOST_ID,
      },
    });
  });

  it('sends a Spotify repost as its Spotify link, which every build already draws', () => {
    expect(
      repostSharePayload({ ...livilRepost, spotifyTrackId: '4uLU6hMCjMI75M1A2tKUQC', originalPostId: null }),
    ).toEqual({
      kind: 'text',
      body: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
      metadata: { repost_post_id: REPOST_ID },
    });
  });

  it('refuses an upload and an orphaned repost', () => {
    expect(repostSharePayload({ ...livilRepost, kind: 'upload' })).toBeNull();
    expect(repostSharePayload({ ...livilRepost, originalPostId: null })).toBeNull();
  });
});

describe('sharedRepostIdFrom', () => {
  it('round-trips what the sheet sends', () => {
    expect(sharedRepostIdFrom(repostSharePayload(livilRepost)!.metadata)).toBe(REPOST_ID);
  });

  it("never trusts the sender's metadata", () => {
    expect(sharedRepostIdFrom(null)).toBeNull();
    expect(sharedRepostIdFrom('x')).toBeNull();
    expect(sharedRepostIdFrom({})).toBeNull();
    expect(sharedRepostIdFrom({ repost_post_id: 42 })).toBeNull();
    expect(sharedRepostIdFrom({ repost_post_id: 'not-a-uuid' })).toBeNull();
    expect(sharedRepostIdFrom({ repost_post_id: `${REPOST_ID}' or 1=1` })).toBeNull();
  });

  it('a plain song share or a GIF is not a repost', () => {
    expect(sharedRepostIdFrom({ track_id: 't', post_id: UPLOAD_ID, title: 'Song' })).toBeNull();
    expect(sharedRepostIdFrom({ gif: { provider: 'giphy', id: 'abc', width: 1, height: 1 } })).toBeNull();
  });
});

it('labels the card by whose repost it is', () => {
  expect(repostLabel('Riya Kapoor', false)).toBe("Riya Kapoor's repost");
  expect(repostLabel('Riya Kapoor', true)).toBe('Your repost');
});
