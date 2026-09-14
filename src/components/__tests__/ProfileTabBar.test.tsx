/**
 * Which profile tabs appear, and in what order.
 *
 * Two rules that pull in different directions, which is why this is worth pinning:
 * VISIBILITY is fixed (Reposts and Playlists always show; Uploads and Albums only when
 * they have something), while ORDER is by weight — whichever of Reposts and Uploads holds
 * more leads. Getting the interaction wrong is silent: the bar still renders, it just
 * shows the wrong thing first, or drops a tab nobody notices is missing.
 */
import { visibleTabsFor, type TabCounts } from '../ProfileTabBar';

const counts = (over: Partial<TabCounts> = {}): TabCounts => ({
  reposts: 0,
  uploads: 0,
  albums: 0,
  playlists: 0,
  ...over,
});

const keys = (c: TabCounts) => visibleTabsFor(c).map(t => t.key);

describe('visibleTabsFor — visibility', () => {
  it('always shows Reposts and Playlists, even at zero', () => {
    expect(keys(counts())).toEqual(['reposts', 'playlists']);
  });

  it('shows Uploads and Albums only once they hold something', () => {
    expect(keys(counts({ uploads: 1 }))).toContain('uploads');
    expect(keys(counts({ albums: 1 }))).toContain('albums');
    expect(keys(counts())).not.toContain('uploads');
    expect(keys(counts())).not.toContain('albums');
  });
});

describe('visibleTabsFor — order follows the counts', () => {
  it('leads with Uploads for an artist', () => {
    expect(keys(counts({ uploads: 12, reposts: 2 }))[0]).toBe('uploads');
  });

  it('leads with Reposts for a curator', () => {
    expect(keys(counts({ uploads: 2, reposts: 12 }))[0]).toBe('reposts');
  });

  it('keeps the declared order on a tie, so the bar does not jitter', () => {
    expect(keys(counts({ uploads: 5, reposts: 5 }))).toEqual([
      'reposts',
      'uploads',
      'playlists',
    ]);
  });

  it('leaves Albums and Playlists where they are, whatever the weights', () => {
    // They are collections rather than activity — moving them makes the bar unlearnable.
    const artist = keys(counts({ uploads: 99, reposts: 1, albums: 3, playlists: 40 }));
    expect(artist).toEqual(['uploads', 'reposts', 'albums', 'playlists']);
  });

  it('does not lose or duplicate a tab while reordering', () => {
    const c = counts({ uploads: 7, reposts: 3, albums: 2, playlists: 1 });
    const result = keys(c);
    expect(new Set(result).size).toBe(result.length);
    expect(result).toHaveLength(visibleTabsFor(c).length);
    expect(result.sort()).toEqual(['albums', 'playlists', 'reposts', 'uploads']);
  });

  it('reorders correctly when Uploads is the only weighted tab visible', () => {
    // Reposts is always visible, so this is really "uploads present, reposts empty".
    expect(keys(counts({ uploads: 4 }))).toEqual(['uploads', 'reposts', 'playlists']);
  });
});
