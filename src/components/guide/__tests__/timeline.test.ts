import { kf } from '../timeline';
import { GUIDE_CARDS, PICK_DONE, cardsFor, lineFor } from '../cards';
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
  /** Every sentence a card can show, in either mode. */
  const copy = (c: (typeof GUIDE_CARDS)[number]) =>
    `${c.headline} ${lineFor(c, 'first')} ${lineFor(c, 'replay')} ${c.cta ?? ''}`;

  it('is six cards with unique keys: a welcome, four ideas and the pick step', () => {
    // The owner's text diet and redesign (2026-10-18): six short cards, not sixteen.
    expect(GUIDE_CARDS.map(c => c.key)).toEqual(['welcome', 'player', 'friends', 'star', 'pick', 'notify']);
    expect(GUIDE_CARDS[0].firstRunOnly).toBe(true);
    expect(GUIDE_CARDS[GUIDE_CARDS.length - 1].cta).toBeTruthy();
  });

  it('has exactly one interactive step — the pick — and an animation on every other card', () => {
    const interactive = GUIDE_CARDS.filter(c => c.interactive);
    expect(interactive.map(c => [c.key, c.interactive])).toEqual([['pick', 'pickThree']]);
    expect(interactive[0].Illustration).toBeUndefined();
    // The illustration modules are stubbed to {} here, so look at the field, not its value.
    GUIDE_CARDS.filter(c => !c.interactive).forEach(c => expect('Illustration' in c).toBe(true));
  });

  it('a replay drops the welcome and the pick step and keeps everything else in order', () => {
    expect(cardsFor('first')).toHaveLength(6);
    expect(cardsFor('replay').map(c => c.key)).toEqual(['player', 'friends', 'star', 'notify']);
  });

  it('a replay never mentions "your 3 songs" — someone replaying may never have picked them', () => {
    cardsFor('replay').forEach(c => expect(lineFor(c, 'replay')).not.toMatch(/\b3 songs\b/i));
    const notify = GUIDE_CARDS.find(c => c.key === 'notify')!;
    expect(lineFor(notify, 'first')).toBe(notify.line);
    expect(lineFor(notify, 'replay')).toBe(notify.replayLine);
  });

  it('every card has drift coverage, and every coverage entry is a card', () => {
    // scripts/check-guide-drift.mjs reads coverage.json in CI. A card without an
    // entry can go stale unnoticed; an entry without a card is a typo nobody sees.
    const covered = Object.keys(coverage).filter(k => !k.startsWith('$')).sort();
    expect(covered).toEqual(GUIDE_CARDS.map(c => c.key).sort());
  });

  it('never quotes a clip length — reposts are not limited to a fixed number of seconds', () => {
    [...GUIDE_CARDS.map(copy), `${PICK_DONE.headline} ${PICK_DONE.line}`].forEach(text => {
      expect(text).not.toMatch(/\b\d+\s*(s|sec|seconds)\b/i);
    });
  });

  it('never promises listening outside the app — a shared link shows the song, it does not play', () => {
    // The share page is metadata plus "Listen on Livil" (web/api/share.ts); playback needs
    // an account, and shared_post_public withholds the media URLs (20261023000000).
    GUIDE_CARDS.forEach(c => {
      expect(copy(c)).not.toMatch(/without (the|an?) (app|account)|no app/i);
    });
  });

  it('never names Spotify — the pick step offers Spotify songs only while its switch is on', () => {
    // Spotify reposts sit behind a server switch (ADR-0027). The pick step shows its
    // "On Spotify" section only while the switch is on; the copy must not promise it.
    GUIDE_CARDS.forEach(c => expect(copy(c)).not.toMatch(/spotify/i));
  });
});
