import { amplitudeBars } from '../WaveformScrubber';

/**
 * The bars under the clip are the real audio now, so a mistake here is a wave that
 * describes the wrong part of the song — which looks plausible and is wrong.
 */

/** 60 seconds at 10 buckets/sec: silent first half, loud second half. */
const HZ = 10;
const PEAKS = Array.from({ length: 600 }, (_, i) => (i < 300 ? 0.1 : 0.8));

describe('amplitudeBars', () => {
  it('returns exactly the bars asked for', () => {
    expect(amplitudeBars(0, 60, 32, PEAKS, HZ)).toHaveLength(32);
  });

  it('puts the loud half on the right', () => {
    const bars = amplitudeBars(0, 60, 32, PEAKS, HZ);
    const left = bars.slice(0, 16).reduce((a, b) => a + b, 0) / 16;
    const right = bars.slice(16).reduce((a, b) => a + b, 0) / 16;
    expect(right).toBeGreaterThan(left);
  });

  it('reads only the window it was given', () => {
    // The quiet half alone. Normalisation makes it full-height — that is the point:
    // a zoomed view shows the shape of what is on screen, not how it compares to the
    // chorus. Uniform input must come back uniform.
    const quiet = amplitudeBars(0, 30, 16, PEAKS, HZ);
    expect(Math.max(...quiet)).toBeCloseTo(1, 5);
    expect(Math.min(...quiet)).toBeCloseTo(1, 5);
  });

  it('AVERAGES a bar’s slice rather than point-sampling one bucket', () => {
    // One spike inside an otherwise flat second. Point-sampling would either miss it
    // entirely or draw a full-height bar; averaging must land between the two.
    const spiky = Array.from({ length: 100 }, (_, i) => (i === 5 ? 1 : 0.2));
    const [bar] = amplitudeBars(0, 1, 1, spiky, 10);
    expect(bar).toBeCloseTo(1, 5); // single bar normalises to itself
    const two = amplitudeBars(0, 2, 2, spiky, 10);
    // First bar holds the spike, so it must exceed the flat second.
    expect(two[0]!).toBeGreaterThan(two[1]!);
  });

  it('does not read past the end of the envelope', () => {
    // A window longer than the data must not produce NaN — a NaN bar height renders
    // nothing and takes the whole SVG down with it.
    const bars = amplitudeBars(0, 600, 24, PEAKS, HZ);
    expect(bars.every(v => Number.isFinite(v))).toBe(true);
  });

  it('survives an all-silent envelope without dividing by zero', () => {
    const silent = new Array(100).fill(0);
    const bars = amplitudeBars(0, 10, 8, silent, 10);
    expect(bars.every(v => v === 0)).toBe(true);
  });
});
