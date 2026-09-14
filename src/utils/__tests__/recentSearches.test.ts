/**
 * Recent searches.
 *
 * Small rules, but each one is visible on screen the moment it is wrong — a duplicate entry,
 * a list that grew to nine, a term that came back lowercased. None of them throw.
 */
import {
  MAX_RECENT_SEARCHES,
  addRecentSearch,
  removeRecentSearch,
  normalizeRecentSearches,
} from '../recentSearches';

describe('addRecentSearch', () => {
  it('puts the newest first', () => {
    expect(addRecentSearch(['a'], 'b')).toEqual(['b', 'a']);
  });

  it('caps the list', () => {
    const full = ['4', '3', '2', '1'];
    expect(addRecentSearch(full, '5')).toEqual(['5', '4', '3', '2']);
    expect(addRecentSearch(full, '5')).toHaveLength(MAX_RECENT_SEARCHES);
  });

  it('moves a repeated search to the top instead of duplicating it', () => {
    expect(addRecentSearch(['b', 'a'], 'a')).toEqual(['a', 'b']);
  });

  it('treats different casing and stray spaces as the same search', () => {
    expect(addRecentSearch(['vvk'], '  VVK ')).toEqual(['VVK']);
  });

  it('keeps the casing the person typed', () => {
    // Echoing back a lowercased term reads as the app correcting them.
    expect(addRecentSearch([], 'Pehle Bhi Main')).toEqual(['Pehle Bhi Main']);
  });

  it('ignores a blank term rather than spending a slot on it', () => {
    expect(addRecentSearch(['a'], '   ')).toEqual(['a']);
    expect(addRecentSearch(['a'], '')).toEqual(['a']);
  });

  it('does not mutate the list it was given', () => {
    const original = ['a'];
    addRecentSearch(original, 'b');
    expect(original).toEqual(['a']);
  });
});

describe('removeRecentSearch', () => {
  it('removes the matching term', () => {
    expect(removeRecentSearch(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('matches regardless of casing', () => {
    expect(removeRecentSearch(['Vvk'], 'vvk')).toEqual([]);
  });

  it('is a no-op for something not in the list', () => {
    expect(removeRecentSearch(['a'], 'z')).toEqual(['a']);
  });
});

describe('normalizeRecentSearches', () => {
  it('survives whatever storage hands back', () => {
    // An older build, a half-written value, a hand-edited device.
    expect(normalizeRecentSearches(null)).toEqual([]);
    expect(normalizeRecentSearches('not an array')).toEqual([]);
    expect(normalizeRecentSearches([1, null, undefined, 'ok'])).toEqual(['ok']);
  });

  it('drops blanks, collapses duplicates and re-applies the cap', () => {
    expect(normalizeRecentSearches(['a', ' ', 'A', 'b', 'c', 'd', 'e'])).toEqual([
      'a', 'b', 'c', 'd',
    ]);
  });
});
