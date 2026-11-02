/**
 * The Editor's synths: four sounds (Piano, Pad, Bass, Lead) synthesised in JS like the drum
 * kit — no sample library — playing a 4-bar loop of chords and/or notes the person played,
 * always in the song's key. Pure: returns note lists and samples; studioEngine and renderMix
 * play them.
 *
 * Notes are stored as SCALE DEGREES (0 = the key's root, 7 = the root an octave up), not as
 * pitches, so changing a part's key moves everything with it and nothing can be out of key.
 */
import { NOTE_NAMES } from './magicTune/scale';

export type SynthSound = 'keys' | 'pad' | 'bass' | 'lead';
export const SYNTH_SOUNDS: SynthSound[] = ['keys', 'pad', 'bass', 'lead'];
export const SYNTH_NAMES: Record<SynthSound, string> = { keys: 'Piano', pad: 'Pad', bass: 'Bass', lead: 'Lead' };

/** A synth part loops every 4 bars — one chord per bar. */
export const SYNTH_BARS = 4;
export const SYNTH_STEPS = SYNTH_BARS * 16;
/** The keyboard: the key's seven notes plus the root an octave up. */
export const KEYBOARD_DEGREES = [0, 1, 2, 3, 4, 5, 6, 7];
/** The longest note a held key records, in 16ths (one bar). */
export const MAX_NOTE_STEPS = 16;

export type SynthKey = { tonic: number; mode: 'major' | 'minor' };
/** One played note: where it starts in the 4-bar loop, which scale degree, how many 16ths. */
export type SynthNote = { step: number; degree: number; len: number };

export type SynthPart = {
  id: string;
  sound: SynthSound;
  key: SynthKey;
  volume: number;
  /** A chord loop from CHORD_LOOPS, or null for none. */
  chords: ChordLoopId | null;
  notes: SynthNote[];
};

export type ChordLoopId = 'pop' | 'emotional' | 'dreamy' | 'drive';
/** One chord per bar, as scale degrees of the chord roots. Same ids in major and minor. */
export const CHORD_LOOPS: { id: ChordLoopId; name: string; major: number[]; minor: number[] }[] = [
  { id: 'pop', name: 'Pop', major: [0, 4, 5, 3], minor: [0, 5, 2, 6] },
  { id: 'emotional', name: 'Emotional', major: [5, 3, 0, 4], minor: [0, 3, 5, 4] },
  { id: 'dreamy', name: 'Dreamy', major: [0, 3, 5, 4], minor: [0, 6, 5, 6] },
  { id: 'drive', name: 'Drive', major: [0, 0, 3, 4], minor: [0, 0, 5, 6] },
];

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const scale = (k: SynthKey) => (k.mode === 'major' ? MAJOR : MINOR);

export const synthKeyName = (k: SynthKey) => `${NOTE_NAMES[k.tonic]} ${k.mode}`;

/** Lowest note of each sound's range; its root is the first tonic at or above this. */
const REGISTER: Record<SynthSound, number> = { bass: 33, keys: 55, pad: 50, lead: 62 };

const rootMidi = (k: SynthKey, sound: SynthSound) => {
  const r = REGISTER[sound];
  return r + ((((k.tonic - r) % 12) + 12) % 12);
};

/** MIDI note of a scale degree (any integer: 7 is an octave up, -1 the 7th below). */
export function degreeToMidi(k: SynthKey, sound: SynthSound, degree: number): number {
  const oct = Math.floor(degree / 7);
  return rootMidi(k, sound) + scale(k)[degree - 7 * oct] + 12 * oct;
}

/** The pitch class of a scale degree — for labelling keys and chords. */
export function degreeName(k: SynthKey, degree: number): string {
  const d = ((degree % 7) + 7) % 7;
  return NOTE_NAMES[(k.tonic + scale(k)[d]) % 12];
}

/** "D#m", "B", "A°" — the triad built on a scale degree. */
export function chordName(k: SynthKey, degree: number): string {
  const s = scale(k);
  const d = ((degree % 7) + 7) % 7;
  const at = (i: number) => s[i % 7] + (i >= 7 ? 12 : 0);
  const third = at(d + 2) - s[d];
  const fifth = at(d + 4) - s[d];
  return degreeName(k, d) + (fifth === 6 ? '°' : third === 3 ? 'm' : '');
}

export function chordLoopDegrees(id: ChordLoopId, k: SynthKey): number[] {
  const loop = CHORD_LOOPS.find(c => c.id === id) ?? CHORD_LOOPS[0];
  return k.mode === 'major' ? loop.major : loop.minor;
}

/** A sound playing at one step: these MIDI notes together, for `len` 16ths. */
export type SynthHit = { midis: number[]; len: number };

/**
 * How each sound plays a chord through one bar (steps 0–15), as scale degrees above the
 * chord root. Piano: a chord on every beat. Pad: one held chord. Bass: the root, with a
 * push into beats 3 and the next bar. Lead: an up-and-down arpeggio in 8ths.
 */
const CHORD_STYLE: Record<SynthSound, { step: number; len: number; tones: number[] }[]> = {
  keys: [0, 4, 8, 12].map(step => ({ step, len: 3, tones: [0, 2, 4] })),
  pad: [{ step: 0, len: 16, tones: [0, 2, 4, 7] }],
  bass: [
    { step: 0, len: 6, tones: [0] },
    { step: 6, len: 2, tones: [0] },
    { step: 8, len: 6, tones: [0] },
    { step: 14, len: 2, tones: [7] },
  ],
  lead: [0, 2, 4, 7, 4, 2, 0, 2].map((t, i) => ({ step: i * 2, len: 2, tones: [t] })),
};

/**
 * Everything a part plays across its 4-bar loop: index = step (0–63). Chords from high
 * scale degrees are voiced an octave down so the loop stays in one comfortable range.
 */
export function synthHits(part: SynthPart): SynthHit[][] {
  const out: SynthHit[][] = Array.from({ length: SYNTH_STEPS }, () => []);
  const midi = (deg: number) => degreeToMidi(part.key, part.sound, deg);
  if (part.chords) {
    const roots = chordLoopDegrees(part.chords, part.key);
    roots.forEach((root, bar) => {
      const r = root >= (part.sound === 'bass' ? 5 : 4) ? root - 7 : root;
      for (const h of CHORD_STYLE[part.sound]) {
        out[bar * 16 + h.step].push({ midis: h.tones.map(t => midi(r + t)), len: h.len });
      }
    });
  }
  for (const n of part.notes) {
    if (n.step < 0 || n.step >= SYNTH_STEPS) continue;
    out[n.step].push({ midis: [midi(n.degree)], len: n.len });
  }
  return out;
}

// ── sound ───────────────────────────────────────────────────────────────────

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const TAU = 2 * Math.PI;

/** How long a sound rings after its note is let go, seconds. */
export const RELEASE: Record<SynthSound, number> = { keys: 0.35, pad: 0.7, bass: 0.08, lead: 0.15 };
/** Per-note level, so a 3–4 note chord stays under full scale. */
const LEVEL: Record<SynthSound, number> = { keys: 0.15, pad: 0.3, bass: 0.35, lead: 0.28 };

/**
 * Samples for notes held `seconds` together, plus the release tail. Deterministic (no
 * randomness), so a part sounds the same in the Editor and in the posted mix.
 */
export function renderSynth(sound: SynthSound, midis: number[], seconds: number, sampleRate: number): Float32Array {
  const sr = sampleRate;
  const rel = RELEASE[sound];
  const len = Math.max(1, Math.round((seconds + rel) * sr));
  const out = new Float32Array(len);
  const level = LEVEL[sound];
  const attack = sound === 'pad' ? 0.3 : sound === 'lead' ? 0.012 : 0.004;
  // A 2-pole low-pass for the buzzy sounds (12 dB/oct: the old 1-pole only took the edge off).
  const cutoff = sound === 'pad' ? 1400 : sound === 'lead' ? 2600 : sound === 'bass' ? 700 : 0;
  const lp = cutoff ? lowpass(cutoff, sr) : null;

  for (const m of midis) {
    const hz = midiHz(m);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    let p0 = 0, p1 = 0, p2 = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let env = t < attack ? t / attack : 1;
      if (t > seconds) env *= Math.exp(-((t - seconds) / rel) * 5);
      let x: number;
      if (sound === 'keys') {
        // Electric-piano-ish: a sine with quickly fading overtones and a soft overall decay.
        x = Math.sin(TAU * hz * t)
          + 0.35 * Math.sin(2 * TAU * hz * t) * Math.exp(-t * 4)
          + 0.12 * Math.sin(3 * TAU * hz * t) * Math.exp(-t * 7)
          + 0.06 * Math.sin(7 * TAU * hz * t) * Math.exp(-t * 25);
        env *= 0.35 + 0.65 * Math.exp(-t * 2.2);
      } else if (sound === 'pad') {
        // Three saws, slightly detuned against each other: the slow shimmer of a pad.
        const d0 = (hz * 0.9954) / sr, d1 = hz / sr, d2 = (hz * 1.0046) / sr;
        p0 = (p0 + d0) % 1; p1 = (p1 + d1) % 1; p2 = (p2 + d2) % 1;
        x = (saw(p0, d0) + saw(p1, d1) + saw(p2, d2)) / 3;
      } else if (sound === 'bass') {
        const d = hz / sr;
        p0 = (p0 + d) % 1;
        x = Math.tanh(1.6 * (Math.sin(TAU * p0) + 0.4 * saw(p0, d)));
        env *= 0.8 + 0.2 * Math.exp(-t * 6);
      } else {
        // Lead: square + saw, with a little vibrato once the note has settled.
        const vib = t > 0.25 ? 1 + 0.009 * Math.sin(TAU * 5.5 * t) : 1;
        const d = (hz * vib) / sr;
        p0 = (p0 + d) % 1;
        x = 0.6 * square(p0, d) + 0.4 * saw(p0, d);
      }
      let y = x;
      if (lp) {
        y = lp.b0 * x + lp.b1 * x1 + lp.b2 * x2 - lp.a1 * y1 - lp.a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
      }
      out[i] += y * env * level;
    }
  }
  // 2 ms in, so even the bass doesn't click at the start; 10 ms out at the very end.
  const fin = Math.min(len, Math.round(0.002 * sr));
  for (let i = 0; i < fin; i++) out[i] *= i / fin;
  const fout = Math.min(len, Math.round(0.01 * sr));
  for (let i = 0; i < fout; i++) out[len - 1 - i] *= i / fout;
  return out;
}

/**
 * PolyBLEP: smooths the instant jump in a saw/square over one sample either side, which takes
 * out the aliasing (the whistly, out-of-tune tones a raw saw makes on high notes).
 * `t` = phase 0..1, `dt` = phase step per sample.
 */
function blep(t: number, dt: number): number {
  if (t < dt) { const u = t / dt; return u + u - u * u - 1; }
  if (t > 1 - dt) { const u = (t - 1) / dt; return u * u + u + u + 1; }
  return 0;
}
const saw = (t: number, dt: number) => 2 * t - 1 - blep(t, dt);
const square = (t: number, dt: number) => (t < 0.5 ? 1 : -1) + blep(t, dt) - blep((t + 0.5) % 1, dt);

/** RBJ 2-pole low-pass (Butterworth, Q = 0.707). */
function lowpass(fc: number, fs: number) {
  const w = (TAU * fc) / fs;
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  return { b0: (1 - cos) / 2 / a0, b1: (1 - cos) / a0, b2: (1 - cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

// ── drafts ──────────────────────────────────────────────────────────────────

const isSound = (x: unknown): x is SynthSound => SYNTH_SOUNDS.includes(x as SynthSound);
const isLoop = (x: unknown): x is ChordLoopId => CHORD_LOOPS.some(c => c.id === x);
const int = (x: unknown, lo: number, hi: number) => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;

/**
 * The synth parts of a saved draft, keeping only what this build can play. Drafts saved
 * before synths existed have none — that is `[]`, not an error.
 */
export function sanitizeSynths(x: unknown): SynthPart[] {
  if (!Array.isArray(x)) return [];
  const out: SynthPart[] = [];
  for (const s of x as Partial<SynthPart>[]) {
    if (!s || typeof s.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(s.id) || !isSound(s.sound)) continue;
    const k = s.key;
    if (!k || !int(k.tonic, 0, 11) || (k.mode !== 'major' && k.mode !== 'minor')) continue;
    const notes = Array.isArray(s.notes)
      ? s.notes.filter(n => n && int(n.step, 0, SYNTH_STEPS - 1) && int(n.degree, -7, 14) && int(n.len, 1, MAX_NOTE_STEPS))
        .map(n => ({ step: n.step, degree: n.degree, len: n.len }))
      : [];
    const volume = typeof s.volume === 'number' && s.volume >= 0 && s.volume <= 3 ? s.volume : 0.8;
    out.push({ id: s.id, sound: s.sound, key: { tonic: k.tonic, mode: k.mode }, volume, chords: isLoop(s.chords) ? s.chords : null, notes });
  }
  return out;
}
