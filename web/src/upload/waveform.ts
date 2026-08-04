/**
 * Waveform analysis in the browser — including for VIDEO, which the phone cannot do.
 *
 * ADR-0003 forbids analysing video on device: `decodeAudioData(videoUrl)` pulls the whole
 * file into memory through React Native networking, and the OS kills the process with no JS
 * log. A desktop browser has orders of magnitude more headroom and the file is already
 * local — no download at all — so the web dashboard closes a gap that is structural on
 * mobile, and becomes the backfill path for existing video posts.
 *
 * "More headroom" is not "unlimited", and this is the honest limit: Web Audio's
 * `decodeAudioData` requires the ENTIRE file as one ArrayBuffer. There is no streaming
 * decode. So the largest files this client accepts for UPLOAD cannot all be ANALYSED —
 * anything past the cap below is skipped rather than risking a tab crash mid-publish. That
 * gap widens when the upload ceiling moves to its 2 GB target (ADR-0015 decision 5).
 *
 * The DSP itself is `shared/services/waveformDsp.ts`, the same code the phone runs. Only
 * the decode differs.
 */
import {
  analyzeDecodedAudio,
  TARGET_SAMPLE_RATE,
  type WaveformData,
} from '@shared/services/waveformDsp';

/**
 * Files above this are not analysed.
 *
 * Sized for the ArrayBuffer + the decoder's own working set, not for the decoded PCM —
 * decoded audio is small (16 kHz mono for 10 minutes is ~38 MB). It is the encoded file
 * held whole in memory that hurts, and a tab that dies here would take the publish with it.
 * Well above any audio master; most music videos pass, long 4K ones do not.
 */
export const MAX_ANALYZE_BYTES = 300 * 1024 * 1024;

/**
 * Decode at the analyzer's target rate so the browser's resampler does the work and the
 * FFT bin layout matches what the phone produces. Without this the decode lands at the
 * hardware rate (typically 44.1/48 kHz), which still analyses correctly — the DSP reads
 * `buffer.sampleRate` — but would not be bit-comparable with a mobile-analysed track.
 */
function decodeAtTargetRate(bytes: ArrayBuffer): Promise<AudioBuffer> {
  const Ctor = window.OfflineAudioContext ?? window.webkitOfflineAudioContext;
  const ctx = new Ctor(1, 1, TARGET_SAMPLE_RATE);
  return ctx.decodeAudioData(bytes);
}

/**
 * Analyse a local file and return the v2 feature set, or null.
 *
 * Never throws and never rejects: a failed analysis must not fail a publish. Every null
 * path leaves `waveform_peaks` unset, and the visualizer falls back to its decorative wave.
 */
export async function analyzeLocalFile(file: File): Promise<WaveformData | null> {
  if (file.size > MAX_ANALYZE_BYTES) return null;
  try {
    const bytes = await file.arrayBuffer();
    const buffer = await decodeAtTargetRate(bytes);
    return await analyzeDecodedAudio(buffer);
  } catch {
    // Unsupported container, a codec the browser lacks, or memory pressure. All of these
    // are "no wave", not "no upload".
    return null;
  }
}
