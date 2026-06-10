import { decodeAudioData } from 'react-native-audio-api';
import FFT from 'fft.js';

/**
 * Beat-synced visualizer analysis (Tier B).
 *
 * Pure decode + DSP: turn an audio source into a compact PER-TRACK feature set the
 * floating-player wave rides at the live position. Decoding uses the phone's
 * HARDWARE decoder via react-native-audio-api's standalone `decodeAudioData` — a
 * one-shot decode (no AudioContext, no playback, no MediaSession), so it never
 * touches the patched single-engine (GlobalAudioPlayer / react-native-video).
 *
 * v2 (frequency-aware) — the wave should BEAT and SPEED UP, not just breathe:
 *   - `peaks`    broadband RMS loudness (kept as the v1 fallback channel)
 *   - `bass`     50–150 Hz energy        → the wave's resting swell
 *   - `flux`     low-band spectral flux  → the onset/"kick" that makes it PUNCH
 *   - `centroid` spectral brightness     → drives SCROLL SPEED (high notes → faster)
 * All normalized 0..1, ~15 buckets/sec, spanning the FULL track.
 *
 * This module has NO Supabase imports on purpose — the DB read/write + cache live
 * in `tracks.ts` (getWaveformPeaks / backfillWaveformPeaks / getOrAnalyzeWaveform),
 * so there is no circular import (tracks → waveform only).
 */

/** Stored on tracks.waveform_peaks as jsonb. All arrays span the FULL track. */
export type WaveformData = {
  /** Analyzer version — a stored row with version < WAVEFORM_VERSION is re-analyzed. */
  version: number;
  /** Buckets per second — position→index is `floor(positionSec * hz)`. */
  hz: number;
  /** Analysis sample rate (informational; v2). */
  sr?: number;
  /** Normalized 0..1 broadband loudness per bucket (always present; v1 fallback). */
  peaks: number[];
  /** v2: normalized 0..1 bass (50–150 Hz) energy per bucket. */
  bass?: number[];
  /** v2: normalized 0..1 low-band onset (spectral flux) per bucket — the "kick". */
  flux?: number[];
  /** v2: normalized 0..1 brightness (spectral centroid) per bucket — drives speed. */
  centroid?: number[];
};

/** Per-position features the renderer reads each tick. */
export type WaveFeatures = {
  /** Broadband loudness 0..1 (fallback amplitude source). */
  loud: number;
  /** Bass energy 0..1 — resting amplitude. */
  bass: number;
  /** Onset 0..1 (crisp, not interpolated) — gates the punch kick. */
  flux: number;
  /** Brightness 0..1 — scroll speed. */
  centroid: number;
};

/**
 * Bump when the analysis output changes so old rows re-derive. v2 added the
 * frequency channels (bass/flux/centroid) + 16 kHz decode + 15 Hz buckets.
 */
export const WAVEFORM_VERSION = 2;

/** ~15 buckets/sec — tight enough that kicks land crisply, still only tens of KB. */
export const WAVEFORM_HZ = 15;

/**
 * Analyze at 16 kHz (Nyquist 8 kHz): captures bass/beat fully AND keeps a usable
 * brightness signal up to ~7 kHz so "singer goes high → faster" actually reacts.
 * (8 kHz saturated the centroid; 22 kHz doubles PCM for negligible gain.)
 */
const TARGET_SAMPLE_RATE = 16000;

// FFT: 1024-pt window (~64 ms @16 kHz) with 75% overlap → ~62.5 frames/sec, i.e.
// ~4 FFT frames per 15 Hz bucket — enough to MAX a transient kick within a bucket.
const FFT_SIZE = 1024;
const FFT_HOP = 256;

const BASS_LO_HZ = 50;
const BASS_HI_HZ = 150;
// Onset is detected on the low band where kicks/beats dominate.
const FLUX_LO_HZ = 30;
const FLUX_HI_HZ = 200;

/** Normalize against a high percentile (not the max) so one transient spike
 *  doesn't flatten the whole channel. */
const NORMALIZE_PERCENTILE = 0.95;
/** Perceptual lift (<1): brightens quiet sections so the line still moves softly. */
const ENVELOPE_GAMMA = 0.65;
/** Below this 95th-percentile RMS we treat the track as silence/noise and skip it
 *  (→ decorative wave) rather than animating quantization noise. */
const RMS_SILENCE_FLOOR = 0.004;
/** Skip analysis for very long tracks — bounds the decode memory + work so we
 *  never risk an OOM / multi-second stall (they fall back to the decorative wave). */
const MAX_ANALYZE_SECONDS = 600; // 10 min — covers virtually every song
/** Yield to the event loop every N FFT frames so the analysis pass NEVER blocks
 *  the JS thread (UI / audio-engine callbacks) even on a 10-minute track. */
const YIELD_EVERY_FRAMES = 128;

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Value at fractional index p (0..len-1) of a sorted ascending array. */
function percentileOfSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) { return 0; }
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx] ?? 0;
}

/** Normalize a channel against its own 95th percentile, optional gamma, round to 3dp. */
function normalizeChannel(raw: Float32Array, gamma: number): number[] {
  const sorted = Array.from(raw).sort((a, b) => a - b);
  const ref = percentileOfSorted(sorted, NORMALIZE_PERCENTILE);
  const out: number[] = new Array(raw.length);
  if (ref <= 0) {
    for (let i = 0; i < raw.length; i++) { out[i] = 0; }
    return out;
  }
  for (let i = 0; i < raw.length; i++) {
    const v = gamma === 1 ? clamp01(raw[i]! / ref) : Math.pow(clamp01(raw[i]! / ref), gamma);
    out[i] = Math.round(v * 1000) / 1000;
  }
  return out;
}

/** Map a channel onto [p5..p95] → [0..1] (min-max-ish) — used for brightness so a
 *  consistently-bright track still varies across ITS OWN range. */
function normalizeRange(raw: Float32Array): number[] {
  const sorted = Array.from(raw).sort((a, b) => a - b);
  const lo = percentileOfSorted(sorted, 0.05);
  const hi = percentileOfSorted(sorted, 0.95);
  const span = hi - lo;
  const out: number[] = new Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const v = span > 0 ? clamp01((raw[i]! - lo) / span) : 0.5;
    out[i] = Math.round(v * 1000) / 1000;
  }
  return out;
}

/**
 * Decode `source` (a local file:// path at upload OR a remote URL on lazy
 * backfill — `decodeAudioData` accepts both) and compute the v2 feature set.
 * Returns null on any failure (decode error, unsupported container, or silence) —
 * callers leave waveform_peaks null and the wave keeps its decorative animation.
 * Never throws. Runs once per track (upload / first play), off the playback path.
 */
export async function analyzeWaveformPeaks(source: string): Promise<WaveformData | null> {
  if (!source) { return null; }
  try {
    const buffer = await decodeAudioData(source, TARGET_SAMPLE_RATE);
    const frames = buffer.length;
    const channels = buffer.numberOfChannels;
    const rate = buffer.sampleRate || TARGET_SAMPLE_RATE;
    if (frames <= 0 || channels <= 0) { return null; }
    if (frames / rate > MAX_ANALYZE_SECONDS) {
      console.log(`[LIVIL][WAVE] skip analysis: ${(frames / rate).toFixed(0)}s > ${MAX_ANALYZE_SECONDS}s cap`);
      return null;
    }

    // Downmix to one mono buffer (average channels) — used by both RMS and FFT.
    const mono = new Float32Array(frames);
    if (channels === 1) {
      mono.set(buffer.getChannelData(0));
    } else {
      const chans: Float32Array[] = [];
      for (let c = 0; c < channels; c++) { chans.push(buffer.getChannelData(c)); }
      for (let i = 0; i < frames; i++) {
        let s = 0;
        for (let c = 0; c < channels; c++) { s += chans[c]![i]!; }
        mono[i] = s / channels;
      }
    }

    const hz = WAVEFORM_HZ;
    const samplesPerBucket = Math.max(1, Math.round(rate / hz));
    const bucketCount = Math.max(1, Math.ceil(frames / samplesPerBucket));

    // --- broadband RMS per bucket (loudness fallback) ---
    const rms = new Float32Array(bucketCount);
    for (let b = 0; b < bucketCount; b++) {
      const start = b * samplesPerBucket;
      const end = Math.min(start + samplesPerBucket, frames);
      let sumSq = 0;
      for (let i = start; i < end; i++) { const s = mono[i]!; sumSq += s * s; }
      const n = end - start;
      rms[b] = n > 0 ? Math.sqrt(sumSq / n) : 0;
    }

    // --- FFT pass: bass / flux / centroid per bucket ---
    const binHz = rate / FFT_SIZE;
    const bassLo = Math.max(1, Math.floor(BASS_LO_HZ / binHz));
    const bassHi = Math.min(FFT_SIZE / 2, Math.ceil(BASS_HI_HZ / binHz));
    const fluxLo = Math.max(1, Math.floor(FLUX_LO_HZ / binHz));
    const fluxHi = Math.min(FFT_SIZE / 2, Math.ceil(FLUX_HI_HZ / binHz));
    const nyquistBin = FFT_SIZE / 2;

    // Precompute Hann window.
    const hann = new Float32Array(FFT_SIZE);
    for (let j = 0; j < FFT_SIZE; j++) { hann[j] = 0.5 * (1 - Math.cos((2 * Math.PI * j) / (FFT_SIZE - 1))); }

    const fft = new FFT(FFT_SIZE);
    const out = fft.createComplexArray();
    const win = new Array<number>(FFT_SIZE);
    const mag = new Float32Array(nyquistBin + 1);
    const prevLow = new Float32Array(fluxHi - fluxLo + 1); // previous-frame low-band magnitudes
    let havePrev = false;

    const bassAcc = new Float64Array(bucketCount);
    const centAcc = new Float64Array(bucketCount);
    const cnt = new Int32Array(bucketCount);
    const fluxMax = new Float32Array(bucketCount);

    let sinceYield = 0;
    for (let start = 0; start + FFT_SIZE <= frames; start += FFT_HOP) {
      // Cooperative yield: the FFT pass is the heavy part (thousands of FFTs on a
      // long track). Yielding keeps the JS thread responsive so a cache-miss
      // re-analysis on play never stalls the UI or the audio engine.
      if (++sinceYield >= YIELD_EVERY_FRAMES) {
        sinceYield = 0;
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      for (let j = 0; j < FFT_SIZE; j++) { win[j] = mono[start + j]! * hann[j]!; }
      fft.realTransform(out, win);

      // magnitudes for bins 0..nyquist
      for (let k = 0; k <= nyquistBin; k++) {
        const re = out[2 * k]!;
        const im = out[2 * k + 1]!;
        mag[k] = Math.sqrt(re * re + im * im);
      }

      let bassSum = 0;
      for (let k = bassLo; k <= bassHi; k++) { bassSum += mag[k]!; }

      let fluxSum = 0;
      for (let k = fluxLo; k <= fluxHi; k++) {
        const m = mag[k]!;
        const diff = m - prevLow[k - fluxLo]!;
        if (havePrev && diff > 0) { fluxSum += diff; }
        prevLow[k - fluxLo] = m;
      }
      havePrev = true;

      let cNum = 0;
      let cDen = 0;
      for (let k = 1; k <= nyquistBin; k++) { const m = mag[k]!; cNum += k * binHz * m; cDen += m; }
      const centroid = cDen > 0 ? cNum / cDen : 0;

      const tSec = (start + FFT_SIZE / 2) / rate;
      const b = Math.min(bucketCount - 1, Math.floor(tSec * hz));
      bassAcc[b] += bassSum;
      centAcc[b] += centroid;
      cnt[b] += 1;
      if (fluxSum > fluxMax[b]!) { fluxMax[b] = fluxSum; }
    }

    const bassRaw = new Float32Array(bucketCount);
    const centRaw = new Float32Array(bucketCount);
    for (let b = 0; b < bucketCount; b++) {
      const c = cnt[b]!;
      bassRaw[b] = c > 0 ? bassAcc[b]! / c : 0;
      centRaw[b] = c > 0 ? centAcc[b]! / c : 0;
    }

    // RMS reference doubles as the silence/noise gate — skip near-silent tracks
    // (e.g. RMS ~0.001 everywhere) so we don't animate quantization noise.
    const rmsSorted = Array.from(rms).sort((a, b) => a - b);
    if (percentileOfSorted(rmsSorted, NORMALIZE_PERCENTILE) < RMS_SILENCE_FLOOR) { return null; }

    return {
      version: WAVEFORM_VERSION,
      hz,
      sr: rate,
      peaks: normalizeChannel(rms, ENVELOPE_GAMMA),
      bass: normalizeChannel(bassRaw, ENVELOPE_GAMMA),
      flux: normalizeChannel(fluxMax, 1),
      centroid: normalizeRange(centRaw),
    };
  } catch (err) {
    console.log(`[LIVIL][WAVE] analyze failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function lerpAt(arr: number[], x: number): number {
  const i = Math.floor(x);
  if (i >= arr.length - 1) { return clamp01(arr[arr.length - 1] ?? 0); }
  const frac = x - i;
  const a = arr[i] ?? 0;
  const b = arr[i + 1] ?? a;
  return clamp01(a + (b - a) * frac);
}

/**
 * Sample the full feature set at an absolute full-track position (seconds).
 * Loudness/bass/brightness are interpolated for smoothness; FLUX is taken at the
 * nearest bucket (NOT interpolated) so the onset stays crisp for kick detection.
 * Returns null when there's no usable data (→ decorative fallback). Pure + cheap.
 * Handles v1 rows (peaks only): bass falls back to loudness, flux=0, centroid=0.5.
 */
export function sampleFeatures(data: WaveformData | null, positionSec: number): WaveFeatures | null {
  if (!data || !Array.isArray(data.peaks) || data.peaks.length === 0) { return null; }
  const hz = data.hz;
  if (!hz || hz <= 0) { return null; }
  const x = Math.max(0, positionSec) * hz;
  const loud = lerpAt(data.peaks, x);
  const bass = data.bass && data.bass.length > 0 ? lerpAt(data.bass, x) : loud;
  const centroid = data.centroid && data.centroid.length > 0 ? lerpAt(data.centroid, x) : 0.5;
  let flux = 0;
  if (data.flux && data.flux.length > 0) {
    const i = Math.min(data.flux.length - 1, Math.floor(x));
    flux = clamp01(data.flux[i] ?? 0);
  }
  return { loud, bass, flux, centroid };
}

/**
 * Back-compat: sample just the loudness envelope (0..1) at a position. Retained
 * for any caller that only wants amplitude; the renderer uses sampleFeatures.
 */
export function sampleEnvelope(data: WaveformData | null, positionSec: number): number | null {
  const f = sampleFeatures(data, positionSec);
  return f ? f.loud : null;
}
