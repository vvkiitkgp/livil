/**
 * Track tags — what a tag IS, decided once for both clients and the database.
 *
 * A tag is only worth having if two people who mean the same thing produce the same string.
 * "Lo-Fi", "lofi" and "#LoFi " are one tag to a human and three rows to a `text[]`, and no
 * search can tell they were meant to be one — the same drift `roles.ts` exists to prevent
 * for credits, except tags are typed freely by everyone rather than picked from a list, so
 * it happens immediately rather than eventually.
 *
 * So normalization lives HERE, not in either upload screen. The web queue and the mobile
 * upload screen both call `normalizeTag`, and `searchPosts` normalizes the query through the
 * same function before matching — which is the part that actually matters. A search box that
 * normalizes differently from the writer cannot find what the writer stored, and that failure
 * is silent: the tag is on the track, the query looks right, the result list is just empty.
 *
 * Kept import-free like `roles.ts`: plain strings and types only, so Vite takes it directly
 * and Metro resolves it by relative path.
 *
 * ── The layering with the database ──────────────────────────────────────────────
 *
 * The check constraint in `20260807000000_track_tags.sql` is deliberately LOOSER than this
 * module. It enforces only the invariants search depends on — lowercase, no whitespace,
 * bounded length and count, no duplicates — and lets anything else through. That asymmetry
 * is on purpose: a database stricter than the client would reject a publish AFTER the master
 * has uploaded, and the artist would learn that their tag was unacceptable by watching a
 * 200 MB upload roll back. This module decides the nice shape; the constraint is the backstop
 * for anything that reaches the table without passing through it.
 */

/** Shorter than two characters is not a tag, it is a keystroke. */
export const TAG_MIN_LENGTH = 2;

/** Mirrors `track_tags_ok` in the migration. */
export const TAG_MAX_LENGTH = 30;

/**
 * How many tags one track may carry.
 *
 * A cap rather than no cap because tags are a discovery surface, and an uncapped one is a
 * keyword-stuffing surface — a hundred tags on a track is not description, it is an attempt
 * to appear in a hundred searches.
 *
 * Twenty, with `EMOTION_TAGS` pre-applied taking half of it. That ratio is the reason the
 * number is not smaller: an artist who prunes the emotions down to two still has room for a
 * genre, a language, a mood and a scene without meeting a limit they did not cause.
 */
export const MAX_TAGS_PER_TRACK = 20;

/**
 * The emotion tags every new upload starts with.
 *
 * PRE-APPLIED, not suggested — a new upload carries all of these until the artist removes
 * the ones that do not fit. Product decision, made deliberately with its cost understood:
 * the point is that an artist cannot upload without SEEING that emotion is a thing this
 * platform files music by, and a row of chips that must be pruned achieves that where an
 * empty field with a hint does not.
 *
 * The cost, recorded here so whoever reads this later does not have to rediscover it: a
 * track whose artist ignored the field carries every emotion at once, and nothing in the
 * data distinguishes that from a deliberate choice. Any consumer of these tags — the
 * suggestion engine this exists to feed, above all — has to treat "carries most of
 * EMOTION_TAGS" as ABSENCE of signal rather than as a song that is somehow all of them.
 * That check is cheap and this list is what makes it possible; nothing else needs to change.
 *
 * Not a closed vocabulary. Tags can be emotions, and most tags are not — an artist typing
 * `qawwali` or `2am` is using the same field, and these are simply the ten that arrive
 * already typed. 'gym' and 'focus' are listening CONTEXTS rather than feelings, and they
 * are here for the same reason a listener reaches for them: what a song is for is as
 * strong a signal as what it feels like.
 *
 * Deliberately ten. Longer means more pruning per upload, which is the work that has to
 * stay small for any of this to survive contact with a twelve-track album.
 */
export const EMOTION_TAGS: readonly string[] = [
  'happy',
  'sad',
  'love',
  'heartbreak',
  'chill',
  'motivation',
  'gym',
  'party',
  'focus',
  'angry',
];

/**
 * Characters that end a tag when someone is typing a list.
 *
 * Space is included, which is what makes "lofi chill beats" become three tags rather than
 * one — the way people actually type hashtags. A tag can never contain a space (see
 * `normalizeTag`), so nothing is lost by treating it as a separator.
 */
const SEPARATORS = /[\s,;]+/;

/**
 * Word-joining characters that become an underscore rather than being dropped.
 *
 * "lo-fi" and "lo fi" are one tag with a joint in it, so they normalize to `lo_fi` and stay
 * distinguishable from `lofi`. Dropping the joint instead would silently merge two tags an
 * artist may well consider different.
 */
const JOINERS = /[\s\-–—.]+/g;

/**
 * Everything a tag may contain.
 *
 * Unicode letters, numbers and COMBINING MARKS — not `[a-z0-9]`. Livil's first audience is
 * in India and the app is not English-only: restricting tags to ASCII would mean a Hindi or
 * Tamil or Japanese tag normalizes to the empty string and disappears at upload, the kind of
 * exclusion that ships because nobody in the room typed a non-Latin tag.
 *
 * `\p{M}` is the part that is easy to miss, and leaving it out is worse than the ASCII rule
 * rather than better: Indic vowel signs are Marks, not Letters, so `\p{L}\p{N}` alone turns
 * बॉलीवुड into बलवड — a real word quietly rewritten into a non-word, with no error and
 * nothing on screen to notice. Caught by a test, which is the only way it would have been.
 *
 * Zero-width joiners are deliberately NOT included. They are invisible, so allowing them
 * would let two tags that look identical be different rows, and a tag nobody can retype
 * exactly is not a search key.
 */
const DISALLOWED = /[^\p{L}\p{N}\p{M}_]/gu;

/**
 * Turn whatever was typed into a storable tag, or null if nothing survives.
 *
 * Null rather than throwing: this runs on every keystroke-ish input event in two upload
 * UIs, and "not a tag yet" is the normal state of a field someone is still typing into.
 */
export function normalizeTag(raw: string): string | null {
  const tag = raw
    .trim()
    // Leading hashes are stripped rather than rejected. People type the '#' because that is
    // what the feature is called; storing it would put it in every LIKE pattern and every
    // array literal for no gain.
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(JOINERS, '_')
    .replace(DISALLOWED, '')
    // Collapse runs left behind by dropped characters, so "rock // roll" is `rock_roll` and
    // not `rock__roll` — otherwise two people typing the same thing store different rows.
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');

  if (tag.length < TAG_MIN_LENGTH) return null;
  // Truncate rather than reject. The alternative is an error message about a limit the
  // artist did not know existed, for a tag that is fine at thirty characters.
  return tag.length > TAG_MAX_LENGTH ? tag.slice(0, TAG_MAX_LENGTH) : tag;
}

/**
 * Normalize a whole list, dropping empties and duplicates while preserving order.
 *
 * Order is preserved because it is the order the artist typed, and tags render in that
 * order — sorting them would reorder somebody's list under them for no reason.
 */
export function normalizeTags(raws: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of raws) {
    const tag = normalizeTag(raw);
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

/**
 * Split typed text into tags — "lofi, #late night" → ['lofi', 'late', 'night'].
 *
 * Used for paste and for the commit key in both tag inputs, so pasting a list from a notes
 * app does the obvious thing instead of producing one long tag.
 */
export function parseTagInput(raw: string): string[] {
  return normalizeTags(raw.split(SEPARATORS));
}

/**
 * Add a tag to a list, returning the new list and why nothing changed when nothing did.
 *
 * Both upload UIs need exactly this, including the two "nothing happened" cases that need
 * an explanation on screen — a silently ignored Enter key reads as a broken field.
 */
export function addTags(
  existing: readonly string[],
  raw: string,
): { tags: string[]; error: string | null } {
  const incoming = parseTagInput(raw);
  if (incoming.length === 0) {
    return { tags: [...existing], error: null };
  }

  const tags = [...existing];
  let hitCap = false;
  let duplicate = false;

  for (const tag of incoming) {
    if (tags.includes(tag)) {
      duplicate = true;
      continue;
    }
    if (tags.length >= MAX_TAGS_PER_TRACK) {
      hitCap = true;
      break;
    }
    tags.push(tag);
  }

  if (hitCap) {
    return { tags, error: `Up to ${MAX_TAGS_PER_TRACK} tags per track.` };
  }
  // Only worth saying when nothing at all was added — one new tag alongside one repeat is a
  // successful action, not an error.
  if (duplicate && tags.length === existing.length) {
    return { tags, error: 'That tag is already on this track.' };
  }
  return { tags, error: null };
}

/**
 * Append tags to a list, keeping order, dropping duplicates, stopping at the cap.
 *
 * The batch case: "tag everything in the queue". Appends rather than replaces, for the same
 * reason `mergeCredits` does — a row may already carry a tag somebody set on it individually,
 * and overwriting would silently throw that away. Silently capped, because the alternative is
 * one error per row for a batch action the artist performed once.
 */
export function mergeTags(existing: readonly string[], incoming: readonly string[]): string[] {
  const tags = [...existing];
  for (const tag of normalizeTags(incoming)) {
    if (tags.length >= MAX_TAGS_PER_TRACK) break;
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/**
 * Check a list that is about to be written.
 *
 * Same contract as `publishTrack`'s other validators — a message to show, or null — and
 * called from the same place, BEFORE any bytes are uploaded. Every rule here is one the
 * database will also enforce, and learning about it from a constraint error means learning
 * about it after the master has already gone up and been rolled back.
 */
export function validateTags(tags: readonly string[]): string | null {
  if (tags.length > MAX_TAGS_PER_TRACK) {
    return `Up to ${MAX_TAGS_PER_TRACK} tags per track.`;
  }
  for (const tag of tags) {
    if (normalizeTag(tag) !== tag) {
      return `"${tag}" is not a usable tag.`;
    }
  }
  if (new Set(tags).size !== tags.length) {
    return 'That track has the same tag twice.';
  }
  return null;
}

/** How a tag is shown. Stored bare, displayed with the '#' people expect. */
export const formatTag = (tag: string): string => `#${tag}`;
