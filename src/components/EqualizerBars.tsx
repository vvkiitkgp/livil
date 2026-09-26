import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { COLORS } from '../theme/colors';

/**
 * Purely decorative — this is NOT driven by the audio. Each bar gets its own
 * duration and start delay, all mutually non-divisible, so the three drift
 * permanently out of phase and read as random rather than as a synchronised
 * pulse. Cheaper and steadier than re-rolling a random target every cycle,
 * which needs a JS round-trip per bar per bounce.
 *
 * The beat-synced wave is a separate thing entirely (WaveVisualizer, driven by
 * `tracks.waveform_peaks`) — do not wire this to it. Every use of this (a queue
 * row, an inbox avatar, a friend's now-playing pill) is about SOMEONE ELSE's or an
 * off-screen track and is not worth a decode.
 */
const BARS = [
  { from: 0.35, to: 1.0, duration: 380, delay: 0 },
  { from: 0.55, to: 0.8, duration: 530, delay: 130 },
  { from: 0.3, to: 0.9, duration: 450, delay: 260 },
] as const;

function Bar({
  spec,
  height,
  width,
  color,
}: {
  spec: (typeof BARS)[number];
  height: number;
  width: number;
  color: string;
}) {
  const h = useSharedValue(spec.from * height);

  useEffect(() => {
    h.value = withDelay(
      spec.delay,
      withRepeat(withTiming(spec.to * height, { duration: spec.duration }), -1, true),
    );
    // Reanimated keeps an infinite repeat running after unmount otherwise.
    return () => cancelAnimation(h);
  }, [h, spec, height]);

  const style = useAnimatedStyle(() => ({ height: h.value }));

  return (
    <Animated.View
      style={[{ width, borderRadius: width / 2, backgroundColor: color }, style]}
    />
  );
}

/**
 * Three bouncing bars meaning "playing now". Solid fill is fine — the no-fill rule
 * exempts small indicators, and an outlined 3px bar would be invisible.
 */
export default function EqualizerBars({
  height = 14,
  barWidth = 3,
  color = COLORS.purpleNeon,
}: {
  height?: number;
  barWidth?: number;
  color?: string;
}) {
  return (
    // Bars grow upward from a common baseline, so the container is fixed-height
    // and bottom-aligned.
    <View style={[styles.row, { height, gap: Math.max(1, Math.round(barWidth * 0.67)) }]}>
      {BARS.map((spec, i) => (
        <Bar key={i} spec={spec} height={height} width={barWidth} color={color} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end' },
});
