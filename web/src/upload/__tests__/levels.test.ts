/**
 * The loudness verdict.
 *
 * This is the half of the meter that makes a claim rather than showing a number, so it is
 * the half worth pinning. Two failures in particular are silent:
 *   - reading the PEAK instead of the integrated average, which passes a quiet master that
 *     happens to have one loud transient;
 *   - announcing a verdict before enough audio has played, which puts "Quiet" on screen
 *     during the fade-in of a perfectly normal track.
 */
import { fractionForDb } from '../../components/LevelMeter';
import { FLOOR_DB, HOT_DB, LOUD_DB, NORMAL_DB, verdictFor, type Levels } from '../levels';

const levels = (over: Partial<Levels> = {}): Levels => ({
  peakL: -6,
  peakR: -6,
  rmsL: -18,
  rmsR: -18,
  rms: -18,
  hold: -6,
  average: -16,
  clipped: false,
  settled: true,
  ...over,
});

describe('verdictFor', () => {
  it('calls a normal master normal', () => {
    expect(verdictFor(levels({ average: -16 })).key).toBe('normal');
  });

  it('reads the average, not the peak — a quiet mix with one hot transient is still quiet', () => {
    expect(verdictFor(levels({ average: -30, peakL: -0.5, hold: -0.5 })).key).toBe('low');
  });

  it('flags a master that is louder than the field', () => {
    expect(verdictFor(levels({ average: -6 })).key).toBe('loud');
  });

  it('clipping outranks everything, including a perfectly normal average', () => {
    expect(verdictFor(levels({ average: -16, clipped: true })).key).toBe('clipping');
  });

  it('says nothing until the reading has settled', () => {
    // The average is deep in "quiet" territory, but two frames in it means nothing.
    const early = verdictFor(levels({ average: FLOOR_DB, settled: false }));
    expect(early.key).toBe('normal');
    expect(early.title).toBe('Listening…');
  });

  it('still reports clipping before it has settled — that one cannot wait', () => {
    expect(verdictFor(levels({ settled: false, clipped: true })).key).toBe('clipping');
  });

  it('agrees with the boundaries the ladder draws its bands at', () => {
    expect(verdictFor(levels({ average: LOUD_DB + 0.1 })).key).toBe('loud');
    expect(verdictFor(levels({ average: NORMAL_DB - 0.1 })).key).toBe('low');
  });

  it('holds the boundaries where the meter draws them', () => {
    expect(verdictFor(levels({ average: -22 })).key).toBe('normal');
    expect(verdictFor(levels({ average: -22.1 })).key).toBe('low');
    expect(verdictFor(levels({ average: -10 })).key).toBe('normal');
    expect(verdictFor(levels({ average: -9.9 })).key).toBe('loud');
  });
});

/**
 * The ladder's scale. It is expanded at the loud end deliberately: on a linear -60…0 scale
 * every mastered track sits pinned near the top and the meter answers nothing, which is the
 * bug this mapping exists to fix. So what is pinned here is the EXPANSION, not the curve.
 */
describe('fractionForDb', () => {
  it('pins the ends', () => {
    expect(fractionForDb(0)).toBe(1);
    expect(fractionForDb(FLOOR_DB)).toBe(0);
    expect(fractionForDb(-200)).toBe(0);
    expect(fractionForDb(6)).toBe(1);
  });

  it('rises monotonically', () => {
    let previous = -1;
    for (let db = -60; db <= 0; db += 0.5) {
      const f = fractionForDb(db);
      expect(f).toBeGreaterThanOrEqual(previous);
      previous = f;
    }
  });

  it('gives the loud end most of the ladder', () => {
    // The band an artist is actually deciding within — quiet, right, too hot — must own the
    // majority of the pixels, or the fix is cosmetic.
    expect(fractionForDb(0) - fractionForDb(-24)).toBeGreaterThan(0.6);
    // And the basement keeps enough to show that signal exists at all.
    expect(fractionForDb(-40)).toBeGreaterThan(0.1);
  });

  it('separates a quiet master from a loud one by a readable distance', () => {
    // -28 dB RMS vs -8 dB RMS was ~13% of the ladder apart on the old linear scale.
    expect(fractionForDb(-8) - fractionForDb(-28)).toBeGreaterThan(0.4);
  });

  it('keeps the three band boundaries in order and inside the ladder', () => {
    expect(fractionForDb(NORMAL_DB)).toBeLessThan(fractionForDb(LOUD_DB));
    expect(fractionForDb(LOUD_DB)).toBeLessThan(fractionForDb(HOT_DB));
    expect(fractionForDb(HOT_DB)).toBeLessThan(1);
  });
});
