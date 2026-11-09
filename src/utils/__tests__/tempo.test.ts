import { TempoTracker, firstLineOffset, foldTempo, gridShift, tempoHint } from '../tempo';

/** Deterministic noise, −0.5…0.5. */
const rng = (seed: number) => {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
};

type Song = { bpm: number; seconds: number; sr?: number; firstBeat?: number; seed?: number; drift?: number };

/**
 * Something like a person singing: a syllable on most beats (some rests, some pairs on the
 * half beat), each a vowel with a few harmonics, a soft attack, a little vibrato, sloppy
 * timing (±15 ms) and a new note most of the time. `drift` speeds the singer up over the take.
 */
function sing({ bpm, seconds, sr = 48000, firstBeat = 0.3, seed = 11, drift = 0 }: Song): Float32Array {
  const rand = rng(seed);
  const x = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < x.length; i++) x[i] = rand() * 0.002; // the room
  const notes = [196, 220, 247, 262, 294, 330];
  const syllable = (at: number, len: number) => {
    const f0 = notes[Math.floor((rand() + 0.5) * notes.length)];
    const a = Math.round(at * sr);
    const n = Math.round(len * sr);
    for (let i = 0; i < n && a + i < x.length; i++) {
      if (a + i < 0) continue;
      const t = i / sr;
      const amp = 0.25 * Math.min(1, t / 0.025) * Math.min(1, (len - t) / 0.05);
      const ph = 2 * Math.PI * f0 * t + 0.4 * Math.sin(2 * Math.PI * 5.5 * t);
      x[a + i] += amp * (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.3 * Math.sin(3 * ph) + 0.15 * Math.sin(5 * ph));
    }
  };
  let t = firstBeat;
  let beat = 60 / bpm;
  while (t < seconds) {
    const r = rand() + 0.5;
    const late = rand() * 0.03;
    if (r < 0.15) { /* a rest */ }
    else if (r < 0.45) { syllable(t + late, beat * 0.42); syllable(t + beat / 2 + rand() * 0.03, beat * 0.42); }
    else syllable(t + late, beat * 0.8);
    t += beat;
    beat *= 1 - drift;
  }
  return x;
}

/** Feed it the way the recorder does: 2,048 samples at a time. */
function track(x: Float32Array, sr: number, reference?: number, onSecond?: (t: TempoTracker, sec: number) => void): TempoTracker {
  const t = new TempoTracker(sr, reference);
  let nextSec = 1;
  for (let i = 0; i < x.length; i += 2048) {
    t.push(x.subarray(i, Math.min(x.length, i + 2048)));
    if (onSecond && i / sr >= nextSec) onSecond(t, nextSec++);
  }
  return t;
}

describe('tempo of a sung take', () => {
  it.each([72, 92, 104, 120, 138])('hears %i BPM, live and for the whole take', bpm => {
    const t = track(sing({ bpm, seconds: 30 }), 48000, bpm * 1.08);
    expect(Math.abs(t.bpm! - bpm)).toBeLessThanOrEqual(2);
    const sung = t.finish()!;
    expect(Math.abs(sung.bpm - bpm)).toBeLessThanOrEqual(0.3);
    expect(sung.steady).toBe(true);
    expect(sung.sure).toBe(true);
  });

  it('still names the tempo of a singer who creeps up a little, as real singers do', () => {
    // 96 → 98 BPM over half a minute: three real takes like this gave no answer as a whole,
    // while the live readout showed their tempo all along.
    const t = track(sing({ bpm: 96, seconds: 32, drift: 0.0005 }), 48000, 92);
    const sung = t.finish()!;
    expect(sung.bpm).toBeGreaterThan(95);
    expect(sung.bpm).toBeLessThan(99.5);
  });

  it('shows a tempo within 9 seconds of singing', () => {
    let firstAt = 0;
    track(sing({ bpm: 96, seconds: 12 }), 48000, 100, (t, sec) => { if (!firstAt && t.bpm != null) firstAt = sec; });
    expect(firstAt).toBeGreaterThan(0);
    expect(firstAt).toBeLessThanOrEqual(9);
  });

  it('shows a running guess from the third second, before it is sure', () => {
    const seen: (number | null)[] = [];
    const sure: (number | null)[] = [];
    track(sing({ bpm: 96, seconds: 5 }), 48000, 100, t => { seen.push(t.guess); sure.push(t.bpm); });
    expect(seen[2]).toEqual(expect.any(Number));
    expect(sure.every(b => b == null)).toBe(true);
    expect(new TempoTracker(48000).guess).toBeNull();
  });

  it('finds where the beats fall, to within 30 ms', () => {
    for (const firstBeat of [0.1, 0.33, 0.52]) {
      const bpm = 100;
      const sung = track(sing({ bpm, seconds: 40, firstBeat, seed: 5 }), 48000, 100).finish()!;
      const beat = 60 / sung.bpm;
      // Sung syllables start 0–30 ms late and take 25 ms to speak: the beat is heard ~25 ms in.
      let off = (sung.phase - (firstBeat + 0.025)) % beat;
      if (off > beat / 2) off -= beat;
      if (off < -beat / 2) off += beat;
      expect(Math.abs(off)).toBeLessThan(0.03);
    }
  });

  it('finds where the singing starts, and puts the first line on a bar without cutting it', () => {
    // 100 BPM: a bar is 2.4 s. The first line is sung 2.3 s in, so 0.1 s of silence goes in front.
    const sung = track(sing({ bpm: 100, seconds: 40, firstBeat: 2.3, seed: 5 }), 48000, 100).finish()!;
    expect(Math.abs(sung.voiceAt - 2.3)).toBeLessThan(0.1);
    const offset = firstLineOffset(sung.phase, sung.voiceAt, sung.bpm);
    expect(Math.abs(offset - 0.075)).toBeLessThan(0.06);
    expect(sung.voiceAt + offset).toBeGreaterThan(0);
  });

  it('works at the 44.1 kHz some phones record at', () => {
    const sung = track(sing({ bpm: 110, seconds: 30, sr: 44100 }), 44100, 100).finish()!;
    expect(Math.abs(sung.bpm - 110)).toBeLessThanOrEqual(0.3);
  });

  it('of two tempos an octave apart, picks the one nearer the project BPM', () => {
    const x = sing({ bpm: 70, seconds: 30 });
    expect(Math.abs(track(x, 48000, 75).finish()!.bpm - 70)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(track(x, 48000, 150).finish()!.bpm - 140)).toBeLessThanOrEqual(1);
  });

  it('says so when the singer speeds up', () => {
    const sung = track(sing({ bpm: 90, seconds: 45, drift: 0.004 }), 48000, 90).finish();
    expect(sung == null || !sung.steady).toBe(true);
  });

  it('gives no tempo for silence, noise, or one held note (vibrato is not a beat)', () => {
    const sr = 48000;
    const rand = rng(3);
    const silence = new Float32Array(sr * 12);
    const room = new Float32Array(sr * 12).map(() => rand() * 0.004);
    const fan = new Float32Array(sr * 12).map(() => rand() * 0.06);
    const note = (depth: number) => new Float32Array(sr * 12).map((_, i) => {
      const ph = (2 * Math.PI * 220 * i) / sr + depth * Math.sin((2 * Math.PI * 5.5 * i) / sr);
      return 0.25 * (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.3 * Math.sin(3 * ph) + 0.15 * Math.sin(5 * ph)) + rand() * 0.002;
    });
    for (const x of [silence, room, fan, note(0), note(3)]) {
      const t = track(x, sr);
      expect(t.bpm).toBeNull();
      expect(t.finish()).toBeNull();
    }
  });

  it('keeps an envelope, not the audio', () => {
    const t = track(sing({ bpm: 100, seconds: 60 }), 48000) as unknown as { env: Float32Array };
    expect(t.env.length).toBeLessThan(60 * 48000 / 100);
  });
});

describe('tempo helpers', () => {
  it('folds a double or half tempo onto the reference', () => {
    expect(foldTempo(140, 75)).toBe(70);
    expect(foldTempo(62, 120)).toBe(124);
    expect(foldTempo(100, 92)).toBe(100);
  });

  it('says fast, slow or on tempo', () => {
    expect(tempoHint(93, 92)).toBe('on');
    expect(tempoHint(99, 92)).toBe('fast');
    expect(tempoHint(85, 92)).toBe('slow');
    expect(tempoHint(184, 92)).toBe('on');
  });

  it('starts the first line on a bar: crops silence, or adds it, and never cuts the voice', () => {
    // 120 BPM: beats at 0.3, 0.8, … 2.3, 2.8; a bar is 2 s.
    expect(firstLineOffset(0.3, 2.31, 120)).toBeCloseTo(-0.3); // on the beat at 2.3 → that beat at 2.0
    expect(firstLineOffset(0.3, 2.1, 120)).toBeCloseTo(-0.3); // a pickup before 2.3 is kept
    expect(firstLineOffset(0.3, 4.5, 120)).toBeCloseTo(-2.8); // long lead-in: most of it goes
    expect(firstLineOffset(0.3, 0.05, 120)).toBeCloseTo(1.7); // sung at once: silence in front
    for (const voiceAt of [0, 0.05, 0.29, 0.31, 1.2, 2.31, 4.5, 9.99]) {
      const offset = firstLineOffset(0.3, voiceAt, 120);
      expect(voiceAt + offset).toBeGreaterThanOrEqual(0.03 - 1e-9);
      const first = (0.3 + Math.ceil((voiceAt - 0.06 - 0.3) / 0.5) * 0.5 + offset) / 2;
      expect(Math.abs(first - Math.round(first))).toBeLessThan(1e-9);
    }
  });

  it('moves a take the short way onto the grid, never before zero', () => {
    // 120 BPM: a beat every 0.5 s.
    expect(gridShift(0.4, 120, 0)).toBeCloseTo(0.1);
    expect(gridShift(0.1, 120, 0)).toBeCloseTo(0.4); // earlier would cut the take's start
    expect(gridShift(1.1, 120, 1)).toBeCloseTo(-0.1);
    expect(gridShift(1.0, 120, 1)).toBeCloseTo(0);
  });
});
