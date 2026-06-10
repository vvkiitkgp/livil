import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Reanimated, {
  useSharedValue,
  useAnimatedProps,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';

/**
 * Material-style "wavy progress" visualizer for the FloatingPlayer's minimized
 * white line. A single continuous sine stroke that SCROLLS horizontally while
 * music plays and crisply FLATTENS back to a straight line when paused — the
 * stroke width is constant, so the line stays sharp as the amplitude shrinks to
 * zero (no fade). Both the scroll (phase) and the flatten (amplitude) run on the
 * UI thread via Reanimated driving react-native-svg's Path `d`, so it's 60fps and
 * never competes with the JS pollers / gestures the FloatingPlayer already runs.
 *
 * Visibility/coexistence with the pill morph is the PARENT's job (FloatingPlayer
 * wraps this in an Animated.View whose opacity is the inverse of morphAnim), so
 * this only cares about play/pause.
 */

const AnimatedPath = Reanimated.createAnimatedComponent(Path);

const HEIGHT = 30;       // SVG canvas height (mid-line at HEIGHT/2)
const STROKE = 2.5;      // constant line thickness — stays crisp when flattened
const AMP = 4;           // wave amplitude while playing (±4px)
const WAVELENGTHS = 2;   // full sine periods across the width
const STEPS = 40;        // polyline resolution
// Scroll speed is anchored to a reference wavelength so the wave's PIXEL speed
// stays CONSTANT across wavelengths: a wider wave takes proportionally longer to
// scroll one period, so it glides at the same readable right→left pace as a
// narrow one (instead of zipping a whole big wavelength per cycle, which reads as
// a standing shimmer rather than motion). Anchored to how WAVELENGTHS=4 felt.
const REF_WAVELENGTHS = 4;
const REF_TRAVEL_MS = 700;
const TRAVEL_MS = REF_TRAVEL_MS * (REF_WAVELENGTHS / WAVELENGTHS); // 1400ms @ WL=2

// Build the sine polyline path on the UI thread. Advancing `phase` by 2π shifts
// the wave by exactly one period, so the repeat loops with no visible seam.
function buildPath(phase: number, amp: number, width: number): string {
  'worklet';
  const midY = HEIGHT / 2;
  const k = (WAVELENGTHS * 2 * Math.PI) / width;
  let d = '';
  for (let i = 0; i <= STEPS; i++) {
    const x = (i / STEPS) * width;
    const y = midY + amp * Math.sin(k * x + phase);
    d += i === 0 ? `M${x} ${y}` : `L${x} ${y}`;
  }
  return d;
}

export default function WaveVisualizer({
  playing,
  width,
  color = '#FFFFFF',
}: {
  playing: boolean;
  width: number;
  color?: string;
}) {
  const phase = useSharedValue(0);
  const amp = useSharedValue(0);

  // Continuous scroll (invisible while amp = 0, so it's free to run always).
  useEffect(() => {
    phase.value = withRepeat(
      withTiming(2 * Math.PI, { duration: TRAVEL_MS, easing: Easing.linear }),
      -1,
      false,
    );
  }, [phase]);

  // Grow on play; flatten to a straight line on pause (crisp, constant stroke).
  useEffect(() => {
    amp.value = withTiming(playing ? AMP : 0, {
      duration: playing ? 360 : 520,
      easing: Easing.inOut(Easing.quad),
    });
  }, [playing, amp]);

  const animatedProps = useAnimatedProps(() => ({
    d: buildPath(phase.value, amp.value, width),
  }));

  return (
    <Svg width={width} height={HEIGHT} style={styles.svg}>
      <AnimatedPath
        animatedProps={animatedProps}
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  svg: { overflow: 'visible' },
});
