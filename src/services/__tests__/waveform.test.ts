/**
 * Tests for waveform feature sampling — the visualizer's read path.
 *
 * WHY
 *
 * `sampleFeatures` is called at roughly 30 Hz while audio plays, and drives the floating
 * player's wave. Wrong output is user-visible (a wave that lags, jitters, or flatlines)
 * but never throws, so it is exactly the silent-failure shape this codebase keeps meeting.
 *
 * Two contracts matter enough to pin:
 *
 *   1. FLUX IS NOT INTERPOLATED. Loudness, bass and brightness are lerped for smoothness;
 *      flux is taken at the nearest bucket so onsets stay crisp for kick detection.
 *      Interpolating it would smear every kick — a subtle, plausible-looking change that
 *      degrades the feature it exists for.
 *
 *   2. V1 ROWS MUST STILL RENDER. Rows written before the v2 analyzer have `peaks` only.
 *      They must degrade to sensible defaults, not null, or older tracks lose their wave.
 *
 * `react-native-audio-api` is mocked: it is a native module, and these are the PURE
 * sampling helpers, not the decoder. Analysis itself needs a device (kb ADR-0003).
 */

jest.mock('react-native-audio-api', () => ({ decodeAudioData: jest.fn() }));
jest.mock('fft.js', () => jest.fn());

import {
  sampleFeatures,
  sampleEnvelope,
  WAVEFORM_VERSION,
  WAVEFORM_HZ,
  type WaveformData,
} from '../waveform';

/** A v2 row with one bucket per second, so position N indexes bucket N. */
function v2(over: Partial<WaveformData> = {}): WaveformData {
  return {
    version: WAVEFORM_VERSION,
    hz: 1,
    peaks: [0.3, 0.5, 1],
    bass: [0.1, 0.6, 0.9],
    flux: [0, 1, 0],
    centroid: [0.2, 0.4, 0.8],
    ...over,
  };
}

/** A v1 row: loudness only, as written before the v2 analyzer. */
function v1(): WaveformData {
  return { version: 1, hz: 1, peaks: [0.25, 0.75] };
}

describe('sampleFeatures — no usable data', () => {
  it.each([
    ['null data', null],
    ['empty peaks', { version: 2, hz: 1, peaks: [] } as WaveformData],
    ['zero hz', { version: 2, hz: 0, peaks: [0.5] } as WaveformData],
    ['negative hz', { version: 2, hz: -1, peaks: [0.5] } as WaveformData],
  ])('returns null for %s', (_label, data) => {
    // Null is the signal to fall back to the decorative wave. Throwing here would
    // take down the floating player on every frame.
    expect(sampleFeatures(data as WaveformData | null, 0)).toBeNull();
  });
});

describe('sampleFeatures — interpolation', () => {
  it('reads a bucket exactly at its position', () => {
    const f = sampleFeatures(v2(), 1)!;
    expect(f.loud).toBeCloseTo(0.5);
    expect(f.bass).toBeCloseTo(0.6);
    expect(f.centroid).toBeCloseTo(0.4);
  });

  it('interpolates loudness, bass and brightness between buckets', () => {
    // Halfway between bucket 0 and 1 → the midpoint of each channel.
    const f = sampleFeatures(v2(), 0.5)!;
    expect(f.loud).toBeCloseTo(0.4); // between 0.3 and 0.5
    expect(f.bass).toBeCloseTo(0.35); // between 0.1 and 0.6
    expect(f.centroid).toBeCloseTo(0.3); // between 0.2 and 0.4
  });

  it('does NOT interpolate flux — onsets must stay crisp', () => {
    // This is the contract. At 0.5 an interpolated flux would be 0.5; the correct
    // value is bucket 0's value, because a smeared onset stops reading as a kick.
    expect(sampleFeatures(v2(), 0.5)!.flux).toBe(0);
    expect(sampleFeatures(v2(), 0.99)!.flux).toBe(0);
    expect(sampleFeatures(v2(), 1)!.flux).toBe(1);
    expect(sampleFeatures(v2(), 1.99)!.flux).toBe(1);
  });
});

describe('sampleFeatures — bounds', () => {
  it('clamps a negative position to the start', () => {
    // The first bucket is deliberately non-zero: without the clamp, a negative index
    // resolves to `arr[i] ?? 0` and also returns 0, so a zero first bucket would make
    // this assertion pass either way. Mutation-testing found exactly that hole.
    expect(sampleFeatures(v2(), -5)!.loud).toBeCloseTo(0.3);
  });

  it('holds the last bucket past the end of the track', () => {
    // Position can exceed the analysed range: duration metadata drifts, and clipped
    // reposts index by absolute time. Reading past the end must not produce NaN.
    const f = sampleFeatures(v2(), 999)!;
    expect(f.loud).toBeCloseTo(1);
    expect(Number.isNaN(f.loud)).toBe(false);
    expect(Number.isNaN(f.bass)).toBe(false);
    expect(Number.isNaN(f.centroid)).toBe(false);
  });

  it('clamps out-of-range stored values into 0..1', () => {
    // The previous version of this test used only in-range fixtures, so the clamp was
    // never reached — all three clamp01 calls in the read path were deletable with the
    // suite green. waveform_peaks is jsonb written by a VERSIONED analyzer, so a v1 row
    // or a future analyzer change is exactly where an out-of-range value arrives.
    // Found by the code-reviewer.
    const dirty = v2({ peaks: [1.4, -0.2, 3], bass: [-1, 2, 0.5], flux: [5, -3, 0] });
    for (const pos of [0, 0.5, 1, 1.5, 2]) {
      const f = sampleFeatures(dirty, pos)!;
      for (const v of [f.loud, f.bass, f.flux, f.centroid]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps every channel within 0..1', () => {
    // The renderer maps these onto amplitude and speed; out-of-range values would
    // distort the wave rather than fail visibly.
    for (const pos of [-1, 0, 0.5, 1, 1.5, 2, 100]) {
      const f = sampleFeatures(v2(), pos)!;
      for (const v of [f.loud, f.bass, f.flux, f.centroid]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('sampleFeatures — v1 backward compatibility', () => {
  it('renders a v1 row rather than returning null', () => {
    // Older rows have peaks only. Returning null here would silently drop the synced
    // wave for every track analysed before v2.
    expect(sampleFeatures(v1(), 0)).not.toBeNull();
  });

  it('falls back to loudness for bass, and to neutral defaults for the rest', () => {
    const f = sampleFeatures(v1(), 0)!;
    expect(f.bass).toBeCloseTo(f.loud); // no bass channel → reuse loudness
    expect(f.flux).toBe(0); // no onset data → never punch
    expect(f.centroid).toBe(0.5); // neutral brightness → default scroll speed
  });
});

describe('sampleEnvelope', () => {
  it('returns just the loudness channel', () => {
    expect(sampleEnvelope(v2(), 1)).toBeCloseTo(sampleFeatures(v2(), 1)!.loud);
  });

  it('returns null when there is no usable data', () => {
    expect(sampleEnvelope(null, 0)).toBeNull();
  });
});

describe('analyzer constants', () => {
  it('pins the stored-row version and bucket rate', () => {
    // hz is the position→index contract: idx = floor(positionSec * hz). Changing it
    // without re-analysing makes every stored row index to the wrong time.
    // Bumping WAVEFORM_VERSION is what triggers re-analysis, so the two move together.
    expect(WAVEFORM_VERSION).toBe(2);
    expect(WAVEFORM_HZ).toBe(15);
  });
});
