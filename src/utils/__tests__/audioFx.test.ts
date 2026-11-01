import {
  compensateLatency,
  anyFx,
  DEFAULT_FX,
  HEADROOM,
  pitchLabel,
  SAFETY_CEILING,
  reverbImpulse,
  reverbSeconds,
  softLimitCurve,
} from '../audioFx/effects';
import { clampRange, snapToStep } from '../../screens/studio/timeline';

const SR = 48000;

describe('pitch', () => {
  it('labels semitones the way the slider shows them', () => {
    expect(pitchLabel(0)).toBe('As sung');
    expect(pitchLabel(3)).toBe('+3 semitones');
    expect(pitchLabel(-1)).toBe('−1 semitone');
  });
});

describe('reverb', () => {
  it('a bigger room rings longer', () => {
    expect(reverbSeconds(1)).toBeGreaterThan(reverbSeconds(0));
    expect(reverbImpulse(reverbSeconds(1), SR).length).toBeGreaterThan(reverbImpulse(reverbSeconds(0), SR).length);
  });

  it('starts after a short gap, then dies away to silence', () => {
    const ir = reverbImpulse(1.5, SR);
    expect(ir.slice(0, Math.round(0.01 * SR)).every(v => v === 0)).toBe(true);
    const energy = (a: Float32Array) => a.reduce((s, v) => s + v * v, 0);
    const q = Math.floor(ir.length / 4);
    expect(energy(ir.slice(q, 2 * q))).toBeGreaterThan(energy(ir.slice(3 * q)) * 4);
    expect(ir.every(Number.isFinite)).toBe(true);
  });

  it('is the same every time (no random crackle between plays)', () => {
    expect(reverbImpulse(0.8, SR)).toEqual(reverbImpulse(0.8, SR));
  });
});

it('a new voice starts as sung, with no reverb', () => {
  expect(anyFx(DEFAULT_FX)).toBe(false);
  expect(anyFx({ ...DEFAULT_FX, pitch: 2 })).toBe(true);
  expect(anyFx({ ...DEFAULT_FX, reverb: { ...DEFAULT_FX.reverb, on: true } })).toBe(true);
});

describe('limiter', () => {
  const curve = softLimitCurve();
  // The shaper is fed at 1/HEADROOM: input sample x lands at curve position (x/HEADROOM + 1)/2.
  const at = (x: number) => {
    const v = (curve.length - 1) * 0.5 * (x / HEADROOM + 1);
    const k = Math.floor(v);
    return curve[k] + (v - k) * ((curve[k + 1] ?? curve[k]) - curve[k]);
  };

  it('leaves a normal mix untouched', () => {
    for (const x of [-0.69, -0.3, 0, 0.25, 0.5, 0.69]) expect(at(x)).toBeCloseTo(x, 3);
  });

  it('never lets the live mix reach full scale', () => {
    expect(at(2.9)).toBeLessThanOrEqual(SAFETY_CEILING);
    expect(at(2.9)).toBeGreaterThan(0.85);
    expect(at(-2.9)).toBeGreaterThanOrEqual(-SAFETY_CEILING);
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
  });
});

describe('song trim', () => {
  it('no trim is the whole song', () => {
    expect(clampRange(null, 20, 120)).toEqual({ start: 0, end: 20 });
  });

  it('stays inside the song and at least a beat long', () => {
    expect(clampRange({ start: -3, end: 40 }, 20, 120)).toEqual({ start: 0, end: 20 });
    const r = clampRange({ start: 10, end: 10.1 }, 20, 120);
    expect(r.end - r.start).toBeCloseTo(0.5);
    const atEnd = clampRange({ start: 19.9, end: 25 }, 20, 120);
    expect(atEnd.end).toBe(20);
    expect(atEnd.end - atEnd.start).toBeCloseTo(0.5);
  });

  it('snaps to the drum grid', () => {
    expect(snapToStep(1.06, 120)).toBeCloseTo(1.0);
    expect(snapToStep(1.07, 120)).toBeCloseTo(1.125);
  });
});

describe('pitch latency', () => {
  it('starts a pitched voice early by the stretcher latency, same audio', () => {
    expect(compensateLatency(5, 2, 10, 0, 0.12)).toEqual({ when: 4.88, offset: 2, duration: 10.12 });
  });
  it('skips ahead in the take when the early start is already past', () => {
    const c = compensateLatency(1, 0, 4, 1, 0.12)!;
    expect(c.when).toBe(1);
    expect(c.offset).toBeCloseTo(0.12);
    expect(c.duration).toBeCloseTo(4);
  });
  it('drops a segment with nothing left to hear', () => {
    expect(compensateLatency(0, 0, 0.1, 0.2, 0.12)).toBeNull();
  });
});
