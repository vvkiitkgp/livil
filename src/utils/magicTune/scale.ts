/** Keys and note snapping for Magic Tune. Pure. */
import type { PitchTrack } from './pitch';

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export type Key = { tonic: number; mode: 'major' | 'minor' | 'chromatic' };

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

export const CHROMATIC: Key = { tonic: 0, mode: 'chromatic' };

export function keyName(k: Key): string {
  if (k.mode === 'chromatic') return 'Every note';
  return `${NOTE_NAMES[k.tonic]} ${k.mode}`;
}

export function sameKey(a: Key, b: Key): boolean {
  return a.mode === b.mode && (a.mode === 'chromatic' || a.tonic === b.tonic);
}

export function scaleOf(k: Key): boolean[] {
  const on = new Array<boolean>(12).fill(k.mode === 'chromatic');
  if (k.mode !== 'chromatic') for (const s of k.mode === 'major' ? MAJOR : MINOR) on[(k.tonic + s) % 12] = true;
  return on;
}

export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);
export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Nearest MIDI note (integer) whose pitch class is in the key. Ties go down. */
export function snapMidi(midi: number, scale: boolean[]): number {
  const base = Math.round(midi);
  for (let d = 0; d <= 6; d++) {
    const cands = midi - base >= 0 ? [base - d, base + d] : [base + d, base - d];
    let best = Number.NaN;
    for (const c of cands) {
      if (!scale[((c % 12) + 12) % 12]) continue;
      if (Number.isNaN(best) || Math.abs(c - midi) < Math.abs(best - midi)) best = c;
    }
    if (!Number.isNaN(best)) return best;
  }
  return base;
}

// Krumhansl–Kessler key profiles.
const PROFILE_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const PROFILE_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(hist: number[], profile: number[], tonic: number): number {
  const n = 12;
  let mh = 0, mp = 0;
  for (let i = 0; i < n; i++) { mh += hist[i]; mp += profile[i]; }
  mh /= n; mp /= n;
  let num = 0, dh = 0, dp = 0;
  for (let i = 0; i < n; i++) {
    const h = hist[(i + tonic) % n] - mh;
    const p = profile[i] - mp;
    num += h * p; dh += h * h; dp += p * p;
  }
  return dh > 0 && dp > 0 ? num / Math.sqrt(dh * dp) : 0;
}

/** Pitch-class histogram of the voiced frames, weighted by how long each was held. */
export function pitchClassHistogram(track: PitchTrack): number[] {
  const hist = new Array<number>(12).fill(0);
  for (let i = 0; i < track.f0.length; i++) {
    const hz = track.f0[i];
    if (hz <= 0) continue;
    const pc = ((Math.round(hzToMidi(hz)) % 12) + 12) % 12;
    hist[pc] += 1;
  }
  return hist;
}

/** All 24 major/minor keys ranked by fit to the take, best first. */
export function rankKeys(track: PitchTrack): Key[] {
  const hist = pitchClassHistogram(track);
  const scored: { k: Key; s: number }[] = [];
  for (let t = 0; t < 12; t++) {
    scored.push({ k: { tonic: t, mode: 'major' }, s: correlate(hist, PROFILE_MAJOR, t) });
    scored.push({ k: { tonic: t, mode: 'minor' }, s: correlate(hist, PROFILE_MINOR, t) });
  }
  scored.sort((p, q) => q.s - p.s);
  return scored.map(x => x.k);
}
