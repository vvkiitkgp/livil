/**
 * Songs and albums recently opened from Search — ids only, newest first, capped, de-duplicated.
 */
import {
  MAX_RECENT_SEARCH_OPENS,
  addRecentSearchOpen,
  normalizeRecentSearchOpens,
  type RecentSearchOpen,
} from '../recentSearchOpens';

const t = (id: string): RecentSearchOpen => ({ kind: 'track', id });
const a = (id: string): RecentSearchOpen => ({ kind: 'album', id });

describe('addRecentSearchOpen', () => {
  it('puts the newest first, songs and albums in one list', () => {
    expect(addRecentSearchOpen([t('1')], a('9'))).toEqual([a('9'), t('1')]);
  });

  it('caps songs and albums together at five', () => {
    const full = [t('5'), a('4'), t('3'), a('2'), t('1')];
    expect(addRecentSearchOpen(full, t('6'))).toEqual([t('6'), t('5'), a('4'), t('3'), a('2')]);
    expect(MAX_RECENT_SEARCH_OPENS).toBe(5);
  });

  it('moves a reopened item to the top instead of listing it twice', () => {
    expect(addRecentSearchOpen([t('2'), a('1')], a('1'))).toEqual([a('1'), t('2')]);
  });

  it('treats a song and an album with the same id as different items', () => {
    expect(addRecentSearchOpen([t('1')], a('1'))).toEqual([a('1'), t('1')]);
  });

  it('ignores an empty id and does not mutate its input', () => {
    const before = [t('1')];
    expect(addRecentSearchOpen(before, t(''))).toEqual([t('1')]);
    addRecentSearchOpen(before, t('2'));
    expect(before).toEqual([t('1')]);
  });
});

describe('normalizeRecentSearchOpens', () => {
  it('returns [] for anything that is not an array', () => {
    expect(normalizeRecentSearchOpens(null)).toEqual([]);
    expect(normalizeRecentSearchOpens('a')).toEqual([]);
  });

  it('reads the songs-only format (bare post ids) as songs', () => {
    expect(normalizeRecentSearchOpens(['p1', 'p2'])).toEqual([t('p1'), t('p2')]);
  });

  it('drops malformed entries and duplicates, and re-applies the cap', () => {
    expect(normalizeRecentSearchOpens([
      t('1'), { kind: 'playlist', id: 'x' }, { kind: 'album' }, '', 1, null, t('1'),
      a('2'), t('3'), a('4'), t('5'), a('6'),
    ])).toEqual([t('1'), a('2'), t('3'), a('4'), t('5')]);
  });
});
