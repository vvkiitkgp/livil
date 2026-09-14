/**
 * Search result ordering.
 *
 * Worth pinning because the list has NO section headers, so the order is the only thing
 * telling the user why a result is where it is. A wrong order does not throw and does not
 * look broken — it looks like the search is bad at its job, which is the kind of failure
 * nobody files a bug for.
 */
import { rankSearchResults, scoreName, popularityScore } from '../searchRanking';
import type { FeedPost } from '../../services/posts';
import type { ProfileSearchResult } from '../../services/tracks';
import type { AlbumSearchResult } from '../../services/albums';

const post = (
  id: string,
  title: string,
  counts: Partial<Pick<FeedPost, 'viewsCount' | 'likesCount' | 'commentsCount' | 'repostsCount'>> = {},
): FeedPost => ({ id, track: { id, title }, ...counts } as unknown as FeedPost);

const profile = (id: string, username: string, displayName: string | null = null): ProfileSearchResult =>
  ({ id, username, displayName, avatarUrl: null });

const album = (id: string, title: string, uploaderUsername = 'someone'): AlbumSearchResult =>
  ({ id, title, uploaderUsername } as unknown as AlbumSearchResult);

/** Compact view of the order, so a failure reads as a sequence rather than a diff of objects. */
const order = (results: ReturnType<typeof rankSearchResults>) =>
  results.map(r => `${r.kind}:${r.id}`);

describe('scoreName', () => {
  it('ranks exact above prefix above contains', () => {
    expect(scoreName('gym', 'gym')).toBeGreaterThan(scoreName('gym rat', 'gym'));
    expect(scoreName('gym rat', 'gym')).toBeGreaterThan(scoreName('the gym rat', 'gym'));
  });

  it('is case-insensitive', () => {
    expect(scoreName('Beat It', 'beat it')).toBe(scoreName('beat it', 'beat it'));
  });

  it('scores a non-match as "matched some other way", never zero', () => {
    // Everything in the list matched somehow or the service would not have returned it.
    // Zero would claim it should not be here, which this function cannot know.
    expect(scoreName('Beat It', 'gym')).toBeGreaterThan(0);
  });
});

describe('popularityScore', () => {
  it('weights a repost above a comment above a like above a play', () => {
    expect(popularityScore({ repostsCount: 10 })).toBeGreaterThan(popularityScore({ commentsCount: 10 }));
    expect(popularityScore({ commentsCount: 10 })).toBeGreaterThan(popularityScore({ likesCount: 10 }));
    expect(popularityScore({ likesCount: 10 })).toBeGreaterThan(popularityScore({ viewsCount: 10 }));
  });

  it('does not let plays drown the other three signals', () => {
    // The reason every signal is log-scaled. Raw weighted sums make this fail: 1×5000 plays
    // would bury 4×50 reposts, and three of the four signals would stop mattering at all.
    const allPlays = popularityScore({ viewsCount: 5000 });
    const engaged = popularityScore({ viewsCount: 200, likesCount: 60, commentsCount: 20, repostsCount: 50 });
    expect(engaged).toBeGreaterThan(allPlays);
  });

  it('treats missing, zero and negative counts alike', () => {
    expect(popularityScore({})).toBe(0);
    expect(popularityScore({ viewsCount: 0, likesCount: 0 })).toBe(0);
    expect(popularityScore({ viewsCount: -5 })).toBe(0);
  });
});

describe('rankSearchResults', () => {
  it('puts an exact name match first, whatever its kind', () => {
    // The case that matters: searching a handle should surface the person, without needing
    // a type-priority hack — they win on match quality alone.
    const ranked = rankSearchResults({
      posts: [post('p1', 'Song about test1')],
      profiles: [profile('u1', 'test1')],
      query: 'test1',
    });
    expect(order(ranked)[0]).toBe('user:u1');
  });

  it('finds a profile by display name as well as by handle', () => {
    const ranked = rankSearchResults({
      profiles: [profile('u1', 'xyz123', 'Vamsi')],
      query: 'vamsi',
    });
    expect(order(ranked)).toEqual(['user:u1']);
  });

  it('finds an album by its uploader handle, not only its title', () => {
    const ranked = rankSearchResults({
      albums: [album('a1', 'Thriller', 'test1')],
      posts: [post('p1', 'unrelated')],
      query: 'test1',
    });
    expect(order(ranked)[0]).toBe('album:a1');
  });

  it('breaks equal matches songs → people → albums', () => {
    const ranked = rankSearchResults({
      posts: [post('p1', 'love')],
      profiles: [profile('u1', 'love')],
      albums: [album('a1', 'love')],
      query: 'love',
    });
    expect(order(ranked)).toEqual(['track:p1', 'user:u1', 'album:a1']);
  });

  it('keeps service order when nothing matches by name — a tag-only query', () => {
    // `#gym` matches every track equally well. Inventing a ranking here would be fiction;
    // newest-first, as the service returned them, is the honest fallback.
    const ranked = rankSearchResults({
      posts: [post('p1', 'Beat It'), post('p2', 'Pehle Bhi Main'), post('p3', 'Shararat')],
      query: 'gym',
    });
    expect(order(ranked)).toEqual(['track:p1', 'track:p2', 'track:p3']);
  });

  it('ranks a visible-name match above a tag-only match', () => {
    // p2 is on screen because of a tag the user cannot see. p1 says why it is here.
    const ranked = rankSearchResults({
      posts: [post('p2', 'Something Else'), post('p1', 'Gym Anthem')],
      query: 'gym',
    });
    expect(order(ranked)).toEqual(['track:p1', 'track:p2']);
  });

  it('puts the more popular of two identically-named songs first', () => {
    // The case this exists for: anyone can upload a cover, so two tracks share a title and
    // the one people actually play is almost always the one they meant.
    const ranked = rankSearchResults({
      posts: [
        post('quiet', 'Gehra Hua', { viewsCount: 3 }),
        post('loved', 'Gehra Hua', { viewsCount: 900, likesCount: 40, repostsCount: 12 }),
      ],
      query: 'gehra hua',
    });
    expect(order(ranked)).toEqual(['track:loved', 'track:quiet']);
  });

  it('never lets popularity beat a better name match', () => {
    // A wildly popular track that merely CONTAINS the word must not outrank the exact title,
    // or searching a song by its full name stops working the moment something else is a hit.
    const ranked = rankSearchResults({
      posts: [
        post('famous', 'Gym Anthem Deluxe', { viewsCount: 100000, repostsCount: 5000 }),
        post('exact', 'Gym', {}),
      ],
      query: 'gym',
    });
    expect(order(ranked)).toEqual(['track:exact', 'track:famous']);
  });

  it('orders a tag-only query by popularity, since no name matched', () => {
    const ranked = rankSearchResults({
      posts: [
        post('p1', 'Beat It', { viewsCount: 10 }),
        post('p2', 'Pehle Bhi Main', { viewsCount: 10, likesCount: 50 }),
      ],
      query: 'gym',
    });
    expect(order(ranked)).toEqual(['track:p2', 'track:p1']);
  });

  it('returns an empty list for no results rather than throwing', () => {
    expect(rankSearchResults({ query: 'anything' })).toEqual([]);
  });

  it('is stable — equal entries never reshuffle between calls', () => {
    const input = {
      posts: [post('p1', 'a'), post('p2', 'a'), post('p3', 'a')],
      query: 'zzz',
    };
    expect(order(rankSearchResults(input))).toEqual(order(rankSearchResults(input)));
  });
});

describe('search taps as a ranking signal', () => {
  it('lets a much-opened song outrank an equally-matching quiet one', () => {
    const ranked = rankSearchResults({
      posts: [post('quiet', 'Gehra Hua'), post('opened', 'Gehra Hua')],
      query: 'gehra hua',
      // Keyed by TRACK id, which the stub sets equal to the post id here.
      taps: { opened: 40 },
    });
    expect(order(ranked)).toEqual(['track:opened', 'track:quiet']);
  });

  it('gives people and albums a popularity they otherwise could not have', () => {
    // Profiles and albums carry no engagement counters, so before taps they always tied and
    // fell back to insertion order. Now the one people actually open leads.
    const ranked = rankSearchResults({
      profiles: [profile('ignored', 'love'), profile('sought', 'love')],
      query: 'love',
      taps: { sought: 12 },
    });
    expect(order(ranked)).toEqual(['user:sought', 'user:ignored']);
  });

  it('still never beats a better name match', () => {
    const ranked = rankSearchResults({
      posts: [post('famous', 'Gym Anthem Deluxe'), post('exact', 'Gym')],
      query: 'gym',
      taps: { famous: 5000 },
    });
    expect(order(ranked)).toEqual(['track:exact', 'track:famous']);
  });

  it('treats absent tap data as zero rather than breaking', () => {
    expect(() => rankSearchResults({ posts: [post('p1', 'a')], query: 'a' })).not.toThrow();
  });
});
