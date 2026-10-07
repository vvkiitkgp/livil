/**
 * Songs recently opened from Search — ids only, newest first, capped, de-duplicated.
 */
import {
  MAX_RECENT_SEARCH_TRACKS,
  addRecentSearchTrack,
  normalizeRecentSearchTracks,
} from '../recentSearchTracks';

describe('addRecentSearchTrack', () => {
  it('puts the newest first', () => {
    expect(addRecentSearchTrack(['a'], 'b')).toEqual(['b', 'a']);
  });

  it('caps the list at five', () => {
    const full = ['5', '4', '3', '2', '1'];
    expect(addRecentSearchTrack(full, '6')).toEqual(['6', '5', '4', '3', '2']);
    expect(MAX_RECENT_SEARCH_TRACKS).toBe(5);
  });

  it('moves a replayed song to the top instead of listing it twice', () => {
    expect(addRecentSearchTrack(['b', 'a'], 'a')).toEqual(['a', 'b']);
  });

  it('ignores an empty id', () => {
    expect(addRecentSearchTrack(['a'], '')).toEqual(['a']);
  });

  it('does not mutate its input', () => {
    const before = ['a'];
    addRecentSearchTrack(before, 'b');
    expect(before).toEqual(['a']);
  });
});

describe('normalizeRecentSearchTracks', () => {
  it('returns [] for anything that is not an array', () => {
    expect(normalizeRecentSearchTracks(null)).toEqual([]);
    expect(normalizeRecentSearchTracks('a')).toEqual([]);
    expect(normalizeRecentSearchTracks({ 0: 'a' })).toEqual([]);
  });

  it('drops non-strings, blanks and duplicates, and re-applies the cap', () => {
    expect(normalizeRecentSearchTracks(['a', 1, '', 'a', null, 'b', 'c', 'd', 'e', 'f']))
      .toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
