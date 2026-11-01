import { reduceBreaths } from '../audioClean/breath';
import { repairClicks } from '../audioClean/clickRepair';

const SR = 48000;
const voice = (seconds: number) => {
  const x = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * 180 * i) / SR) + 0.1 * Math.sin((2 * Math.PI * 540 * i) / SR + 1);
  return x;
};

describe('click repair', () => {
  it('puts back samples the recorder glitched, every 1,104 samples like the iPhone bug', () => {
    const clean = voice(2);
    const x = new Float32Array(clean);
    let glitches = 0;
    for (let k = 1000; k < x.length - 1000; k += 1104) { x[k] += x[k] > 0 ? -0.25 : 0.25; glitches++; }
    const { out, report } = repairClicks(x);
    expect(report.repaired).toBe(glitches);
    let worst = 0;
    for (let k = 0; k < out.length; k++) worst = Math.max(worst, Math.abs(out[k] - clean[k]));
    expect(worst).toBeLessThan(0.002);
  });

  it('leaves clean singing and sibilant noise alone', () => {
    const x = voice(1);
    let s = 7;
    for (let i = 20000; i < 26000; i++) { s = (s * 16807) % 2147483647; x[i] += (s / 2147483647 - 0.5) * 0.2; } // an "s"
    expect(repairClicks(x).report.repaired).toBe(0);
  });
});

describe('breath reduction', () => {
  it('turns a soft breath between lines down by 12 dB and leaves the singing', () => {
    const x = new Float32Array(SR * 3);
    const v = voice(1);
    x.set(v, 0);
    x.set(v, 2 * SR);
    let s = 3;
    for (let i = Math.round(1.3 * SR); i < Math.round(1.6 * SR); i++) { s = (s * 16807) % 2147483647; x[i] = (s / 2147483647 - 0.5) * 0.02; } // inhale
    for (let i = SR; i < 3 * SR; i++) if (i < 1.3 * SR || i >= 1.6 * SR) if (i < 2 * SR) x[i] = 1e-5 * Math.sin(i); // room
    const { out, report } = reduceBreaths(x, SR);
    expect(report.breaths).toBe(1);
    const mid = Math.round(1.45 * SR);
    expect(Math.abs(out[mid] / x[mid])).toBeCloseTo(Math.pow(10, -12 / 20), 2);
    expect(out[SR / 2]).toBe(x[SR / 2]);
  });
});

describe('clicks smeared by a rate change', () => {
  it('finds glitches after 44.1 → 48 kHz turned them into short bursts', async () => {
    const { resampleAsync } = require('../audioFx/level');
    const sr = 44100;
    const clean = new Float32Array(sr * 2).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 180 * i) / sr) + 0.1 * Math.sin((2 * Math.PI * 540 * i) / sr + 1));
    const x = new Float32Array(clean);
    let glitches = 0;
    for (let k = 3000; k < x.length - 3000; k += 1015) { x[k] += x[k] > 0 ? -0.25 : 0.25; glitches++; }
    const at48: Float32Array = await resampleAsync(x, sr, 48000);
    const ref48: Float32Array = await resampleAsync(clean, sr, 48000);
    const { out, report } = repairClicks(at48);
    expect(report.repaired + report.bursts).toBeGreaterThanOrEqual(glitches * 0.9);
    let before = 0, after = 0;
    for (let k = 3000; k < out.length - 3000; k++) { before = Math.max(before, Math.abs(at48[k] - ref48[k])); after = Math.max(after, Math.abs(out[k] - ref48[k])); }
    expect(after).toBeLessThan(before / 5);
  });
});

describe('fast rate change', () => {
  it('converts 44.1 → 48 kHz without changing the pitch', async () => {
    const { resampleAsync } = require('../audioFx/level');
    const x = new Float32Array(44100).map((_, i) => Math.sin((2 * Math.PI * 1000 * i) / 44100));
    const y: Float32Array = await resampleAsync(x, 44100, 48000);
    expect(y.length).toBe(48000);
    let err = 0;
    for (let i = 100; i < y.length - 100; i++) err = Math.max(err, Math.abs(y[i] - Math.sin((2 * Math.PI * 1000 * i) / 48000)));
    expect(err).toBeLessThan(0.01);
  });
});
