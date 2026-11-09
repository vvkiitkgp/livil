/**
 * The Editor's synths: Piano, Pad, Bass, Lead and an acoustic Guitar, synthesised in JS like
 * the drum kit — no sample library — playing a 4-bar loop of chords and/or notes the person
 * played, always in the song's key. Pure: returns note lists and samples; studioEngine and
 * renderMix play them.
 *
 * Notes are stored as SCALE DEGREES (0 = the key's root, 7 = the root an octave up), not as
 * pitches, so changing a part's key moves everything with it and nothing can be out of key.
 * On the guitar a played "note" is the chord built on that degree, held for its length and
 * strummed in the part's strumming pattern (see STRUMS).
 */
import { noise } from './drums';
import { NOTE_NAMES } from './magicTune/scale';

/** `strum` and `pick` are both the Guitar: the same strings, strummed or fingerpicked. */
export type SynthSound = 'keys' | 'pad' | 'bass' | 'lead' | 'strum' | 'pick';
export const SYNTH_SOUNDS: SynthSound[] = ['keys', 'pad', 'bass', 'lead', 'strum', 'pick'];
export const SYNTH_NAMES: Record<SynthSound, string> = {
  keys: 'Piano', pad: 'Pad', bass: 'Bass', lead: 'Lead', strum: 'Guitar', pick: 'Guitar',
};
/** The sound picker: one chip per instrument (the Guitar's style is chosen under Strumming). */
export const SOUND_CHOICES: SynthSound[] = ['keys', 'pad', 'bass', 'lead', 'strum'];
export const isGuitar = (s: SynthSound): s is 'strum' | 'pick' => s === 'strum' || s === 'pick';
/** Same instrument, so the same chip: either guitar style lights up the Guitar chip. */
export const sameInstrument = (a: SynthSound, b: SynthSound) => a === b || (isGuitar(a) && isGuitar(b));

/** A synth part loops every 4 bars — one chord per bar. */
export const SYNTH_BARS = 4;
export const SYNTH_STEPS = SYNTH_BARS * 16;
/** The keyboard: the key's seven notes plus the root an octave up. */
export const KEYBOARD_DEGREES = [0, 1, 2, 3, 4, 5, 6, 7];
/** The guitar's keys: the seven chords of the key (an eighth would repeat the first). */
const GUITAR_DEGREES = [0, 1, 2, 3, 4, 5, 6];
export const keyboardDegrees = (s: SynthSound) => (isGuitar(s) ? GUITAR_DEGREES : KEYBOARD_DEGREES);
/** The longest note a held key records, in 16ths (one bar). */
export const MAX_NOTE_STEPS = 16;

export type SynthKey = { tonic: number; mode: 'major' | 'minor' };
/** One played note: where it starts in the 4-bar loop, which scale degree, how many 16ths. */
export type SynthNote = { step: number; degree: number; len: number };

export type StrumId = 'single' | 'steady' | 'island' | 'rock' | 'indie' | 'chuck';
/**
 * The guitar's strumming patterns: one bar in 16ths — D a down stroke, U an up stroke, X a
 * muted "chuck", . the hand passing without touching the strings. A strumming hand never
 * stops: it swings down on the beat and up after it, and a pattern is only which of those
 * swings touch. So every one of these can be played, and none asks for two downs in a row
 * faster than a hand moves. (Indie swings in 16ths: down on every 8th, up between.)
 */
export const STRUMS: { id: StrumId; name: string; bar: string }[] = [
  { id: 'single', name: 'Single', bar: 'D...............' },
  { id: 'steady', name: 'Steady', bar: 'D...D...D...D...' },
  { id: 'island', name: 'Island', bar: 'D...D.U...U.D.U.' },
  { id: 'rock', name: 'Rock', bar: 'D.U.D.U.D.U.D.U.' },
  { id: 'indie', name: 'Indie', bar: 'D.D.D.DUD.D.D.DU' },
  { id: 'chuck', name: 'Chuck', bar: 'D.U.X.U.D.U.X.U.' },
];
/** Fingerpicking shown the same way: P a picked string. */
const PICK_BAR = 'P.P.P.P.P.P.P.P.';

export type SynthPart = {
  id: string;
  sound: SynthSound;
  key: SynthKey;
  volume: number;
  /** A chord loop from CHORD_LOOPS, or null for none. */
  chords: ChordLoopId | null;
  notes: SynthNote[];
  /** The strummed guitar's pattern, from STRUMS (absent = Island). Other sounds ignore it. */
  strum?: StrumId;
};

export const strumOf = (p: Pick<SynthPart, 'strum'>): StrumId => p.strum ?? 'island';
const strumInfo = (p: Pick<SynthPart, 'strum'>) => STRUMS.find(s => s.id === strumOf(p)) ?? STRUMS[2];
/** One bar of what the guitar's hand does, as STRUMS writes it. */
export const guitarBar = (p: Pick<SynthPart, 'sound' | 'strum'>): string => (p.sound === 'pick' ? PICK_BAR : strumInfo(p).bar);
/** "Island", "Fingerpick" — the guitar's style, for labels. */
export const guitarStyleName = (p: Pick<SynthPart, 'sound' | 'strum'>): string => (p.sound === 'pick' ? 'Fingerpick' : strumInfo(p).name);

export type ChordLoopId = 'pop' | 'emotional' | 'dreamy' | 'drive';
/** One chord per bar, as scale degrees of the chord roots. Same ids in major and minor. */
export const CHORD_LOOPS: { id: ChordLoopId; name: string; major: number[]; minor: number[] }[] = [
  { id: 'pop', name: 'Pop', major: [0, 4, 5, 3], minor: [0, 5, 2, 6] },
  { id: 'emotional', name: 'Emotional', major: [5, 3, 0, 4], minor: [0, 3, 5, 4] },
  { id: 'dreamy', name: 'Dreamy', major: [0, 3, 5, 4], minor: [0, 6, 5, 6] },
  { id: 'drive', name: 'Drive', major: [0, 0, 3, 4], minor: [0, 0, 5, 6] },
];

const TAU = 2 * Math.PI;
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const scale = (k: SynthKey) => (k.mode === 'major' ? MAJOR : MINOR);

export const synthKeyName = (k: SynthKey) => `${NOTE_NAMES[k.tonic]} ${k.mode}`;

/** The guitar's low E string (E2). */
const GUITAR_LOW_E = 40;
/** Lowest note of each sound's range; its root is the first tonic at or above this. */
const REGISTER: Record<SynthSound, number> = { bass: 33, keys: 55, pad: 50, lead: 62, strum: GUITAR_LOW_E, pick: GUITAR_LOW_E };

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

/** How the guitar's strings are struck — part of the sound, so part of what gets rendered. */
export type Touch = {
  /** Seconds between one string and the next. */
  gap?: number;
  /** A "chuck": struck with the hand resting on the strings — a thump, no chord. */
  mute?: boolean;
  /** Damped at once (a chuck lands on it) instead of fading out. */
  cut?: boolean;
  /** How hard the hand comes down, 0–1 (absent = 1): a light stroke is duller, not only quieter. */
  hard?: number;
};

/** A sound playing at one step: these MIDI notes together, for `len` 16ths. */
export type SynthHit = { midis: number[]; len: number } & Touch & {
  /** Guitar: how hard this stroke is played; 1 (or absent) is the sound's own level. */
  gain?: number;
  /** Guitar: seconds after (+) or before (−) the step it lands on — the player's timing. */
  shift?: number;
};

/**
 * How each sound plays a chord through one bar (steps 0–15), as scale degrees above the
 * chord root. Piano: a chord on every beat. Pad: one held chord. Bass: the root, with a
 * push into beats 3 and the next bar. Lead: an up-and-down arpeggio in 8ths.
 */
const CHORD_STYLE: Record<Exclude<SynthSound, 'strum' | 'pick'>, { step: number; len: number; tones: number[] }[]> = {
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
 * The guitar chord on a scale degree, as MIDI notes in strum order (low string → high): the
 * barre shapes a guitarist plays. Roots E–B sit on the low E string (six-string E shape);
 * C–D# move to the A string (five-string A shape), so no chord climbs past the 7th fret.
 */
export function guitarChord(k: SynthKey, degree: number): number[] {
  const midi = (d: number) => degreeToMidi(k, 'strum', d);
  let r = degree;
  while (midi(r) >= GUITAR_LOW_E + 12) r -= 7;
  while (midi(r) < GUITAR_LOW_E) r += 7;
  // Root, 5th, octave, 3rd, 5th (and the root on top in the E shape), as scale degrees.
  const shape = midi(r) < GUITAR_LOW_E + 8 ? [0, 4, 7, 9, 11, 14] : [0, 4, 7, 9, 11];
  return shape.map(t => midi(r + t));
}

/**
 * Fingerpicking in 8ths, as strings of the chord: the root in the bass, the top three strings,
 * the 5th in the bass, the top three again (negative = counted from the top string). Each
 * note rings for half a bar, or until the chord changes.
 */
const PICK = [0, -3, -2, -1, 1, -3, -2, -1];

/**
 * How hard the hand comes down on each 16th of the bar. The backbeat (2 and 4, where a
 * drummer's snare is) is the accent, then beat 1, then 3; the "and"s between are lighter and
 * the 16ths between those lightest. Without this every strum is as loud as the last, which is
 * what makes a programmed guitar sound like an organ.
 */
const accent = (pos: number) => (pos % 2 ? 0.48 : pos % 4 ? 0.6 : pos === 4 || pos === 12 ? 1 : pos === 0 ? 0.8 : 0.74);
/**
 * …and how that changes the tone: three kinds of stroke, not a sliding scale, so the same
 * few strokes are synthesised however the loudness drifts (see `LIGHT`).
 */
const hardness = (loud: number) => (loud >= 0.9 ? 1 : loud >= 0.7 ? 0.7 : 0.4);

/**
 * The player's hand at a step of the loop: nobody strums two bars alike. Loudness (±7%) and
 * timing (±8 ms) drift slowly round the 4 bars, with a little grain on top — a person's
 * timing wanders rather than jitters, and listeners prefer that to plain randomness (Hennig
 * et al., PLoS ONE 2011). A fixed curve, not chance: the same on every pass, so the Editor
 * and the posted mix are the same performance.
 */
function feel(step: number): { gain: number; shift: number } {
  const a = (TAU * step) / SYNTH_STEPS;
  const grain = noise(step * 7919 + 13);
  return {
    gain: 1 + 0.05 * (0.6 * Math.sin(a + 1.3) + 0.4 * Math.sin(3 * a + 0.4)) + 0.02 * grain(),
    shift: 0.006 * (0.6 * Math.sin(a + 4.1) + 0.4 * Math.sin(5 * a + 2.2)) + 0.002 * grain(),
  };
}

/** One stroke of the strumming hand (or one picked string). */
export type Stroke = {
  /** The strings it sounds, in the order the hand crosses them. */
  midis: number[];
  gain: number;
  shift: number;
  gap: number;
  mute: boolean;
  /** How hard it is struck, as `Touch.hard`. */
  hard: number;
  /** The longest it may ring, in 16ths. */
  ring: number;
};

/**
 * What the guitar's hand does at a step (0–63) of the loop with the chord on `degree` under
 * it, or null where it passes without touching. `fresh`: the chord was just pressed — that
 * always sounds, a down stroke if the pattern rests there.
 *
 * Which strings a stroke catches is most of what makes strumming sound played:
 * - a down stroke on 2 or 4 is the accent: every string, the fastest sweep;
 * - a down stroke on 1 or 3 leans on the four bass strings (the "boom" to the accent's "chick");
 * - a down stroke between beats (16th patterns) brushes the middle strings;
 * - an up stroke catches only the top strings, high to low, and is lighter — never a down
 *   stroke reversed, which no guitarist plays;
 * - a chuck is every string, muted.
 * The sweep takes 15–25 ms across the strings (slower, ~35 ms, for Single's let-ring strum);
 * under ~10 ms a chord stops sounding strummed, over ~45 ms it turns into a harp.
 */
export function guitarStroke(part: Pick<SynthPart, 'sound' | 'key' | 'strum'>, degree: number, step: number, fresh: boolean): Stroke | null {
  const chord = guitarChord(part.key, degree);
  const at = ((step % SYNTH_STEPS) + SYNTH_STEPS) % SYNTH_STEPS;
  const pos = at % 16;
  const hand = feel(at);
  if (part.sound === 'pick') {
    if (pos % 2 && !fresh) return null;
    const string = fresh || pos % 2 ? 0 : PICK[pos / 2];
    // The thumb's bass notes carry the bar; the fingers are lighter.
    const thumb = string === 0 || string === 1;
    return { midis: [chord[string < 0 ? chord.length + string : string]], gain: (thumb ? 1 : 0.8) * hand.gain, shift: hand.shift, gap: 0, mute: false, hard: 1, ring: 8 };
  }
  const id = strumOf(part);
  let kind = guitarBar(part)[pos];
  if (kind === '.') {
    if (!fresh) return null;
    kind = 'D';
  }
  if (kind === 'X') return { midis: chord, gain: hand.gain, shift: hand.shift, gap: 0.0025, mute: true, hard: 1, ring: 1 };
  if (kind === 'U') {
    return { midis: chord.slice(pos % 2 ? -3 : -4).reverse(), gain: accent(pos) * hand.gain, shift: hand.shift, gap: 0.005, mute: false, hard: hardness(accent(pos)), ring: 8 };
  }
  const all = pos === 4 || pos === 12 || id === 'single';
  const bass = pos % 4 === 0 || fresh;
  const loud = fresh ? Math.max(accent(pos), 0.85) : accent(pos);
  return {
    midis: all ? chord : bass ? chord.slice(0, 4) : chord.slice(1, 5),
    gain: loud * hand.gain,
    shift: hand.shift,
    gap: id === 'single' ? 0.007 : all ? 0.004 : 0.005,
    mute: false,
    hard: all ? 1 : hardness(loud),
    ring: all || bass ? 16 : 8,
  };
}

/**
 * The guitar's played chords as spans of the loop: each starts on an 8th (the hand changes
 * chord with a stroke, and strokes fall on 8ths) and lasts at least one.
 */
export function chordSpans(part: Pick<SynthPart, 'notes'>): SynthNote[] {
  return part.notes
    .filter(n => n.step >= 0 && n.step < SYNTH_STEPS)
    .map(n => ({ step: n.step - (n.step % 2), degree: n.degree, len: Math.min(SYNTH_STEPS, Math.max(2, n.len + (n.len % 2))) }));
}

/**
 * The guitar's loop. One guitar holds one chord at a time: the chord loop gives a chord per
 * bar, and a played chord takes over for as long as it was held (a later one over an earlier
 * one). The strumming pattern then plays whatever chord is under the hand at each step.
 */
function guitarHits(part: SynthPart): SynthHit[][] {
  const out: SynthHit[][] = Array.from({ length: SYNTH_STEPS }, () => []);
  const chordAt: (number | null)[] = Array(SYNTH_STEPS).fill(null);
  const fresh: boolean[] = Array(SYNTH_STEPS).fill(false);
  if (part.chords) chordLoopDegrees(part.chords, part.key).forEach((root, bar) => chordAt.fill(root, bar * 16, bar * 16 + 16));
  for (const n of chordSpans(part)) {
    for (let i = 0; i < n.len; i++) {
      const s = (n.step + i) % SYNTH_STEPS;
      chordAt[s] = n.degree;
      fresh[s] = i === 0;
    }
  }
  const strokes = chordAt.map((d, s) => (d === null ? null : guitarStroke(part, d, s, fresh[s])));
  strokes.forEach((k, s) => {
    if (!k) return;
    // It rings until the next stroke damps it — a picked string, until the chord changes —
    // round the loop, for as long as that stroke can ring.
    const stops = (t: number) =>
      part.sound === 'pick' ? chordAt[t] !== null && (fresh[t] || chordAt[t] !== chordAt[s]) : strokes[t] !== null;
    let gap = 1;
    while (gap < SYNTH_STEPS && !stops((s + gap) % SYNTH_STEPS)) gap++;
    const hit: SynthHit = { midis: k.midis, len: Math.min(gap, k.ring), gain: k.gain, shift: k.shift };
    if (k.gap) hit.gap = k.gap;
    if (k.hard < 1) hit.hard = k.hard;
    if (k.mute) hit.mute = true;
    else if (gap <= k.ring && strokes[(s + gap) % SYNTH_STEPS]?.mute) hit.cut = true;
    out[s].push(hit);
  });
  return out;
}

/**
 * Everything a part plays across its 4-bar loop: index = step (0–63). Chords from high
 * scale degrees are voiced an octave down so the loop stays in one comfortable range.
 */
export function synthHits(part: SynthPart): SynthHit[][] {
  if (isGuitar(part.sound)) return guitarHits(part);
  const out: SynthHit[][] = Array.from({ length: SYNTH_STEPS }, () => []);
  const sound = part.sound;
  const midi = (deg: number) => degreeToMidi(part.key, sound, deg);
  if (part.chords) {
    const roots = chordLoopDegrees(part.chords, part.key);
    roots.forEach((root, bar) => {
      const r = root >= (sound === 'bass' ? 5 : 4) ? root - 7 : root;
      for (const h of CHORD_STYLE[sound]) {
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

/** How long a sound rings after its note is let go, seconds. */
export const RELEASE: Record<SynthSound, number> = { keys: 0.35, pad: 0.7, bass: 0.08, lead: 0.15, strum: 0.25, pick: 0.3 };
/** Per-note level, so a 3–4 note chord stays under full scale (the guitar: see CEILING). */
const LEVEL: Record<SynthSound, number> = { keys: 0.15, pad: 0.3, bass: 0.35, lead: 0.28, strum: 0.5, pick: 0.53 };

/**
 * Samples for notes held `seconds` together, plus the release tail. Deterministic (no
 * randomness), so a part sounds the same in the Editor and in the posted mix.
 */
export function renderSynth(sound: SynthSound, midis: number[], seconds: number, sampleRate: number, touch: Touch = {}): Float32Array {
  if (isGuitar(sound)) return renderGuitar(sound, midis, seconds, sampleRate, touch);
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

type Biquad = ReturnType<typeof lowpass>;

/** RBJ 2-pole high-pass (Q = 0.707). */
function highpass(fc: number, fs: number): Biquad {
  const w = (TAU * fc) / fs;
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  return { b0: (1 + cos) / 2 / a0, b1: -(1 + cos) / a0, b2: (1 + cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

/** RBJ peaking EQ: `gainDb` of boost (or cut) around `fc`. */
function peak(fc: number, q: number, gainDb: number, fs: number): Biquad {
  const a = Math.pow(10, gainDb / 40);
  const w = (TAU * fc) / fs;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  const a0 = 1 + alpha / a;
  return { b0: (1 + alpha * a) / a0, b1: (-2 * cos) / a0, b2: (1 - alpha * a) / a0, a1: (-2 * cos) / a0, a2: (1 - alpha / a) / a0 };
}

/** RBJ high shelf: `gainDb` above `fc` (slope 1). */
function highShelf(fc: number, gainDb: number, fs: number): Biquad {
  const a = Math.pow(10, gainDb / 40);
  const w = (TAU * fc) / fs;
  const cos = Math.cos(w);
  const beta = 2 * Math.sqrt(a) * (Math.sin(w) / 2) * Math.SQRT2;
  const a0 = a + 1 - (a - 1) * cos + beta;
  return {
    b0: (a * (a + 1 + (a - 1) * cos + beta)) / a0,
    b1: (-2 * a * (a - 1 + (a + 1) * cos)) / a0,
    b2: (a * (a + 1 + (a - 1) * cos - beta)) / a0,
    a1: (2 * (a - 1 - (a + 1) * cos)) / a0,
    a2: (a + 1 - (a - 1) * cos - beta) / a0,
  };
}

function filterInPlace(buf: Float32Array, f: Biquad): void {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = f.b0 * x + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    buf[i] = y;
  }
}

// ── guitar ──────────────────────────────────────────────────────────────────

/** Between one string and the next when the stroke doesn't say: six strings in ~25 ms. */
const STRUM_GAP = 0.005;
/** Each string the hand reaches is struck a touch softer than the one before: the first takes the force. */
const FALLOFF = 0.03;
/**
 * No two strings of a strum are hit alike: each gets up to this much more or less force, lands
 * this fraction of the gap early or late, and is caught this far (as a fraction) up or down
 * the string from where the hand aims. Fixed for a given stroke — its own character, the same
 * every time it comes round — so a down stroke on the bass strings and the up stroke after it
 * differ by more than which strings they are. (Measured: the recording's strokes differ from
 * one another by 4 dB in brightness; with every string hit identically ours differed by 1–2.)
 */
const UNEVEN = { force: 0.25, time: 0.35, place: 0.15 };
/**
 * A light stroke is duller, not only quieter: the pick bends the string less sharply and
 * slides off it. On the recording a stroke 1 dB quieter is 0.9 dB duller once it rings. This
 * is the corner (Hz) the lightest pluck is rounded off at; harder ones proportionally higher.
 */
const LIGHT = { hz: 900 };
/** A chuck: how long the muted strings sound, and how fast a chord it lands on is damped, seconds. */
const MUTE_SEC = 0.14;
const CUT_RELEASE = 0.04;

/**
 * THE GUITAR'S TONE IS MEASURED, NOT GUESSED. Everything from here to `pluck` was fitted to a
 * recording of a steel-string acoustic being strummed (a phone video, 2026-11-09): its level
 * in each third of an octave, and how each register fades over the first 150 ms and the next
 * second. Tuned by ear and from papers, the guitar was called "electric" three times running;
 * against the recording it turned out to be 7–10 dB too bright from 400 Hz up, short of the
 * 200–500 Hz that is most of an acoustic's sound, fading four times too fast, and picked at
 * the bridge. It now sits within about 3 dB of the recording throughout. A second pass against
 * the same recording, on what happens inside a stroke and between strokes, found three more:
 * the body's warmth arrived with the pick instead of 20 ms after it (`WOOD`), the pick's noise
 * lingered instead of flashing (`AIR`), and every stroke was as bright as the last (`UNEVEN`,
 * `LIGHT`). So: change a number here only against a recording, measured the same way — not
 * because it "should" sound better. Two things are NOT the recording's, and are the owner's
 * ear instead (2026-11-09, "decrease the treble and increase bass"): the bass below 200 Hz in
 * `WOOD.level` — a phone has none, a guitar does — and `BODY.shelf`, 3.5 dB darker than measured.
 *
 * How the strings are played. `at`: where along the string it is plucked — 0.17 is over the
 * sound hole; nearer 0 is at the bridge, where every overtone is as loud as the note itself
 * (an electric's twang). `bite`: the frequency (Hz) above which the pluck is all click — a
 * pick lets go of the string with a snap — so lower is brighter. `air`: how much the pick
 * hisses across the string. `top`: the highest frequency that leaves the guitar, Hz. A string
 * left to ring dies the way a steel string does (see `pluck`); `ring` and `sheen` are for one
 * that is stopped instead: the seconds it takes to die, and the dB a second its highs lose.
 */
type Tone = { at: number; bite: number; air: number; top: number; ring?: number; sheen?: number };
const TONE: Record<'strum' | 'pick', Tone> = {
  strum: { at: 0.17, bite: 4500, air: 0.55, top: 15000 },
  pick: { at: 0.22, bite: 12000, air: 0.05, top: 13000 },
};
/** Under a resting hand: still a pitch, but gone in a fifth of a second, the highs soonest. */
const MUTED: Tone = { at: 0.17, bite: 8000, air: 0.3, top: 12000, ring: 0.4, sheen: 170 };

/**
 * The guitar's body. A string moves almost no air: heard by itself it is an electric guitar,
 * however it is equalised. An acoustic's sound is the wooden box the strings drive.
 *
 * `WOOD` is the box below ~600 Hz, where most of an acoustic's sound is: the air in it and its
 * plates, ringing at their own pitches. Nothing that low leaves the guitar except through
 * them, and a resonance takes time to get going — so on the recording a stroke's bite (1 kHz
 * up) is there at once and its warmth swells in over the next 20 ms. (With the lows let
 * straight through as well, the two arrived together: a pluck that read as clean but
 * synthetic.) A row of resonances `step` apart from `from` to `to` Hz, each `q` sharp — about
 * 13 ms to build at 220 Hz — and alternately pushing and pulling, as neighbouring plate
 * resonances do, which is also what stops them cancelling between their pitches. `level` is
 * how strong the box is at each pitch [Hz, dB]. The string's force itself passes only above
 * `split`.
 */
const WOOD = {
  from: 105, to: 640, step: 1.09, q: 9.5, split: 680,
  level: [[105, -1], [150, 1], [200, 5], [330, 6], [450, 8], [520, -6], [640, -14]],
};

/**
 * What the box does to everything played through it, as the recording has it:
 * - `low`: nothing below the lowest string.
 * - `dip`: a deep hollow between the plate resonances and the bridge's own, around 800 Hz.
 * - `hill`: the bridge's resonances, 1–2.5 kHz — the "jangle".
 * - `cliff` and `shelf`: above that the box gives less and less, falling away sharply at 3 kHz.
 */
const BODY = { low: 75, dip: { hz: 850, q: 1.0, db: -24 }, hill: { hz: 1600, q: 0.8, db: 6 }, cliff: { hz: 3000, q: 2, db: -5.5 }, shelf: { hz: 2800, db: -17.5 } };

/** How long the body's short resonances ring: the length of its tap, seconds. */
const BODY_SEC = 0.1;
/** The tap by register: how long that part of the body rings, and how strong it is beside the string's own sound. */
const BODY_BANDS = [
  { lo: 250, hi: 1000, tau: 0.018, share: 0.3 },
  { lo: 1000, hi: 3500, tau: 0.009, share: 0.45 },
  { lo: 3500, hi: 9000, tau: 0.004, share: 0.5 },
];
const bodyTaps = new Map<number, Float32Array>();

/**
 * What a tap on the bridge sounds like: the string's own force straight through (above
 * `WOOD.split`), the box's low resonances swelling in under it, and the rustle of hundreds of
 * small plate resonances above them, over in a few hundredths of a second, the high ones
 * first. Those are too many to model one by one and the ear doesn't hear them one by one, so
 * shaped noise stands in — always the same noise: one guitar, not a new one for every note.
 *
 * It comes back as running sums because of how it is used: as the string's pluck, rather than
 * as a filter over every note afterwards ("commuted synthesis", J. O. Smith). String and body
 * are both linear, so body-then-string sounds exactly like string-then-body — and costs
 * nothing per sample. A pluck is flat stretches of force, so pluck ⊛ tap is differences of
 * these sums (see `pluck`).
 */
function bodyTap(sr: number): Float32Array {
  const cached = bodyTaps.get(sr);
  if (cached) return cached;
  const len = Math.max(2, Math.round(BODY_SEC * sr));
  const tap = new Float32Array(len);
  BODY_BANDS.forEach((b, j) => {
    const hi = Math.min(b.hi, sr * 0.45);
    if (hi <= b.lo) return;
    const rnd = noise(9973 + j * 131);
    const band = new Float32Array(len);
    for (let i = 0; i < len; i++) band[i] = rnd();
    filterInPlace(band, highpass(b.lo, sr));
    filterInPlace(band, lowpass(hi, sr));
    let energy = 0;
    for (let i = 0; i < len; i++) {
      band[i] *= Math.exp(-i / (b.tau * sr));
      energy += band[i] * band[i];
    }
    // So that across its band it averages `share` of the direct sound (which is 1 everywhere).
    const fit = energy > 0 ? Math.sqrt((b.share * b.share * (hi - b.lo)) / (sr / 2) / energy) : 0;
    for (let i = 0; i < len; i++) tap[i] += band[i] * fit;
  });
  // The string's own force, above the box's low resonances.
  const direct = new Float32Array(len);
  direct[0] = 1;
  filterInPlace(direct, highpass(WOOD.split, sr));
  for (let i = 0; i < len; i++) tap[i] += direct[i];
  // The box: each resonance is a band-pass ringing on at its pitch.
  const strength = (hz: number) => {
    const pts = WOOD.level;
    let k = 1;
    while (k < pts.length - 1 && hz > pts[k][0]) k++;
    const [f0, d0] = pts[k - 1], [f1, d1] = pts[k];
    const t = Math.min(1, Math.max(0, Math.log(hz / f0) / Math.log(f1 / f0)));
    return Math.pow(10, (d0 + (d1 - d0) * t) / 20);
  };
  // …faded out over the tap's last third, so that cutting it off there is not itself a click.
  const tail = Math.round(len / 3);
  for (let hz = WOOD.from, sign = 1; hz <= WOOD.to && hz < sr * 0.4; hz *= WOOD.step, sign = -sign) {
    const w = (TAU * hz) / sr;
    const alpha = Math.sin(w) / (2 * WOOD.q);
    const b0 = (alpha / (1 + alpha)) * strength(hz) * sign;
    const a1 = (-2 * Math.cos(w)) / (1 + alpha), a2 = (1 - alpha) / (1 + alpha);
    let y1 = 0, y2 = 0;
    for (let i = 0; i < len; i++) {
      // The band-pass of an impulse: b0·(δ[i] − δ[i−2]).
      const y = (i === 0 ? b0 : i === 2 ? -b0 : 0) - a1 * y1 - a2 * y2;
      y2 = y1;
      y1 = y;
      tap[i] += i > len - tail ? (y * (len - i)) / tail : y;
    }
  }
  for (let i = 1; i < len; i++) tap[i] += tap[i - 1];
  bodyTaps.set(sr, tap);
  return tap;
}

/**
 * How a steel string dies. Its overtones go first: `SHEEN` is how many dB a second it loses at
 * `hz` on top of the note's own decay — a plain string (the top two), and a wound one, which
 * is duller — with everything above `corner` going at much the same rate. And a new note
 * drops a little at first, while it is shaking the top hard, before settling into its long
 * ring: `EARLY` is that extra loss, and how long it lasts.
 */
const SHEEN = { hz: 3500, corner: 3000, plain: 60, wound: 75 };
const EARLY = { db: 20, sec: 0.12 };
/**
 * The pick's scrape across the string: a burst of noise between `lo` and `hi` Hz, gone in
 * about `sec`. It is most of a stroke's first instant — on the recording 2.5–5 kHz drops 8 dB
 * in the first 50 ms, far faster than a string's overtones die.
 */
const AIR = { lo: 2500, hi: 4500, sec: 0.015 };
/** The pick's edge takes about 1/this of a second to let the string go: nothing above it in the click. */
const PICK_EDGE_HZ = 16000;
/** No guitar is perfectly in tune: each pitch sits up to this many cents off, always the same way. */
const DETUNE_CENTS = 1.8;

/**
 * A strum (or one picked string). Each string is a Karplus–Strong plucked string — a delay
 * line one period long with the pluck going round it, softened on every pass — plucked with
 * the body's tap, so every note carries the box it is played through. Strings start
 * `touch.gap` apart in the order given (low → high is a down strum), each a little softer than
 * the last and none hit quite like its neighbour (`UNEVEN`). Nothing here is left to chance:
 * the same stroke is the same samples every time.
 */
function renderGuitar(sound: 'strum' | 'pick', midis: number[], seconds: number, sr: number, touch: Touch): Float32Array {
  const rel = touch.mute || touch.cut ? CUT_RELEASE : RELEASE[sound];
  const tone = touch.mute ? MUTED : TONE[sound];
  const held = touch.mute ? MUTE_SEC : seconds;
  const len = Math.max(1, Math.round((held + rel) * sr));
  const out = new Float32Array(len);
  const gap = midis.length > 1 ? (touch.gap ?? STRUM_GAP) * sr : 0;
  const hard = touch.mute ? 1 : touch.hard ?? 1;
  const hand = noise(midis.length * 7919 + midis[0] * 131 + Math.round(gap) * 17 + Math.round(hard * 10));
  midis.forEach((m, s) => {
    const force = (1 - FALLOFF * s) * (1 + UNEVEN.force * hand());
    const start = s ? Math.max(0, Math.round((s + UNEVEN.time * hand()) * gap)) : 0;
    pluck(out, start, m, tone, force, hard, 1 + UNEVEN.place * hand(), sr);
  });

  // The strings are damped when the chord is let go (the next strum, or a lifted finger).
  const letGo = Math.min(len, Math.round(held * sr));
  const fade = Math.exp(-5 / (rel * sr));
  let level = LEVEL[sound];
  for (let i = 0; i < letGo; i++) out[i] *= level;
  for (let i = letGo; i < len; i++) {
    level *= fade;
    out[i] *= level;
  }
  filterInPlace(out, highpass(BODY.low, sr));
  filterInPlace(out, peak(Math.min(BODY.dip.hz, sr * 0.4), BODY.dip.q, BODY.dip.db, sr));
  filterInPlace(out, peak(Math.min(BODY.hill.hz, sr * 0.4), BODY.hill.q, BODY.hill.db, sr));
  filterInPlace(out, peak(Math.min(BODY.cliff.hz, sr * 0.4), BODY.cliff.q, BODY.cliff.db, sr));
  filterInPlace(out, highShelf(Math.min(BODY.shelf.hz, sr * 0.4), BODY.shelf.db, sr));
  filterInPlace(out, lowpass(Math.min(tone.top, sr * 0.45), sr));
  limit(out, CEILING, sr);

  const fin = Math.min(len, Math.round(0.002 * sr));
  for (let i = 0; i < fin; i++) out[i] *= i / fin;
  const fout = Math.min(len, Math.round(0.01 * sr));
  for (let i = 0; i < fout; i++) out[len - 1 - i] *= i / fout;
  return out;
}

/**
 * A strum is mostly its first few milliseconds: six picks landing almost together peak far
 * above the chord that follows. This is the highest a stroke may reach; `limit` turns the
 * very top of the hardest ones down, the way a microphone preamp would, so the guitar can sit
 * as loud as the other instruments without those peaks.
 */
const CEILING = 0.9;

/**
 * Keep `buf` under `ceiling`, in place: the level eases down over the 1.5 ms before a peak
 * and back up over ~50 ms after it — too slowly to bend the wave itself, so nothing is
 * distorted. A stroke that never reaches the ceiling is left exactly as it was.
 */
function limit(buf: Float32Array, ceiling: number, sr: number): void {
  // Plain comparisons, no Math.* per sample: these loops run over every sample of every
  // stroke, and a function call in them cost more than all the strings put together.
  let top = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = buf[i] < 0 ? -buf[i] : buf[i];
    if (a > top) top = a;
  }
  if (top <= ceiling) return;
  // Backwards: the gain each sample needs, reached by a ramp that starts before the peak does.
  const gain = new Float32Array(buf.length);
  const rise = 1 / Math.max(1, Math.round(0.0015 * sr));
  let g = 1;
  for (let i = buf.length - 1; i >= 0; i--) {
    const a = buf[i] < 0 ? -buf[i] : buf[i];
    const need = a > ceiling ? ceiling / a : 1;
    g = need < g + rise ? need : g + rise;
    gain[i] = g;
  }
  // Forwards: let go slowly.
  const hold = Math.exp(-1 / (0.05 * sr));
  g = 1;
  for (let i = 0; i < buf.length; i++) {
    const free = 1 - (1 - g) * hold;
    g = gain[i] < free ? gain[i] : free;
    buf[i] *= g;
  }
}

/**
 * One plucked string at pitch `midi`, added into `out` from sample `start` to the end: `force`
 * is its level, `hard` (0–1) how sharply it is plucked, `place` where along the string the
 * pick catches it, as a multiple of the tone's own `at`.
 */
function pluck(out: Float32Array, start: number, midi: number, tone: Tone, force: number, hard: number, place: number, sr: number): void {
  const hash = Math.sin(midi * 12.9898) * 43758.5453;
  const hz = midiHz(midi + (DETUNE_CENTS / 100) * (2 * (hash - Math.floor(hash)) - 1));
  const period = sr / hz;
  // Loop gain per period for the ring time: ~7.5 s on the low E, ~5 s on the high E.
  const ring = tone.ring ?? Math.min(9, Math.max(4, 7 * Math.pow(110 / hz, 0.25)));
  const loss = Math.exp(-6.9 / (hz * ring));
  // …less the early drop, which fades out as the note settles.
  const early = tone.ring === undefined ? EARLY.db / 8.686 / hz : 0;
  const settle = Math.exp(-1 / (EARLY.sec * sr));
  // The loop filter takes a share `soft` of everything above SHEEN.corner on every pass: a
  // shelf, H = 1 − soft + soft·L, with L a one-pole low-pass. A shelf because a steel string's
  // highs all die at about the same rate (measured: 92, 108 and 123 dB/s at 3.5, 7 and 12 kHz);
  // a filter that keeps cutting harder with frequency leaves nothing above 5 kHz after the
  // first instant, which is a nylon string — or a synth. `soft` is set per string so they die
  // at SHEEN's rate per SECOND: the filter works per pass, and a low string makes far fewer
  // passes a second than a high one.
  const pole = Math.exp((-TAU * Math.min(SHEEN.corner, sr * 0.2)) / sr);
  const shelf = (share: number, w: number) => {
    const dr = 1 - pole * Math.cos(w), di = pole * Math.sin(w);
    const den = dr * dr + di * di;
    const re = 1 - share + (share * (1 - pole) * dr) / den, im = (-share * (1 - pole) * di) / den;
    return { mag: Math.hypot(re, im), delay: -Math.atan2(im, re) / w };
  };
  const wound = Math.min(1, Math.max(0, (62 - midi) / 10));
  const want = Math.pow(10, -(tone.sheen ?? SHEEN.plain + (SHEEN.wound - SHEEN.plain) * wound) / (20 * hz));
  const at = (TAU * Math.min(SHEEN.hz, sr * 0.4)) / sr;
  let lo = 0, hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (shelf(mid, at).mag > want) lo = mid; else hi = mid;
  }
  const soft = (lo + hi) / 2;
  // The delay line is a whole number of samples; the shelf adds a little (worked out at the
  // note's own pitch) and a first-order all-pass the rest, which keeps every string in tune.
  const lag = shelf(soft, TAU / period).delay;
  const n = Math.max(2, Math.floor(period - lag - 0.5));
  const frac = period - lag - n;
  const c = (1 - frac) / (1 + frac);

  // The pluck, as the bridge feels it: the slope of a string pulled into a triangle at `at` —
  // one level up to the pluck point, another after it, zero in all (nothing circulates as DC).
  // Its overtones fall off by 1/n with gaps at the pluck point's nodes, as a real pluck's do.
  // Passed through the body's tap: with the tap as running sums, that is just differences.
  // Plus the snap of the string leaving the pick: a click at each jump in the force, which is
  // what makes the first instant bright (the loop then takes the brightness away again). The
  // click is as wide as a pick's edge, not one sample: an instant one is all peak, and harsh.
  const tap = bodyTap(sr);
  const last = tap.length - 1;
  const sum = (i: number) => (i < 0 ? 0 : tap[i > last ? last : i]);
  const top = Math.min(n - 1, Math.max(1, Math.round(n * tone.at * place)));
  const rest = top / (n - top);
  const snap = (sr / (TAU * tone.bite)) * hard;
  const edge = Math.max(1, Math.round(sr / PICK_EDGE_HZ));
  const click = (i: number) => (sum(i) - sum(i - edge)) / edge;
  const pick = new Float32Array(tap.length + n);
  for (let i = 0; i < pick.length; i++) {
    pick[i] = sum(i) - sum(i - top) - rest * (sum(i - top) - sum(i - n))
      + snap * (click(i) - (1 + rest) * click(i - top) + rest * click(i - n));
  }
  if (hard < 1) {
    const keep = 1 - Math.exp((-TAU * Math.min(LIGHT.hz / (1 - hard), sr * 0.4)) / sr);
    let round = 0;
    for (let i = 0; i < pick.length; i++) {
      round += keep * (pick[i] - round);
      pick[i] = round;
    }
  }

  const line = new Float32Array(n);
  let idx = 0, dull = 0, apX = 0, apY = 0, young = 1;
  for (let i = start, k = 0; i < out.length; i++, k++) {
    const d = line[idx];
    dull += (1 - pole) * (d - dull);
    const f = (d - soft * (d - dull)) * loss * (1 - early * young);
    young *= settle;
    const ap = c * f + apX - c * apY;
    apX = f; apY = ap;
    const y = k < pick.length ? ap + pick[k] : ap;
    line[idx] = y;
    idx = idx + 1 === n ? 0 : idx + 1;
    out[i] += y * force;
  }
  // The pick scraping across the string: a breath of hiss, gone in a few hundredths of a second.
  const rnd = noise(Math.round(midi) * 977 + 3);
  const hiss = Math.min(out.length - start, Math.round(AIR.sec * 5 * sr));
  const cut = 1 - Math.exp((-TAU * Math.min(AIR.lo, sr * 0.3)) / sr);
  const pass = 1 - Math.exp((-TAU * Math.min(AIR.hi, sr * 0.4)) / sr);
  const thin = Math.exp(-1 / (AIR.sec * sr));
  let low = 0, band = 0, breath = tone.air * force * hard;
  for (let k = 0; k < hiss; k++) {
    const v = rnd();
    low += cut * (v - low);
    band += pass * (v - low - band);
    out[start + k] += band * breath;
    breath *= thin;
  }
}

// ── drafts ──────────────────────────────────────────────────────────────────

const isSound = (x: unknown): x is SynthSound => SYNTH_SOUNDS.includes(x as SynthSound);
const isLoop = (x: unknown): x is ChordLoopId => CHORD_LOOPS.some(c => c.id === x);
const isStrum = (x: unknown): x is StrumId => STRUMS.some(c => c.id === x);
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
    // A guitar chord can be held (and strummed) for the whole loop; a note, for a bar.
    const longest = isGuitar(s.sound) ? SYNTH_STEPS : MAX_NOTE_STEPS;
    const notes = Array.isArray(s.notes)
      ? s.notes.filter(n => n && int(n.step, 0, SYNTH_STEPS - 1) && int(n.degree, -7, 14) && int(n.len, 1, longest))
        .map(n => ({ step: n.step, degree: n.degree, len: n.len }))
      : [];
    const volume = typeof s.volume === 'number' && s.volume >= 0 && s.volume <= 3 ? s.volume : 0.8;
    const part: SynthPart = { id: s.id, sound: s.sound, key: { tonic: k.tonic, mode: k.mode }, volume, chords: isLoop(s.chords) ? s.chords : null, notes };
    if (s.sound === 'strum' && isStrum(s.strum)) part.strum = s.strum;
    out.push(part);
  }
  return out;
}
