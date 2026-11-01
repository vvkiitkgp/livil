/**
 * Pitch detection for Magic Tune (the Editor's pitch correction).
 *
 * YIN (de Cheveigné & Kawahara, 2002) on a decimated copy of the take. Pure TypeScript,
 * no audio engine: it reads a Float32Array and never touches GlobalAudioPlayer or the
 * OS audio session (ADR-0034, ADR-0035).
 *
 * Cost is the reason for every constant here. Hermes has no JIT, so the analysis rate is
 * ~11–12 kHz (a voice's fundamental tops out near 1 kHz) and silent frames are skipped
 * before the O(W·τ) difference function runs.
 */

export type PitchTrack = {
  /** Fundamental per frame in Hz; 0 = unvoiced or silent. */
  f0: Float32Array;
  /** Frame spacing, in samples of the ORIGINAL sample rate. */
  hop: number;
  /** Original-rate sample index that frame 0 describes (its window centre). */
  offset: number;
  sampleRate: number;
};

export const MIN_HZ = 70;
export const MAX_HZ = 1000;
const ANALYSIS_TARGET_RATE = 11025;
const WINDOW = 384;
const HOP = 160;
const YIN_THRESHOLD = 0.15;
/** RMS below this (about −46 dBFS) is treated as silence and not analysed. */
const SILENCE_RMS = 0.005;

/** Boxcar decimation. Crude, but YIN only needs the fundamental, not a clean spectrum. */
export function decimate(x: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return x;
  const out = new Float32Array(Math.floor(x.length / factor));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    const base = i * factor;
    for (let k = 0; k < factor; k++) s += x[base + k];
    out[i] = s / factor;
  }
  return out;
}

/** One YIN estimate for the window starting at `start`; 0 when no period is found. */
export function yinFrame(
  a: Float32Array,
  start: number,
  rate: number,
  diff: Float32Array,
): number {
  const tauMin = Math.max(2, Math.floor(rate / MAX_HZ));
  const tauMax = Math.min(diff.length - 1, Math.ceil(rate / MIN_HZ));
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let j = 0; j < WINDOW; j++) {
      const d = a[start + j] - a[start + j + tau];
      s += d * d;
    }
    diff[tau] = s;
  }
  // Cumulative mean normalised difference, in place.
  let running = 0;
  diff[0] = 1;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += diff[tau];
    diff[tau] = running > 0 ? (diff[tau] * tau) / running : 1;
  }
  let tau = tauMin;
  for (; tau <= tauMax; tau++) {
    if (diff[tau] < YIN_THRESHOLD) {
      while (tau + 1 <= tauMax && diff[tau + 1] < diff[tau]) tau++;
      break;
    }
  }
  if (tau > tauMax) return 0;
  // Parabolic interpolation around the minimum for sub-sample accuracy.
  let better = tau;
  if (tau > 1 && tau < tauMax) {
    const s0 = diff[tau - 1];
    const s1 = diff[tau];
    const s2 = diff[tau + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) better = tau + (s2 - s0) / denom;
  }
  return rate / better;
}

function median5(v: Float32Array): Float32Array {
  const out = new Float32Array(v.length);
  const win: number[] = [];
  for (let i = 0; i < v.length; i++) {
    if (v[i] <= 0) { out[i] = 0; continue; }
    win.length = 0;
    for (let k = i - 2; k <= i + 2; k++) if (k >= 0 && k < v.length && v[k] > 0) win.push(v[k]);
    win.sort((p, q) => p - q);
    out[i] = win[win.length >> 1];
  }
  return out;
}

/** Drops voiced islands shorter than `minFrames` (clicks, consonant blips). */
function dropIslands(v: Float32Array, minFrames: number): void {
  let i = 0;
  while (i < v.length) {
    if (v[i] <= 0) { i++; continue; }
    let j = i;
    while (j < v.length && v[j] > 0) j++;
    if (j - i < minFrames) for (let k = i; k < j; k++) v[k] = 0;
    i = j;
  }
}

/**
 * Pitch track for a mono take. Async and chunked so a long take keeps the UI (and the
 * progress bar) alive: it yields to the event loop every `yieldEvery` frames.
 */
export async function detectPitch(
  x: Float32Array,
  sampleRate: number,
  onProgress?: (fraction: number) => void,
  yieldEvery = 400,
): Promise<PitchTrack> {
  const factor = Math.max(1, Math.floor(sampleRate / ANALYSIS_TARGET_RATE));
  const rate = sampleRate / factor;
  const a = decimate(x, factor);
  const tauMax = Math.ceil(rate / MIN_HZ);
  const diff = new Float32Array(tauMax + 2);
  const frames = Math.max(0, Math.floor((a.length - WINDOW - tauMax - 1) / HOP) + 1);
  const raw = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const start = f * HOP;
    let e = 0;
    for (let j = 0; j < WINDOW; j++) e += a[start + j] * a[start + j];
    raw[f] = Math.sqrt(e / WINDOW) < SILENCE_RMS ? 0 : yinFrame(a, start, rate, diff);
    if (onProgress && yieldEvery > 0 && f % yieldEvery === yieldEvery - 1) {
      onProgress(f / frames);
      await new Promise<void>(r => setTimeout(r, 0));
    }
  }
  const f0 = median5(raw);
  dropIslands(f0, 3);
  onProgress?.(1);
  return { f0, hop: HOP * factor, offset: (WINDOW / 2) * factor, sampleRate };
}

/** Frame index describing original-rate sample `n`, clamped. */
export function frameAt(track: PitchTrack, n: number): number {
  const i = Math.round((n - track.offset) / track.hop);
  return i < 0 ? 0 : i >= track.f0.length ? track.f0.length - 1 : i;
}
