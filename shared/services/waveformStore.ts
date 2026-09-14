/**
 * Persisting the analyzed waveform. Shared so both clients write the column identically.
 *
 * Mirrors `backfillWaveformPeaks` in `src/services/tracks.ts` exactly, including the two
 * properties that matter more than they look:
 *
 *   - `.is('waveform_peaks', null)` makes it idempotent. Two clients (or a re-upload and a
 *     lazy backfill on first play) can race without one overwriting the other's work.
 *   - It never throws. A failed write must not fail a publish — the track simply keeps the
 *     decorative wave and backfills on a later play.
 */
import { livil } from '../client';
import type { Json } from '../types/database';
import type { WaveformData } from './waveformDsp';

export async function backfillWaveformPeaks(
  trackId: string,
  data: WaveformData | null,
): Promise<void> {
  if (!trackId || !data || !Array.isArray(data.peaks) || data.peaks.length === 0) return;
  try {
    await livil()
      .from('tracks')
      .update({ waveform_peaks: data as unknown as Json })
      .eq('id', trackId)
      .is('waveform_peaks', null);
  } catch {
    /* best-effort; backfills on a later play if this attempt fails */
  }
}
