import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, { useSharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { COLORS } from '../theme/colors';
import { usePlayback } from '../contexts/PlaybackContext';
import type { WaveformData } from '../services/waveform';

/**
 * Story waveform — vertical BARS (matching the design), not the floating player's
 * continuous line. Reads the precomputed `tracks.waveform_peaks` loudness envelope
 * (0..1 per bucket, absolute seconds), slices the story's CLIP window, and renders
 * it as bars. A bright "played" layer sweeps left→right across the same bars as the
 * clip plays, driven by the live absolute positionRef the story engine advances.
 *
 * No analysis here — peaks only. With no data (video, or not loaded yet) it draws a
 * calm resting pattern so the bar row still reads as intentional.
 */

const BAR_COUNT = 44;
const HEIGHT = 30;
const MIN_BAR = 0.12; // floor so quiet buckets stay visible

function fallbackBars(n: number): number[] {
  // Deterministic, calm resting shape (no wall-clock, no randomness).
  return Array.from({ length: n }, (_, i) => 0.26 + 0.13 * Math.abs(Math.sin(i * 0.7)));
}

function computeBars(
  waveform: WaveformData | null,
  clipStartSec: number,
  clipEndSec: number,
  barCount: number,
): number[] {
  const peaks = waveform?.peaks;
  if (!peaks || peaks.length === 0) {
    return fallbackBars(barCount);
  }
  const hz = waveform!.hz || 15;
  const start = Math.max(0, Math.floor(clipStartSec * hz));
  const end = Math.min(peaks.length, Math.max(start + 1, Math.ceil(clipEndSec * hz)));
  const slice = peaks.slice(start, end);
  if (slice.length === 0) {
    return fallbackBars(barCount);
  }
  const bars: number[] = [];
  for (let i = 0; i < barCount; i++) {
    const a = Math.floor((i / barCount) * slice.length);
    const b = Math.max(a + 1, Math.floor(((i + 1) / barCount) * slice.length));
    let m = 0;
    for (let j = a; j < b && j < slice.length; j++) {
      m = Math.max(m, slice[j]!);
    }
    bars.push(m);
  }
  // Normalize to the loudest bar so a short/quiet clip still fills the row.
  const peak = Math.max(...bars, 0.0001);
  return bars.map(v => Math.max(MIN_BAR, v / peak));
}

export default function StoryWaveBars({
  waveform,
  clipStartSec,
  clipEndSec,
  width,
}: {
  waveform: WaveformData | null;
  clipStartSec: number;
  clipEndSec: number;
  width: number;
}) {
  const { positionRef } = usePlayback();
  const bars = useMemo(
    () => computeBars(waveform, clipStartSec, clipEndSec, BAR_COUNT),
    [waveform, clipStartSec, clipEndSec],
  );

  // Played fraction of the clip, polled off the live absolute position (~25Hz).
  const progress = useSharedValue(0);
  useEffect(() => {
    const clipDur = Math.max(0.001, clipEndSec - clipStartSec);
    const id = setInterval(() => {
      const frac = (positionRef.current - clipStartSec) / clipDur;
      progress.value = Math.min(1, Math.max(0, frac));
    }, 40);
    return () => clearInterval(id);
  }, [clipStartSec, clipEndSec, positionRef, progress]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <View style={[styles.row, { width, height: HEIGHT }]}>
      {/* Unplayed (dim) bars */}
      <View style={styles.barsLayer}>
        {bars.map((h, i) => (
          <View key={i} style={[styles.bar, styles.barDim, { height: `${h * 100}%` }]} />
        ))}
      </View>
      {/* Played (bright) bars, revealed left→right by the progress width. The inner
          row is pinned to the left at the FULL width so the bars stay aligned with
          the dim layer as the overflow-hidden parent clips it. */}
      <Reanimated.View style={[styles.fill, fillStyle]}>
        <View style={[styles.barsLayerFixed, { width }]}>
          {bars.map((h, i) => (
            <View key={i} style={[styles.bar, styles.barBright, { height: `${h * 100}%` }]} />
          ))}
        </View>
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    justifyContent: 'center',
  },
  barsLayer: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  // Same as barsLayer but a FIXED left-pinned width (set inline), so the bright
  // row's bars stay aligned with the dim row while the parent clips it by width.
  barsLayerFixed: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  bar: {
    flex: 1,
    minHeight: 2,
    borderRadius: 2,
  },
  barDim: {
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  barBright: {
    backgroundColor: COLORS.purpleNeon,
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
  },
});
