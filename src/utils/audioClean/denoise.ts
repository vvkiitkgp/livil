/**
 * "Clean up background": removes STEADY room noise (fan, AC, hum, hiss) and turns the room
 * down between sung lines. Pure TypeScript STFT spectral gating, no ML, no native code.
 *
 * - Noise profile: the average spectrum of the quietest 10% of the take — the room as it
 *   sounds between your lines. No separate silent recording needed. A take with no real
 *   gaps gets little or no cleanup, so a long held note is never mistaken for noise.
 * - Gain: oversubtraction against that profile with a floor (never fully muted, which
 *   sounds unnatural), smoothed across neighbouring bands and released slowly over time
 *   so it does not "warble" (musical noise).
 * Changing noise (talking, TV, traffic) is NOT handled; that needs an ML denoiser.
 */
import { fft } from './fft';

/** Share of the take's frames treated as "the room with nobody singing". */
const QUIET_SHARE = 0.1;

export async function cleanBackground(
  x: Float32Array,
  sampleRate: number,
  strength = 0.8,
  onProgress?: (fraction: number) => void,
  yieldEvery = 120,
): Promise<Float32Array> {
  const N = sampleRate > 32000 ? 1024 : 512;
  const hop = N / 2;
  const bins = N / 2 + 1;
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); // sqrt-Hann: perfect OLA at 50%
  const frames = Math.ceil((x.length + N) / hop);
  const at = (f: number) => f * hop - N / 2;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const load = (f: number) => {
    const s = at(f);
    for (let i = 0; i < N; i++) {
      const j = s + i;
      re[i] = j >= 0 && j < x.length ? x[j] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
  };
  const total = frames + Math.ceil(frames * QUIET_SHARE);
  let done = 0;
  const tickProgress = async () => {
    done++;
    if (onProgress && yieldEvery > 0 && done % yieldEvery === 0) {
      onProgress(done / total);
      await new Promise<void>(r => setTimeout(r, 0));
    }
  };

  // Pass 1: the noise profile is the average spectrum of the QUIETEST frames (the gaps
  // between lines). Frame loudness is measured in the time domain, so only those frames
  // need an FFT. Frames hanging off either end are skipped (their zero padding is not
  // "quiet room").
  const inner: { f: number; e: number }[] = [];
  for (let f = 0; f < frames; f++) {
    const st = at(f);
    if (st < 0 || st + N > x.length) continue;
    let e = 0;
    for (let i = 0; i < N; i++) e += x[st + i] * x[st + i];
    inner.push({ f, e: e / N });
  }
  const noise = new Float64Array(bins);
  let confidence = 0;
  if (inner.length >= 4) {
    const sorted = [...inner].sort((p, q) => p.e - q.e);
    const quiet = sorted.slice(0, Math.max(2, Math.floor(sorted.length * QUIET_SHARE)));
    for (const { f } of quiet) {
      load(f);
      for (let k = 0; k < bins; k++) noise[k] += (re[k] * re[k] + im[k] * im[k]) / quiet.length;
      await tickProgress();
    }
    // How much louder the typical frame is than the gaps. A take with no real gaps
    // (one long held note, or silence-free singing) has nothing to learn the room from,
    // so the cleanup fades out instead of eating the voice.
    const quietE = quiet.reduce((m, q) => m + q.e, 0) / quiet.length;
    const medianE = sorted[sorted.length >> 1].e;
    const gapDb = 10 * Math.log10((medianE + 1e-20) / (quietE + 1e-20));
    confidence = Math.min(1, Math.max(0, (gapDb - 6) / 9));
  }

  // Pass 2: gate every frame and overlap-add.
  const s = Math.min(1, Math.max(0, strength)) * confidence;
  if (s === 0) { onProgress?.(1); return new Float32Array(x); }
  const over = 1.5 + 2.5 * s;
  const floor = Math.pow(10, -(6 + 16 * s) / 20);
  const release = 0.6;
  const out = new Float32Array(x.length);
  const gain = new Float64Array(bins);
  const prev = new Float64Array(bins).fill(1);
  for (let f = 0; f < frames; f++) {
    load(f);
    for (let k = 0; k < bins; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      gain[k] = Math.max(floor, 1 - (over * noise[k]) / (p + 1e-20));
    }
    for (let k = 0; k < bins; k++) {
      const g = (gain[Math.max(0, k - 1)] + 2 * gain[k] + gain[Math.min(bins - 1, k + 1)]) / 4;
      const sm = g >= prev[k] ? g : release * prev[k] + (1 - release) * g; // open fast, close slowly
      prev[k] = sm;
      re[k] *= sm; im[k] *= sm;
      if (k > 0 && k < N / 2) { re[N - k] *= sm; im[N - k] *= sm; }
    }
    fft(re, im, true);
    const st = at(f);
    for (let i = 0; i < N; i++) {
      const j = st + i;
      if (j >= 0 && j < out.length) out[j] += re[i] * win[i];
    }
    await tickProgress();
  }
  onProgress?.(1);
  return out;
}
