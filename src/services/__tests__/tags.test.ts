/**
 * Tag normalization.
 *
 * Worth pinning because every failure here is silent and looks like an empty search. The
 * writer and the reader both go through `normalizeTag` — the upload screens to store, and
 * `searchPosts` to build its query — so a change that shifts the output shifts BOTH sides
 * for new data while leaving every already-stored tag behind. Nothing errors; the track is
 * simply no longer found by the word it was filed under.
 *
 * The database constraint is deliberately looser (see `20260807000000_track_tags.sql`), so
 * these tests are the only thing asserting the strict shape.
 */
import {
  EMOTION_TAGS,
  MAX_TAGS_PER_TRACK,
  TAG_MAX_LENGTH,
  addTags,
  formatTag,
  mergeTags,
  normalizeTag,
  normalizeTags,
  parseTagInput,
  validateTags,
} from '../../../shared/constants/tags';

describe('normalizeTag', () => {
  it('lowercases, so the writer and the search box agree', () => {
    expect(normalizeTag('LoFi')).toBe('lofi');
  });

  it('strips the hash people type because the feature is called hashtags', () => {
    expect(normalizeTag('#lofi')).toBe('lofi');
    expect(normalizeTag('##lofi')).toBe('lofi');
  });

  it('joins words with an underscore rather than dropping the joint', () => {
    // `lo_fi` stays distinguishable from `lofi`, which an artist may consider different.
    expect(normalizeTag('lo-fi')).toBe('lo_fi');
    expect(normalizeTag('late night')).toBe('late_night');
  });

  it('collapses runs left behind by dropped characters', () => {
    // Two people typing the same thing must not store different rows.
    expect(normalizeTag('rock // roll')).toBe('rock_roll');
    expect(normalizeTag('__lofi__')).toBe('lofi');
  });

  it('keeps non-Latin scripts — the app is not English-only', () => {
    expect(normalizeTag('बॉलीवुड')).toBe('बॉलीवुड');
    expect(normalizeTag('シティポップ')).toBe('シティポップ');
  });

  it('rejects what is left of a tag made only of punctuation', () => {
    expect(normalizeTag('!!!')).toBeNull();
    expect(normalizeTag('#')).toBeNull();
    expect(normalizeTag('   ')).toBeNull();
  });

  it('rejects a single character but keeps two', () => {
    expect(normalizeTag('a')).toBeNull();
    expect(normalizeTag('uk')).toBe('uk');
  });

  it('truncates rather than rejecting an over-long tag', () => {
    // An error about a limit nobody knew existed, for a tag that is fine at thirty
    // characters, is worse than quietly shortening it.
    expect(normalizeTag('a'.repeat(40))).toBe('a'.repeat(TAG_MAX_LENGTH));
  });

  it('is idempotent — publishing re-normalizes what the UI already normalized', () => {
    const once = normalizeTag('#Late Night!')!;
    expect(normalizeTag(once)).toBe(once);
  });
});

describe('normalizeTags', () => {
  it('drops empties and duplicates while keeping the typed order', () => {
    expect(normalizeTags(['#LoFi', 'lofi', '!!', 'Late Night'])).toEqual(['lofi', 'late_night']);
  });
});

describe('parseTagInput', () => {
  it('splits on whitespace and commas, the way hashtags are typed', () => {
    expect(parseTagInput('lofi, #latenight tabla')).toEqual(['lofi', 'latenight', 'tabla']);
  });
});

describe('addTags', () => {
  it('adds a normalized tag', () => {
    expect(addTags([], '#LoFi')).toEqual({ tags: ['lofi'], error: null });
  });

  it('says so when a tag is already there', () => {
    // A silently ignored Enter reads as a broken field.
    expect(addTags(['lofi'], 'LoFi')).toEqual({
      tags: ['lofi'],
      error: 'That tag is already on this track.',
    });
  });

  it('treats a repeat alongside a new tag as a success, not an error', () => {
    expect(addTags(['lofi'], 'lofi chill')).toEqual({ tags: ['lofi', 'chill'], error: null });
  });

  it('stops at the cap and explains why', () => {
    const full = Array.from({ length: MAX_TAGS_PER_TRACK }, (_, i) => `tag${i}`);
    const result = addTags(full, 'onemore');
    expect(result.tags).toHaveLength(MAX_TAGS_PER_TRACK);
    expect(result.error).toBe(`Up to ${MAX_TAGS_PER_TRACK} tags per track.`);
  });

  it('does nothing, quietly, when there is nothing to add', () => {
    // The normal state of a field somebody is still typing into.
    expect(addTags(['lofi'], '  ')).toEqual({ tags: ['lofi'], error: null });
  });
});

describe('mergeTags', () => {
  it('appends without disturbing what a row already carries', () => {
    // "Tags for all" must not throw away a tag set on one row individually.
    expect(mergeTags(['own'], ['batch', 'own'])).toEqual(['own', 'batch']);
  });

  it('caps silently — one error per row for a single batch action is noise', () => {
    const full = Array.from({ length: MAX_TAGS_PER_TRACK }, (_, i) => `tag${i}`);
    expect(mergeTags(full, ['extra'])).toEqual(full);
  });
});

describe('validateTags', () => {
  it('passes a normalized list', () => {
    expect(validateTags(['lofi', 'late_night'])).toBeNull();
  });

  it('catches what the database would reject, before anything uploads', () => {
    expect(validateTags(['LoFi'])).toMatch(/not a usable tag/);
    expect(validateTags(['lofi', 'lofi'])).toMatch(/same tag twice/);
    expect(
      validateTags(Array.from({ length: MAX_TAGS_PER_TRACK + 1 }, (_, i) => `tag${i}`)),
    ).toMatch(/Up to 20/);
  });
});

describe('EMOTION_TAGS', () => {
  // Pre-applied to every new upload, so any of these that is not already in stored form
  // would be silently rewritten on the way to the database — and the rewritten value is
  // what search would then have to match. Cheap to assert, invisible if it breaks.
  it('is already normalized, since it is written without passing through a field', () => {
    for (const tag of EMOTION_TAGS) {
      expect(normalizeTag(tag)).toBe(tag);
    }
  });

  it('has no duplicates', () => {
    expect(new Set(EMOTION_TAGS).size).toBe(EMOTION_TAGS.length);
  });

  it('validates as a list a track could be published with', () => {
    expect(validateTags([...EMOTION_TAGS])).toBeNull();
  });

  it('leaves room for the artist to add tags of their own', () => {
    // The whole seed being the cap would mean a field that opens full: the artist could
    // remove but never add, which is not what the pruning is for.
    expect(EMOTION_TAGS.length).toBeLessThan(MAX_TAGS_PER_TRACK);
  });

  it('lets a pre-applied track still take a typed tag', () => {
    const result = addTags([...EMOTION_TAGS], 'qawwali');
    expect(result.error).toBeNull();
    expect(result.tags).toContain('qawwali');
  });
});

describe('formatTag', () => {
  it('shows the hash it does not store', () => {
    expect(formatTag('lofi')).toBe('#lofi');
  });
});
