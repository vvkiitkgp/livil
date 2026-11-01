import { convolve, fft } from '../audioClean/fft';
import { removeClicks, type ClickEvent } from '../audioClean/clickRemover';
import { cleanBackground } from '../audioClean/denoise';
import { synthClick } from '../drums';

const SR = 48000;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2147483648 - 1; };
}
function voice(len: number, from: number): Float32Array {
  const v = new Float32Array(len);
  let ph = 0;
  for (let i = from; i < len; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * (220 + 30 * Math.sin(2 * Math.PI * 0.7 * t))) / SR;
    v[i] = 0.25 * (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.25 * Math.sin(3 * ph));
  }
  return v;
}
const energy = (a: Float32Array, from = 0, to = a.length) => { let e = 0; for (let i = from; i < to; i++) e += a[i] * a[i]; return e; };
const diff = (a: Float32Array, b: Float32Array) => a.map((v, i) => v - b[i]);
const db = (x: number) => 10 * Math.log10(x);

describe('fft', () => {
  it('round-trips', () => {
    const r = rng(1);
    const re = new Float64Array(256).map(() => r());
    const orig = Float64Array.from(re);
    const im = new Float64Array(256);
    fft(re, im); fft(re, im, true);
    for (let i = 0; i < 256; i++) expect(re[i]).toBeCloseTo(orig[i], 9);
  });

  it('convolves like the direct sum', () => {
    const a = Float32Array.from([1, 2, 3]);
    const b = Float32Array.from([0, 1, 0.5]);
    expect(Array.from(convolve(a, b)).map(v => Math.round(v * 1000) / 1000)).toEqual([0, 1, 2.5, 4, 1.5]);
  });
});

describe('click remover', () => {
  /**
   * Simulates a phone: clicks leave a small speaker that DISTORTS (soft clipping), bounce
   * round the room, and reach the mic `latencySec` later than the app thinks they played.
   * Negative = the mic started late, so the app's times run ahead of the audio.
   */
  function scene(latencySec: number, drive = 3) {
    const bpm = 92;
    const beat = Math.round((60 / bpm) * SR);
    const lead = Math.round(0.4 * SR); // capture runs before the count-in starts
    const countIn = lead + 4 * beat;
    const len = countIn + 8 * beat;
    const sounds = { accent: synthClick(true, SR), beat: synthClick(false, SR) };
    const clicks: ClickEvent[] = [];
    for (let i = 0; i < 12; i++) clicks.push({ at: lead + i * beat, accent: i % 4 === 0 });
    const played = new Float32Array(len);
    const d = Math.round(latencySec * SR);
    for (const c of clicks) {
      const s = c.accent ? sounds.accent : sounds.beat;
      for (let k = 0; k < s.length; k++) {
        const i = c.at + d + k;
        if (i >= 0 && i < len) played[i] += Math.tanh(drive * 0.35 * s[k]) / drive; // speaker distortion
      }
    }
    const path = new Float32Array(2400);
    path[0] = 0.8; path[37] = -0.3; path[480] = 0.12; path[1500] = 0.05;
    const echo = convolve(played, path).subarray(0, len);
    // The singer comes in on the beat they hear.
    const v = voice(len, Math.max(0, countIn + d));
    const r = rng(7);
    const take = new Float32Array(len).map((_, i) => v[i] + echo[i] + 0.0005 * r());
    return { take, v, clicks, sounds, countIn };
  }

  it.each([-0.25, -0.04, 0.012, 0.2])('removes ≥ 25 dB of a distorted click (timing off by %f s) and keeps the voice', lat => {
    const { take, v, clicks, sounds, countIn } = scene(lat);
    const { cleaned, report } = removeClicks(take, SR, clicks, sounds, countIn);
    const from = countIn + Math.round(lat * SR);
    const before = energy(diff(take, v), from);
    const after = energy(diff(cleaned, v), from);
    // ~30 dB measured; the rest is the room hiss copied into the learned click.
    expect(db(before / after)).toBeGreaterThan(25);
    expect(Math.abs(report.lagMs - lat * 1000)).toBeLessThan(2);
    // The 3 count-in beats always teach it; a late mic also leaves bar 1's accent clean.
    expect(report.learned.beat).toBe(3);
    expect(report.learned.accent).toBeGreaterThanOrEqual(1);
  });

  it('does nothing without a count-in', () => {
    const { take, clicks, sounds } = scene(0.02);
    const { cleaned, removed, report } = removeClicks(take, SR, clicks, sounds, 0);
    expect(removed).toBe(0);
    expect(report.skipped).toBeTruthy();
    expect(cleaned).toEqual(take);
  });
});

describe('background cleanup', () => {
  it('cuts steady noise in the gaps and keeps the voice', async () => {
    const len = SR * 3;
    const v = voice(len, SR); // first second: room only
    const r = rng(3);
    // Fan-like noise: low-passed white noise plus a 120 Hz hum.
    let lp = 0;
    const n = new Float32Array(len).map((_, i) => { lp = 0.9 * lp + 0.1 * r(); return 0.03 * lp + 0.004 * Math.sin(2 * Math.PI * 120 * i / SR) + 0.002 * r(); });
    const x = v.map((s, i) => s + n[i]);
    const y = await cleanBackground(x, SR, 0.8, undefined, 0);
    expect(y.length).toBe(x.length);
    // Gap (room only): at least 12 dB quieter.
    expect(db(energy(x, 2000, SR - 2000) / energy(y, 2000, SR - 2000))).toBeGreaterThan(12);
    // Sung part: the voice is still there — error to the clean voice is well below the voice.
    const err = energy(diff(y, v), SR + 2000, len - 2000);
    expect(db(energy(v, SR + 2000, len - 2000) / err)).toBeGreaterThan(14);
  });

  it('strength 0 still leaves a clean recording essentially untouched', async () => {
    const x = voice(SR, 0);
    const y = await cleanBackground(x, SR, 0, undefined, 0);
    expect(db(energy(x, 2000, SR - 2000) / energy(diff(y, x), 2000, SR - 2000))).toBeGreaterThan(20);
  });
});
