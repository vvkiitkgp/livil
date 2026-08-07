/**
 * Ordering for the unified search list.
 *
 * Search shows songs, people and albums in ONE flat list with no section headers. That is a
 * deliberate product choice, and it moves all of the explaining onto the order itself: with
 * headers, "why is this here" is answered by the label above it; without them, the sequence
 * is the only answer the user gets. An order nobody can predict reads as broken, so the rule
 * has to be small enough to hold in your head:
 *
 *   1. How well the NAME matches what you typed — exact, then prefix, then contains.
 *   2. Anything that matched some other way (a tag, a description, a username) comes after
 *      everything whose visible name matched, because the reason it is on screen is not
 *      visible on screen.
 *   3. Among equally good matches, the more POPULAR song first. Two tracks called "Gehra Hua"
 *      is the normal case on a platform where anyone can upload a cover, and the one people
 *      actually play is almost always the one they meant.
 *   4. Ties break songs → people → albums. It is a music app; when everything else is equal,
 *      the music leads.
 *   5. Ties beyond that keep the order the services returned, which is newest-first.
 *
 * Rule 1 is what makes searching an exact username put the person on top without any
 * type-priority hack: `test1` matches that profile exactly (4) and merely appears in a track's
 * tags (1), so the person wins on merit.
 *
 * Kept pure and separate from the screen so it can be tested — the ordering is the part most
 * likely to be quietly wrong, and the part least likely to be noticed when it is.
 */
import type { FeedPost } from '../services/posts';
import type { ProfileSearchResult } from '../services/tracks';
import type { AlbumSearchResult } from '../services/albums';

export type SearchResult =
  | { kind: 'track'; id: string; post: FeedPost }
  | { kind: 'user'; id: string; profile: ProfileSearchResult }
  | { kind: 'album'; id: string; album: AlbumSearchResult };

/** Ties break in this order. Songs first — it is a music app. */
const KIND_WEIGHT: Record<SearchResult['kind'], number> = { track: 0, user: 1, album: 2 };

const EXACT = 4;
const PREFIX = 3;
const CONTAINS = 2;
/** On screen for a reason the screen does not show: a tag, a description, a handle. */
const OTHER = 1;

/**
 * Score one name against the query.
 *
 * Returns OTHER rather than zero for a non-match: everything in this list matched the query
 * somehow, or the service would not have returned it. A zero would imply "should not be here",
 * which is a different claim and not one this function is in a position to make.
 */
export function scoreName(name: string | null | undefined, query: string): number {
  const haystack = (name ?? '').trim().toLowerCase();
  const needle = query.trim().toLowerCase();
  if (!needle || !haystack) return OTHER;
  if (haystack === needle) return EXACT;
  if (haystack.startsWith(needle)) return PREFIX;
  if (haystack.includes(needle)) return CONTAINS;
  return OTHER;
}

/**
 * How much a track is actually listened to, on a 0-ish upward scale.
 *
 * Four signals, weighted by how much intent each one costs. A play can be an accident; a like
 * is a deliberate tap; a comment took typing; a repost put the track on your own profile and
 * in front of your friends. So they weight 1 / 2 / 3 / 4 in that order.
 *
 * EVERY SIGNAL IS LOG-SCALED, and that is the part that matters. Plays outnumber likes by
 * one or two orders of magnitude on any real track, so a raw weighted sum is a play count
 * wearing a costume — 4×reposts never catches 1×plays, and the other three signals may as
 * well not be there. `log1p` puts them on comparable footing: going from 10 plays to 100
 * counts about as much as going from 1 like to 4, which is roughly how a listener would rank
 * those two facts.
 *
 * Deliberately NOT time-decayed. A decay constant is a product decision about how quickly the
 * back catalogue should disappear, and picking one here — where it would be invisible — is
 * how a search result quietly becomes a recency feed. If it is wanted, it belongs in a place
 * that says so.
 */
export function popularityScore(counts: {
  viewsCount?: number;
  likesCount?: number;
  commentsCount?: number;
  repostsCount?: number;
  /**
   * Distinct people who opened this FROM SEARCH (`search_result_popularity`).
   *
   * The most on-topic signal there is for ordering search results: it is literally "people
   * who searched, saw this among the options, and chose it". Weighted above a play and a
   * like, below a repost.
   *
   * KNOWN FEEDBACK LOOP, named rather than hidden: ranking higher earns taps, and taps earn
   * rank. The log scale is most of the answer — the tenth tap moves a track far less than
   * the first — and match quality still dominates, so this only reorders results that were
   * already equally good matches. Worth watching once there is enough traffic to see it;
   * the fix, if it bites, is a time window rather than removing the signal.
   */
  searchTaps?: number;
}): number {
  const safe = (n: number | undefined) => (typeof n === 'number' && n > 0 ? n : 0);
  return (
    1 * Math.log1p(safe(counts.viewsCount)) +
    2 * Math.log1p(safe(counts.likesCount)) +
    3 * Math.log1p(safe(counts.commentsCount)) +
    4 * Math.log1p(safe(counts.repostsCount)) +
    3 * Math.log1p(safe(counts.searchTaps))
  );
}

/**
 * Popularity for any result kind.
 *
 * Only tracks carry engagement counts today, so people and albums score 0 and fall to the
 * kind tie-break below them. That is honest rather than a gap: there is no "plays" for a
 * profile, and inventing one from follower counts would rank people by a different currency
 * while presenting it as the same number.
 */
function popularityOf(result: SearchResult, taps: TapCounts): number {
  const searchTaps = taps[idOfEntity(result)] ?? 0;
  // People and albums have no engagement counters, but they DO have taps — so a person
  // everyone opens can now outrank one nobody does, which was impossible before.
  return result.kind === 'track'
    ? popularityScore({ ...result.post, searchTaps })
    : popularityScore({ searchTaps });
}

/** Taps are counted per ENTITY (track/album/profile), not per post. */
export type TapCounts = Record<string, number>;

/**
 * The id taps are recorded against.
 *
 * A track, not a post: two reposts of one song are two search results but one piece of
 * music, and splitting their popularity between them would rank the song below itself.
 */
export function idOfEntity(result: SearchResult): string {
  switch (result.kind) {
    case 'track': return result.post.track.id;
    case 'user': return result.profile.id;
    case 'album': return result.album.id;
  }
}

/**
 * The best score across every name a result can legitimately be found by.
 *
 * A profile is findable by display name OR handle, and an album carries its uploader's handle
 * in the subtitle — so scoring only the primary name would rank an exact handle match below a
 * fuzzy title match, which is the opposite of what somebody typing a handle wants.
 */
function scoreOf(result: SearchResult, query: string): number {
  switch (result.kind) {
    case 'track':
      return scoreName(result.post.track.title, query);
    case 'user':
      return Math.max(
        scoreName(result.profile.displayName, query),
        scoreName(result.profile.username, query),
      );
    case 'album':
      return Math.max(
        scoreName(result.album.title, query),
        scoreName(result.album.uploaderUsername, query),
      );
  }
}

/**
 * Merge the three result sets into the single ordered list the screen renders.
 *
 * A tag-only query (`#gym`) scores every track the same, which is correct: nothing about how
 * well `gym` matches "Beat It" is meaningful, so the fallback ordering — service order,
 * newest first — is the honest one rather than an invented ranking.
 */
export function rankSearchResults({
  posts = [],
  profiles = [],
  albums = [],
  query,
  taps = {},
}: {
  posts?: FeedPost[];
  profiles?: ProfileSearchResult[];
  albums?: AlbumSearchResult[];
  query: string;
  /** Distinct-people-who-opened-it, by entity id. Absent is simply zero. */
  taps?: TapCounts;
}): SearchResult[] {
  const results: SearchResult[] = [
    ...posts.map((post): SearchResult => ({ kind: 'track', id: post.id, post })),
    ...profiles.map((profile): SearchResult => ({ kind: 'user', id: profile.id, profile })),
    ...albums.map((album): SearchResult => ({ kind: 'album', id: album.id, album })),
  ];

  // Decorated with the original index so the sort is stable across engines — Array#sort is
  // only guaranteed stable in modern JS, and relying on that for the tie-break would make
  // the list order an implementation detail of the runtime.
  return results
    .map((result, index) => ({
      result,
      index,
      score: scoreOf(result, query),
      popularity: popularityOf(result, taps),
    }))
    .sort(
      (a, b) =>
        // Match quality first, always. Popularity re-orders equally good matches; it never
        // promotes a worse one, or searching an exact title would surface a more popular
        // track that merely contains the word.
        b.score - a.score ||
        b.popularity - a.popularity ||
        KIND_WEIGHT[a.result.kind] - KIND_WEIGHT[b.result.kind] ||
        a.index - b.index,
    )
    .map(entry => entry.result);
}
