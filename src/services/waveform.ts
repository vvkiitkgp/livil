import { decodeAudioData } from 'react-native-audio-api';
import {
  analyzeDecodedAudio,
  MAX_ANALYZE_SECONDS,
  TARGET_SAMPLE_RATE,
  type WaveformData,
} from '../../shared/services/waveformDsp';

/**
 * Beat-synced visualizer analysis (Tier B) — the React Native decode.
 *
 * The DSP moved to `shared/services/waveformDsp.ts` so the web dashboard derives peaks with
 * the SAME algorithm. That matters more than it looks: the output is persisted to
 * `tracks.waveform_peaks` and rendered by THIS app's visualizer, so a second, drifting
 * analyzer would write `version: 2` rows the phone renders wrongly, silently.
 *
 * What stays here is the one platform-specific step. `decodeAudioData` is
 * react-native-audio-api's standalone decoder — a one-shot decode with NO `AudioContext`,
 * no playback and no MediaSession, so it never touches the patched single engine
 * (GlobalAudioPlayer / react-native-video). Keep it that way.
 *
 * AUDIO ONLY. Never call this with a video URL: `decodeAudioData` pulls the whole file
 * into memory through RN networking, and a video is tens-to-hundreds of MB → OOM → the OS
 * kills the process with no JS log. Callers gate on `mediaKind === 'audio'`.
 */

// Re-exported so existing imports (`from './waveform'`) keep working unchanged.
export {
  analyzeDecodedAudio,
  MAX_ANALYZE_SECONDS,
  sampleEnvelope,
  sampleFeatures,
  TARGET_SAMPLE_RATE,
  WAVEFORM_HZ,
  WAVEFORM_VERSION,
} from '../../shared/services/waveformDsp';
export type {
  DecodedAudio,
  WaveFeatures,
  WaveformData,
} from '../../shared/services/waveformDsp';

/**
 * Decode `source` (a local file:// path at upload, OR a remote URL on lazy backfill —
 * `decodeAudioData` accepts both) and compute the v2 feature set.
 *
 * Returns null on any failure (decode error, unsupported container, over the duration cap,
 * or silence) — callers leave `waveform_peaks` null and the wave keeps its decorative
 * animation. Never throws. Runs once per track, off the playback path.
 */
export async function analyzeWaveformPeaks(source: string): Promise<WaveformData | null> {
  if (!source) { return null; }
  try {
    const buffer = await decodeAudioData(source, TARGET_SAMPLE_RATE);
    const seconds = buffer.length / (buffer.sampleRate || TARGET_SAMPLE_RATE);
    if (seconds > MAX_ANALYZE_SECONDS) {
      console.log(`[LIVIL][WAVE] skip analysis: ${seconds.toFixed(0)}s > ${MAX_ANALYZE_SECONDS}s cap`);
      return null;
    }
    return await analyzeDecodedAudio(buffer);
  } catch (err) {
    console.log(`[LIVIL][WAVE] analyze failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
