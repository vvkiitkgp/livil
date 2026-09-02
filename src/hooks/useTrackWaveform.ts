import { useEffect, useState } from 'react';
import { getOrAnalyzeWaveform } from '../services/tracks';
import type { WaveformData } from '../services/waveform';

/**
 * A track's real loudness envelope, for the surfaces that draw one track at a time.
 *
 * ── THE AUDIO-ONLY GATE IS THE REASON THIS IS A HOOK ────────────────────────
 * Lazy analysis decodes the source URL, which pulls the WHOLE remote file into memory
 * through React Native's networking layer. That is fine for an mp3 and fatal for a
 * video: tens to hundreds of megabytes, an `OutOfMemoryError`, and the OS kills the
 * process — no JavaScript error, no log line, the debugger simply drops. It presents as
 * a mysterious crash rather than as a failure, which is exactly why
 * kb/architecture/media-pipeline.md states the rule and why it must not be re-derived
 * at each call site. It had been written out by hand in three places.
 *
 * Video posts get `null` and their surface falls back to the decorative wave. Do not
 * "add video support" by removing the gate; that needs server-side or streaming
 * extraction, not a client-side download.
 *
 * ── WHY ONLY ONE TRACK AT A TIME ────────────────────────────────────────────
 * The service caches in memory and reads the stored envelope before analysing, so this
 * is cheap for the player, the floating pill and the repost composer — each shows one
 * track. It is NOT for the feed: a per-post envelope is a few hundred numbers on every
 * card for data only the playing track uses.
 *
 * Fail-safe throughout. A missing column, a failed decode and a video all return null,
 * and the caller draws the decorative wave. Nothing here ever throws to the UI.
 */
export function useTrackWaveform(
  trackId: string | null | undefined,
  mediaKind: 'audio' | 'video' | null | undefined,
  audioUrl: string | null | undefined,
): WaveformData | null {
  const [waveform, setWaveform] = useState<WaveformData | null>(null);
  const url = mediaKind === 'audio' ? audioUrl : undefined;

  useEffect(() => {
    if (!trackId || !url) { setWaveform(null); return; }
    let cancelled = false;
    // Cleared up front so a new track never draws the previous one's shape while its
    // own envelope resolves.
    setWaveform(null);
    getOrAnalyzeWaveform(trackId, url)
      .then(data => { if (!cancelled) { setWaveform(data); } })
      .catch(() => { if (!cancelled) { setWaveform(null); } });
    return () => { cancelled = true; };
  }, [trackId, url]);

  return waveform;
}
