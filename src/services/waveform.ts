import { decodeAudioData } from 'react-native-audio-api';

/**
 * Beat-synced visualizer analysis (Tier B).
 *
 * Pure decode + DSP: turn an audio (or video-with-audio) source into a normalized
 * loudness envelope the floating-player wave can ride. Decoding uses the phone's
 * HARDWARE decoder via react-native-audio-api's standalone `decodeAudioData` — a
 * one-shot decode (no AudioContext, no playback, no MediaSession), so it never
 * touches the patched single-engine (GlobalAudioPlayer / react-native-video).
 *
 * This module has NO Supabase imports on purpose — the DB read/write + cache live
 * in `tracks.ts` (getWaveformPeaks / backfillWaveformPeaks / getOrAnalyzeWaveform),
 * so there is no circular import (tracks → waveform only).
 */

/** Stored on tracks.waveform_peaks as jsonb. `peaks` spans the FULL track. */
export type WaveformData = {
  /** Analyzer version — lets us re-analyze if the algorithm changes. */
  version: number;
  /** Buckets per second — position→index is `floor(positionSec * hz)`. */
  hz: number;
  /** Normalized 0..1 loudness per bucket, across the whole track. */
  peaks: number[];
};

/** Bump when the bucketing/normalization changes so stale envelopes can be re-derived. */
export const WAVEFORM_VERSION = 1;

/** ~10 buckets/sec — fine enough to "pulse" with the music, ~KB per 4-min track. */
export const WAVEFORM_HZ = 10;

/**
 * Decode at a low mono-ish rate: we only need a loudness envelope, not fidelity.
 * 8 kHz → ~1.9M samples/channel for a 4-min track (~8 MB Float32), decoded by the
 * hardware decoder in well under a second.
 */
const TARGET_SAMPLE_RATE = 8000;

/** Normalize against a high percentile (not the absolute max) so one transient
 *  spike — a snare hit, a clipped sample — doesn't flatten the whole envelope. */
const NORMALIZE_PERCENTILE = 0.95;

/** Perceptual lift (<1): brightens quiet sections so the wave still moves in a
 *  soft intro instead of sitting near-flat. Purely cosmetic. */
const ENVELOPE_GAMMA = 0.65;

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Decode `source` (a local file:// path at upload OR a remote URL on lazy
 * backfill — `decodeAudioData` accepts both) and compute the normalized loudness
 * envelope. Returns null on any failure (decode error, unsupported container such
 * as some video files, or pure silence) — callers leave waveform_peaks null and
 * the wave keeps its decorative animation. Never throws.
 */
export async function analyzeWaveformPeaks(source: string): Promise<WaveformData | null> {
  if (!source) { return null; }
  try {
    const buffer = await decodeAudioData(source, TARGET_SAMPLE_RATE);
    const frames = buffer.length;
    const channels = buffer.numberOfChannels;
    const rate = buffer.sampleRate || TARGET_SAMPLE_RATE;
    if (frames <= 0 || channels <= 0) { return null; }

    // Downmix to a single mono track by averaging channels (more faithful loudness
    // than picking channel 0 — e.g. a hard-panned hook).
    const chans: Float32Array[] = [];
    for (let c = 0; c < channels; c++) { chans.push(buffer.getChannelData(c)); }

    const samplesPerBucket = Math.max(1, Math.round(rate / WAVEFORM_HZ));
    const bucketCount = Math.max(1, Math.ceil(frames / samplesPerBucket));
    const rms = new Float32Array(bucketCount);

    for (let b = 0; b < bucketCount; b++) {
      const start = b * samplesPerBucket;
      const end = Math.min(start + samplesPerBucket, frames);
      let sumSq = 0;
      for (let i = start; i < end; i++) {
        let s = 0;
        for (let c = 0; c < channels; c++) { s += chans[c]![i]!; }
        s /= channels;
        sumSq += s * s;
      }
      const n = end - start;
      rms[b] = n > 0 ? Math.sqrt(sumSq / n) : 0;
    }

    // Normalization reference = high percentile of bucket RMS.
    const sorted = Array.from(rms).sort((a, b) => a - b);
    const refIdx = Math.min(sorted.length - 1, Math.floor(sorted.length * NORMALIZE_PERCENTILE));
    const ref = sorted[refIdx] ?? 0;
    if (ref <= 0) { return null; } // pure silence / decode produced nothing usable

    const peaks: number[] = new Array(bucketCount);
    for (let b = 0; b < bucketCount; b++) {
      const v = Math.pow(clamp01(rms[b]! / ref), ENVELOPE_GAMMA);
      // 3 decimals keeps the jsonb small without visible quantization.
      peaks[b] = Math.round(v * 1000) / 1000;
    }

    return { version: WAVEFORM_VERSION, hz: WAVEFORM_HZ, peaks };
  } catch (err) {
    console.log(`[LIVIL][WAVE] analyze failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Sample a stored envelope at an absolute full-track position (seconds), with
 * linear interpolation between buckets for a smooth ride. Returns 0..1, or null
 * when there's no usable data so the caller can fall back to the decorative wave.
 * Pure + cheap — safe to call every animation tick.
 */
export function sampleEnvelope(data: WaveformData | null, positionSec: number): number | null {
  if (!data || !Array.isArray(data.peaks) || data.peaks.length === 0) { return null; }
  const { peaks, hz } = data;
  if (!hz || hz <= 0) { return null; }
  const x = Math.max(0, positionSec) * hz;
  const i = Math.floor(x);
  if (i >= peaks.length - 1) { return clamp01(peaks[peaks.length - 1] ?? 0); }
  const frac = x - i;
  const a = peaks[i] ?? 0;
  const b = peaks[i + 1] ?? a;
  return clamp01(a + (b - a) * frac);
}
