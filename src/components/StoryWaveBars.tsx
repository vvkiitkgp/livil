import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  useFrameCallback,
  withTiming,
  withSequence,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import { COLORS } from '../theme/colors';
import { usePlayback } from '../contexts/PlaybackContext';
import { sampleFeatures, type WaveformData } from '../services/waveform';

/**
 * Story music visualizer — REACTIVE bars that bounce with the song, not a
 * progress bar. Reads the precomputed `tracks.waveform_peaks` features at the
 * live absolute position the story engine drives: overall level sets how tall the
 * bars swell, low-band onsets punch a transient "kick", and a per-bar phase makes
 * neighbours differ so it reads as an equalizer. Settles flat when paused.
 *
 * Renders NOTHING when there is no analysis (video, or not yet loaded) — the wave
 * is only shown when it can actually react to the music.
 */

const BAR_COUNT = 26;
const HEIGHT = 30;
const TICK_MS = 40; // feature sampling cadence (~25Hz)

function VizBar({
  index,
  level,
  kick,
  phase,
}: {
  index: number;
  level: SharedValue<number>;
  kick: SharedValue<number>;
  phase: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    // Per-bar sway, phase-offset so adjacent bars differ (equalizer look).
    const sway = 0.3 + 0.7 * Math.abs(Math.sin(index * 0.55 + phase.value));
    // Centre bars react a little more to the kick than the edges.
    const bump = 0.55 + 0.45 * Math.sin((index / BAR_COUNT) * Math.PI);
    const h = level.value * sway + kick.value * bump;
    return { transform: [{ scaleY: Math.max(0.06, Math.min(1, h)) }] };
  });
  return <Reanimated.View style={[styles.bar, style]} />;
}

export default function StoryWaveBars({
  waveform,
  playing,
  width,
}: {
  waveform: WaveformData | null;
  playing: boolean;
  width: number;
}) {
  const { positionRef } = usePlayback();
  const level = useSharedValue(0); // overall energy (eased)
  const kick = useSharedValue(0);  // transient punch on onsets
  const phase = useSharedValue(0); // UI-thread sway phase

  // Advance the sway phase on the UI thread; faster when the music is louder.
  useFrameCallback(frame => {
    'worklet';
    const dt = frame.timeSincePreviousFrame ?? 16;
    let p = phase.value + (0.004 + level.value * 0.006) * dt;
    if (p > 1e6) { p = 0; }
    phase.value = p;
  });

  // Sample the precomputed features at the live position and feed the bars.
  useEffect(() => {
    if (!waveform || !playing) {
      level.value = withTiming(0, { duration: 320, easing: Easing.out(Easing.quad) });
      kick.value = withTiming(0, { duration: 200 });
      return;
    }
    let prevAbove = false;
    let fluxEma = 0;
    let lastKickAt = 0;
    let elapsed = 0;
    const id = setInterval(() => {
      elapsed += TICK_MS;
      const f = sampleFeatures(waveform, positionRef.current);
      if (!f) { return; }
      // Overall level from loudness/bass (v1 rows have bass≈loud).
      const lvl = Math.min(1, 0.15 + 0.85 * Math.max(f.loud, f.bass));
      level.value = withTiming(lvl, { duration: TICK_MS * 2, easing: Easing.out(Easing.quad) });
      // Onset → kick: adaptive, rising-edge, rate-limited (v1 flux≈0 → no kicks).
      fluxEma = fluxEma * 0.9 + f.flux * 0.1;
      const threshold = Math.min(0.9, Math.max(0.22, fluxEma * 1.4));
      const above = f.flux > threshold;
      if (above && !prevAbove && elapsed - lastKickAt >= 110) {
        lastKickAt = elapsed;
        kick.value = withSequence(
          withTiming(0.5, { duration: 45, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 230, easing: Easing.in(Easing.quad) }),
        );
      }
      prevAbove = above;
    }, TICK_MS);
    return () => clearInterval(id);
  }, [waveform, playing, positionRef, level, kick]);

  // No analysis → show nothing (per product: react to the music, or don't show).
  if (!waveform) { return null; }

  return (
    <View style={[styles.row, { width, height: HEIGHT }]}>
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <VizBar key={i} index={i} level={level} kick={kick} phase={phase} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },
  bar: {
    flex: 1,
    height: HEIGHT,
    borderRadius: 2,
    backgroundColor: COLORS.purpleNeon,
    transformOrigin: '50% 100%',
  },
});
