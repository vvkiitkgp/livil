import { autoLevel, edgeRamp, resample } from '../audioFx/level';
import { CEILING_DBTP, finishEnds, kWeighting, masterInPlace, measureLufs, measureTruePeak, TARGET_LUFS } from '../audioFx/master';

const SR = 48000;
const sine = (hz: number, seconds: number, amp = 1, phase = 0) => {
  const x = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR + phase);
  return x;
};
/** A "song": a quiet voice-like tone with drum-like spikes on every beat. */
const song = (seconds: number, base = 0.05, hit = 0.6) => {
  const x = sine(220, seconds, base);
  const beat = Math.round(SR * 0.5);
  for (let b = 0; b < x.length; b += beat) for (let i = 0; i < 2400 && b + i < x.length; i++) x[b + i] += hit * Math.exp(-i / 300) * Math.sin(i / 7);
  return x;
};

describe('loudness meter (BS.1770-4)', () => {
  it('uses the standard K-weighting at 48 kHz', () => {
    const [shelf, hp] = kWeighting(48000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 6);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 6);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 6);
    expect(hp.a1).toBeCloseTo(-1.99004745483398, 6);
    expect(hp.a2).toBeCloseTo(0.99007225036621, 6);
  });

  it('reads a full-scale 997 Hz sine in one channel as −3.01 LUFS', async () => {
    expect(await measureLufs([sine(997, 5)], SR)).toBeCloseTo(-3.01, 1);
  });

  it('finds the peak between samples (fs/4 sine at 45° = +3 dBTP)', async () => {
    // Samples land at ±0.707 (−3 dBFS); the wave between them reaches 1.0 (0 dBTP).
    expect(await measureTruePeak([sine(SR / 4, 0.5, 1, Math.PI / 4)])).toBeGreaterThan(-0.2);
    expect(await measureTruePeak([sine(1000, 0.5, 0.5)])).toBeCloseTo(-6.02, 1);
  });
});

describe('mastering', () => {
  it('brings a song to the target loudness with no true peak over −1 dBTP', async () => {
    const x = song(12, 0.15, 0.3);
    const report = await masterInPlace([x, new Float32Array(x)], SR);
    expect(report.lufs).toBeGreaterThan(TARGET_LUFS - 0.7);
    expect(report.lufs).toBeLessThan(TARGET_LUFS + 0.5);
    expect(await measureTruePeak([x])).toBeLessThanOrEqual(CEILING_DBTP + 0.01);
  });

  it('keeps a mono-in-stereo song identical in both channels', async () => {
    const l = song(6), r = new Float32Array(l);
    await masterInPlace([l, r], SR);
    expect(r).toEqual(l);
  });

  it('ships a very spiky song quieter rather than squashing it', async () => {
    const x = song(12, 0.004, 0.9); // a whisper with loud hits
    const report = await masterInPlace([x], SR);
    expect(report.limitDb).toBeLessThanOrEqual(4.6);
    expect(report.lufs).toBeLessThan(TARGET_LUFS);
  });

  it('leaves silence alone', async () => {
    const x = new Float32Array(SR);
    const report = await masterInPlace([x], SR);
    expect(report.gainDb).toBe(0);
    expect(x.every(v => v === 0)).toBe(true);
  });

  it('fades in and out, keeping a ringing tail', () => {
    const x = sine(440, 3, 0.5);
    for (let i = 2 * SR; i < x.length; i++) x[i] *= Math.exp(-(i - 2 * SR) / (0.05 * SR)); // tail after the 2 s song
    const end = finishEnds([x], SR, 2 * SR);
    expect(end).toBeGreaterThan(2 * SR);
    expect(end).toBeLessThan(3 * SR);
    expect(Math.abs(x[0])).toBe(0);
    expect(Math.abs(x[end - 1])).toBeLessThan(1e-3);
  });
});

describe('levels', () => {
  it('brings a quiet take up to about −20 dBFS of singing', () => {
    const take = new Float32Array(SR * 4);
    take.set(sine(200, 2, 0.03), SR); // 2 s of quiet singing between silence
    const g = autoLevel(take, SR);
    const rms = 0.03 / Math.SQRT2;
    expect(20 * Math.log10(rms * g)).toBeCloseTo(-20, 0);
  });

  it('never pushes a take’s peak over −3 dBFS', () => {
    const take = sine(200, 2, 0.05);
    take[1000] = 0.6; // one loud pop
    expect(0.6 * autoLevel(take, SR)).toBeLessThanOrEqual(Math.pow(10, -3 / 20) + 1e-6);
  });

  it('fades segment edges over 4 ms, shorter for tiny segments', () => {
    expect(edgeRamp(1)).toBe(0.004);
    expect(edgeRamp(0.004)).toBe(0.002);
  });

  it('changes a take’s rate without changing its pitch', () => {
    const x = resample(new Float32Array(sine(1000, 1).map(v => v)), SR, 44100);
    expect(x.length).toBe(44100);
    let crossings = 0;
    for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) crossings++;
    expect(Math.abs(crossings - 1000)).toBeLessThanOrEqual(1);
  });
});

