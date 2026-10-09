import { kf } from '../timeline';
import { GUIDE_CARDS, cardsFor, lineFor } from '../cards';
import coverage from '../coverage.json';

// `kf` is plain arithmetic; only `useLoop` touches Reanimated, and importing the real
// module (or even its own Jest mock) loads the native worklet runtime. Stub the names
// timeline.ts imports so the module evaluates.
jest.mock('react-native-reanimated', () => ({
  cancelAnimation: jest.fn(),
  Easing: { linear: (x: number) => x },
  useSharedValue: jest.fn(),
  withRepeat: jest.fn(),
  withTiming: jest.fn(),
}));
// The card modules pull in RN components; the test only needs the data and the pure
// lookup, so the illustrations are stubbed out.
jest.mock('../cardsPlayer', () => ({}));
jest.mock('../cardsFeed', () => ({}));
jest.mock('../cardsPeople', () => ({}));
jest.mock('../cardWelcome', () => ({}));

describe('kf — keyframe lookup', () => {
  it('holds the first value before the first stop and the last after the last', () => {
    const stops: [number, number][] = [[20, 0], [40, 1]];
    expect(kf(0, stops)).toBe(0);
    expect(kf(0.1, stops)).toBe(0);
    expect(kf(0.5, stops)).toBe(1);
    expect(kf(1, stops)).toBe(1);
  });

  it('interpolates linearly between stops', () => {
    const stops: [number, number][] = [[0, 0], [50, 100]];
    expect(kf(0.25, stops)).toBeCloseTo(50);
  });

  it('a hold written as two stops with the same value is flat, not NaN', () => {
    const stops: [number, number][] = [[0, 14], [12, 14], [20, 0]];
    expect(kf(0.06, stops)).toBe(14);
    expect(kf(0.16, stops)).toBeCloseTo(7);
    expect(Number.isNaN(kf(0.12, stops))).toBe(false);
  });

  it('a repeated percentage is a hard cut, never NaN', () => {
    const stops: [number, number][] = [[0, 0], [50, 0], [50, 1], [100, 1]];
    expect(kf(0.49, stops)).toBe(0);
    expect(kf(0.51, stops)).toBe(1);
    expect(Number.isNaN(kf(0.5, stops))).toBe(false);
  });
});

describe('GUIDE_CARDS', () => {
  it('is a welcome card plus fifteen feature cards, with unique keys', () => {
    expect(GUIDE_CARDS).toHaveLength(16);
    expect(new Set(GUIDE_CARDS.map(c => c.key)).size).toBe(16);
    expect(GUIDE_CARDS[0].firstRunOnly).toBe(true);
    expect(GUIDE_CARDS[GUIDE_CARDS.length - 1].cta).toBeTruthy();
  });

  it('a replay skips the welcome and keeps everything else in order', () => {
    expect(cardsFor('first')).toHaveLength(16);
    const replay = cardsFor('replay');
    expect(replay).toHaveLength(15);
    expect(replay[0].key).toBe('tap');
    expect(replay.map(c => c.key)).toEqual(GUIDE_CARDS.slice(1).map(c => c.key));
  });

  it('every card has drift coverage, and every coverage entry is a card', () => {
    // scripts/check-guide-drift.mjs reads coverage.json in CI. A card without an
    // entry can go stale unnoticed; an entry without a card is a typo nobody sees.
    const covered = Object.keys(coverage).filter(k => !k.startsWith('$')).sort();
    expect(covered).toEqual(GUIDE_CARDS.map(c => c.key).sort());
  });

  it('never quotes a clip length — reposts are not limited to a fixed number of seconds', () => {
    GUIDE_CARDS.forEach(c => {
      expect(`${c.headline} ${c.line} ${c.spotifyLine ?? ''}`).not.toMatch(/\b\d+\s*(s|sec|seconds)\b/i);
    });
  });

  it('promises Spotify reposts only while the server switch is on', () => {
    // Spotify reposts sit behind a server switch (ADR-0027). Someone who sees the guide
    // while it is off must not be told about a button they cannot find.
    GUIDE_CARDS.forEach(c => {
      expect(`${c.headline} ${lineFor(c, { spotifyReposts: false })}`).not.toMatch(/spotify/i);
    });
    const repost = GUIDE_CARDS.find(c => c.key === 'repost')!;
    expect(lineFor(repost, { spotifyReposts: true }))
      .toBe(`${repost.line} Found it on Spotify? Repost that too.`);
  });
});
