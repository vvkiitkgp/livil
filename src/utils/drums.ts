/**
 * The Editor's drum kit: four synthesised one-shots and a one-bar, 16-step pattern that
 * loops under the song. Pure — returns samples; the Editor's engine plays them.
 * Synthesised rather than bundled so the prototype ships no audio assets.
 */

export type DrumId = 'kick' | 'snare' | 'hat' | 'clap';
export const DRUM_IDS: DrumId[] = ['kick', 'snare', 'hat', 'clap'];
export const DRUM_NAMES: Record<DrumId, string> = { kick: 'Kick', snare: 'Snare', hat: 'Hat', clap: 'Clap' };
export const STEPS = 16;

export type DrumPattern = Record<DrumId, boolean[]>;

/** Deterministic noise so a kit sounds the same every launch (and tests are stable). */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2147483648 - 1;
  };
}

export function synthDrum(id: DrumId, sampleRate: number): Float32Array {
  const sr = sampleRate;
  const len = Math.round(sr * (id === 'kick' ? 0.45 : id === 'hat' ? 0.07 : id === 'clap' ? 0.25 : 0.22));
  const out = new Float32Array(len);
  const rnd = noise(id.length * 7919);
  if (id === 'kick') {
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const hz = 45 + 110 * Math.exp(-t * 30);
      phase += (2 * Math.PI * hz) / sr;
      out[i] = Math.sin(phase) * Math.exp(-t * 7) * 0.95;
    }
  } else if (id === 'snare') {
    let prev = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const n = rnd();
      const hp = n - prev; // one-pole high-pass: brighter rattle
      prev = n;
      out[i] = (hp * 0.25 * Math.exp(-t * 18) + Math.sin(2 * Math.PI * 185 * t) * 0.45 * Math.exp(-t * 25)) * 0.9;
    }
  } else if (id === 'hat') {
    let prev = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const n = rnd();
      const hp = n - prev;
      prev = n;
      out[i] = hp * 0.35 * Math.exp(-t * 60);
    }
  } else {
    // Clap: three quick bursts, then a tail.
    const bursts = [0, 0.011, 0.022];
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let env = 0;
      for (const b of bursts) if (t >= b) env = Math.max(env, Math.exp(-(t - b) * 140));
      env = Math.max(env, t >= 0.03 ? 0.55 * Math.exp(-(t - 0.03) * 16) : 0);
      out[i] = rnd() * env * 0.6;
    }
  }
  // Levels: each hit peaks well under full scale (kick −6 dBFS), so a kick, snare and clap on
  // the same step plus a voice don't pile past the top — they used to reach +5 dBFS together.
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
  const scale = peak > 0 ? DRUM_PEAK[id] / peak : 0;
  // 10 ms fade at the end: the kick used to stop at −28 dBFS, an off-beat tick after every hit.
  const fade = Math.min(len, Math.round(0.01 * sr));
  for (let i = 0; i < len; i++) out[i] *= scale * (i >= len - fade ? (len - 1 - i) / fade : 1);
  return out;
}

/** Each drum's peak level (linear, 0.5 = −6 dBFS). */
const DRUM_PEAK: Record<DrumId, number> = { kick: 0.5, snare: 0.35, hat: 0.2, clap: 0.3 };

const row = (s: string) => s.split('').map(c => c === 'x');

export function emptyPattern(): DrumPattern {
  return { kick: Array(STEPS).fill(false), snare: Array(STEPS).fill(false), hat: Array(STEPS).fill(false), clap: Array(STEPS).fill(false) };
}

/**
 * One-bar starting points. They change the PATTERN only, never the tempo: the song's BPM is
 * what the voices were recorded to, and a voice doesn't speed up with it (a "Trap" tap once
 * moved a 92 BPM take to 140, 2026-10-31).
 */
export const DRUM_PRESETS: { name: string; pattern: DrumPattern }[] = [
  {
    name: 'Trap',
    pattern: { kick: row('x......x..x.....'), snare: row('........x.......'), hat: row('x.x.x.xxx.x.x.xx'), clap: row('........x.......') },
  },
  {
    name: 'Boom bap',
    pattern: { kick: row('x.....x...x.....'), snare: row('....x.......x...'), hat: row('x.x.x.x.x.x.x.x.'), clap: row('................') },
  },
  {
    name: 'Pop',
    pattern: { kick: row('x...x...x...x...'), snare: row('....x.......x...'), hat: row('..x...x...x...x.'), clap: row('............x...') },
  },
];

export function clonePattern(p: DrumPattern): DrumPattern {
  return { kick: [...p.kick], snare: [...p.snare], hat: [...p.hat], clap: [...p.clap] };
}

/** Quantise a position (seconds into the loop) to the nearest of the 16 steps. */
export function nearestStep(posInBarSec: number, bpm: number): number {
  const stepSec = 60 / bpm / 4;
  return ((Math.round(posInBarSec / stepSec) % STEPS) + STEPS) % STEPS;
}

/**
 * Metronome click: a 35 ms sine blip, higher on beat 1 of the bar. Played only into
 * headphones while recording — on the speaker the mic would record it (see RecordPanel).
 */
export function synthClick(accent: boolean, sampleRate: number): Float32Array {
  const len = Math.round(sampleRate * 0.035);
  const out = new Float32Array(len);
  const hz = accent ? 1760 : 1175;
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    out[i] = Math.sin(2 * Math.PI * hz * t) * Math.exp(-t * 110) * 0.8;
  }
  return out;
}

/** Output ports that keep a click out of the phone's own mic (iOS port types, Android names). */
export function isPrivateOutput(category: string): boolean {
  return /headphone|headset|bluetooth|usb|hearing/i.test(category);
}
