import {
  analyzeTake,
  applyMagicTune,
  CHROMATIC,
  correctionCurve,
  detectPitch,
  rankKeys,
  scaleOf,
  snapMidi,
  type Key,
} from '../magicTune';
import { psolaShift } from '../magicTune/psola';
import { DRUM_IDS, DRUM_PRESETS, isPrivateOutput, nearestStep, STEPS, synthClick, synthDrum } from '../drums';

const SR = 44100;

/** A voice-like harmonic tone: five partials at 1/h amplitude. */
function tone(hz: number | ((t: number) => number), seconds: number, sr = SR): Float32Array {
  const out = new Float32Array(Math.round(seconds * sr));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const f = typeof hz === 'number' ? hz : hz(i / sr);
    phase += (2 * Math.PI * f) / sr;
    let s = 0;
    for (let h = 1; h <= 5; h++) s += Math.sin(h * phase) / h;
    out[i] = 0.3 * s;
  }
  return out;
}

function medianVoiced(f0: Float32Array): number {
  const v = Array.from(f0).filter(x => x > 0).sort((a, b) => a - b);
  return v.length ? v[v.length >> 1] : 0;
}

describe('pitch detection', () => {
  it.each([110, 220, 330, 440, 660])('finds %d Hz within 1%', async hz => {
    const track = await detectPitch(tone(hz, 1), SR, undefined, 0);
    expect(Math.abs(medianVoiced(track.f0) - hz) / hz).toBeLessThan(0.01);
  });

  it('marks silence as unvoiced', async () => {
    const track = await detectPitch(new Float32Array(SR), SR, undefined, 0);
    expect(Array.from(track.f0).every(v => v === 0)).toBe(true);
  });

  it('works at 48 kHz too', async () => {
    const track = await detectPitch(tone(220, 1, 48000), 48000, undefined, 0);
    expect(Math.abs(medianVoiced(track.f0) - 220) / 220).toBeLessThan(0.01);
  });

  it('still finds a high note (880 Hz), close to the low-pass', async () => {
    const track = await detectPitch(tone(880, 1, 48000), 48000, undefined, 0);
    expect(Math.abs(medianVoiced(track.f0) - 880) / 880).toBeLessThan(0.01);
  });

  // A bright, hissy phone mic (OnePlus 7T, 2026-11-10): the note is clear, but energy at
  // 3–5 kHz hid it and Magic Tune's graph came up empty.
  it('finds the note under mic hiss', async () => {
    const x = tone(180, 1, 48000);
    let seed = 7;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    // Forty unrelated partials between 3 and 5 kHz, about half as loud as the voice.
    for (let p = 0; p < 40; p++) {
      const w = (2 * Math.PI * (3000 + 2000 * rand())) / 48000;
      const phase = 2 * Math.PI * rand();
      for (let i = 0; i < x.length; i++) x[i] += 0.035 * Math.sin(w * i + phase);
    }
    const track = await detectPitch(x, 48000, undefined, 0);
    const voiced = Array.from(track.f0).filter(v => v > 0).length;
    expect(voiced / track.f0.length).toBeGreaterThan(0.9);
    expect(Math.abs(medianVoiced(track.f0) - 180) / 180).toBeLessThan(0.01);
  });
});

describe('keys and snapping', () => {
  const aMinor: Key = { tonic: 9, mode: 'minor' };

  it('snaps to the nearest note in the key', () => {
    const scale = scaleOf(aMinor);
    expect(snapMidi(69.3, scale)).toBe(69); // A stays A
    expect(snapMidi(61.2, scale)).toBe(62); // C# → D (closer)
    expect(snapMidi(60.8, scale)).toBe(60); // C# → C (closer)
    expect(snapMidi(61.0, scale)).toBe(60); // exact tie goes down
  });

  it('chromatic keeps every semitone', () => {
    expect(snapMidi(61.4, scaleOf(CHROMATIC))).toBe(61);
  });

  it('ranks C major (or its relative A minor) first for a C-major melody', async () => {
    const notes = [60, 62, 64, 65, 67, 69, 71, 72, 67, 64, 60];
    const parts = notes.map(m => tone(440 * Math.pow(2, (m - 69) / 12), 0.25));
    const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    const track = await detectPitch(all, SR, undefined, 0);
    const best = rankKeys(track)[0];
    const ok = (best.tonic === 0 && best.mode === 'major') || (best.tonic === 9 && best.mode === 'minor');
    expect(ok).toBe(true);
  });
});

describe('PSOLA', () => {
  it('ratio 1 is (near) identity', async () => {
    const x = tone(220, 1);
    const track = await detectPitch(x, SR, undefined, 0);
    const y = psolaShift(x, track, new Float32Array(track.f0.length).fill(1));
    let num = 0, dx = 0, dy = 0;
    for (let i = 2000; i < x.length - 2000; i++) { num += x[i] * y[i]; dx += x[i] * x[i]; dy += y[i] * y[i]; }
    expect(num / Math.sqrt(dx * dy)).toBeGreaterThan(0.98);
  });

  it.each([2 ** (1 / 12), 2 ** (-1 / 12), 2 ** (3 / 12)])('shifts by ratio %f without changing length', async r => {
    const x = tone(220, 1);
    const track = await detectPitch(x, SR, undefined, 0);
    const y = psolaShift(x, track, new Float32Array(track.f0.length).fill(r));
    expect(y.length).toBe(x.length);
    const out = await detectPitch(y, SR, undefined, 0);
    expect(Math.abs(medianVoiced(out.f0) - 220 * r) / (220 * r)).toBeLessThan(0.015);
  });

  it('keeps loudness', async () => {
    const x = tone(220, 1);
    const track = await detectPitch(x, SR, undefined, 0);
    const y = psolaShift(x, track, new Float32Array(track.f0.length).fill(2 ** (2 / 12)));
    const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    expect(rms(y) / rms(x)).toBeGreaterThan(0.8);
    expect(rms(y) / rms(x)).toBeLessThan(1.25);
  });
});

describe('Magic Tune end to end', () => {
  it('pulls a flat A (430 Hz) up to 440 at full strength', async () => {
    const x = tone(430, 1.5);
    const analysis = await analyzeTake(x, SR);
    const { tuned } = applyMagicTune(x, analysis, { key: { tonic: 9, mode: 'minor' }, strength: 1 });
    const out = await detectPitch(tuned, SR, undefined, 0);
    expect(Math.abs(medianVoiced(out.f0) - 440)).toBeLessThan(3);
  });

  it.each([0, 0.5, 1])('a held note lands exactly on its line at strength %s', async strength => {
    const x = tone(430, 1.5);
    const analysis = await analyzeTake(x, SR);
    const curve = correctionCurve(analysis.track, { key: CHROMATIC, strength });
    const mid = Math.floor(curve.tunedMidi.length / 2);
    expect(curve.tunedMidi[mid]).toBeCloseTo(69, 2);
  });

  it('robot jumps between notes; gentle glides', async () => {
    // One unbroken phrase: A4, then B4.
    const x = tone(t => (t < 0.6 ? 440 : 494), 1.2);
    const analysis = await analyzeTake(x, SR);
    const robot = correctionCurve(analysis.track, { key: CHROMATIC, strength: 1 });
    const gentle = correctionCurve(analysis.track, { key: CHROMATIC, strength: 0 });
    const jump = Array.from(robot.tunedMidi).findIndex(m => m > 70);
    expect(jump).toBeGreaterThan(0);
    expect(robot.tunedMidi[jump]).toBeCloseTo(71, 2);
    expect(gentle.tunedMidi[jump]).toBeLessThan(70.9);
    expect(gentle.tunedMidi[robot.tunedMidi.length - 5]).toBeCloseTo(71, 1);
  });

  it('a blip shorter than a note joins the note around it', async () => {
    const x = new Float32Array([...tone(440, 0.5), ...tone(494, 0.04), ...tone(440, 0.5)]);
    const analysis = await analyzeTake(x, SR);
    const curve = correctionCurve(analysis.track, { key: CHROMATIC, strength: 1 });
    const voiced = Array.from(curve.tunedMidi).filter(Number.isFinite);
    expect(voiced.every(m => Math.abs(m - 69) < 0.01)).toBe(true);
  });

  it('leaves unvoiced frames alone', async () => {
    const analysis = await analyzeTake(new Float32Array(SR), SR);
    const curve = correctionCurve(analysis.track, { key: CHROMATIC, strength: 1 });
    expect(Array.from(curve.ratio).every(r => r === 1)).toBe(true);
  });
});

describe('drums', () => {
  it.each(DRUM_IDS)('%s is a short, non-silent, unclipped one-shot', id => {
    const s = synthDrum(id, SR);
    expect(s.length).toBeGreaterThan(SR * 0.05);
    expect(s.length).toBeLessThan(SR * 0.5);
    const peak = s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it('presets are one bar of 16 steps', () => {
    for (const p of DRUM_PRESETS) for (const id of DRUM_IDS) expect(p.pattern[id]).toHaveLength(STEPS);
  });

  it('quantises a tap to the nearest step and wraps the bar', () => {
    const stepSec = 60 / 120 / 4; // 0.125 s at 120 BPM
    expect(nearestStep(0.01, 120)).toBe(0);
    expect(nearestStep(stepSec * 5 + 0.04, 120)).toBe(5);
    expect(nearestStep(stepSec * 15.6, 120)).toBe(0);
  });
});

describe('metronome', () => {
  it('clicks are short, audible and unclipped', () => {
    for (const c of [synthClick(true, SR), synthClick(false, SR)]) {
      expect(c.length).toBeLessThan(SR * 0.05);
      const peak = c.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      expect(peak).toBeGreaterThan(0.3);
      expect(peak).toBeLessThanOrEqual(1);
    }
  });

  it.each([
    ['Headphones', true], ['BluetoothA2DPOutput', true], ['BluetoothLE', true], ['USBAudio', true],
    ['Wired Headset', true], ['Bluetooth A2DP', true],
    ['Speaker', false], ['Receiver', false], ['Built-in Speaker', false], ['AirPlay', false], ['CarAudio', false],
  ])('%s keeps the click out of the mic: %s', (cat, ok) => {
    expect(isPrivateOutput(cat)).toBe(ok);
  });
});
