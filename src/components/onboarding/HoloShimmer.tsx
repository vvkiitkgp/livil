import React, { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

/**
 * The holographic foil on the backstage pass — the animated strip along the top
 * of the card and the round "100% REAL" sticker.
 *
 * The design calls for a CSS `background-size: 300%` gradient whose
 * `background-position` animates 0 → 300%. React Native has neither, so this
 * paints a gradient THREE CYCLES WIDE and slides it left by exactly one cycle on
 * a loop. Because the ramp repeats every cycle, the end frame is pixel-identical
 * to the start frame and the loop is seamless — no fade, no snap.
 *
 * Why SVG and not react-native-linear-gradient: the app deliberately has no
 * gradient package (see GradientBorder). react-native-svg is already a
 * dependency and renders identically on both platforms.
 *
 * The parent must clip — pass a `borderRadius` and this sets overflow itself.
 */

const RAMP = ['#A855F7', '#22D3EE', '#8B3DFF'];
const CYCLES = 3;

// Unique per instance. Step 1 renders the strip AND the sticker at once; a
// shared <Defs> id would make one overwrite the other's paint. Same reason
// GradientBorder carries a counter.
let shimmerCounter = 0;
function nextShimmerId(): string {
  shimmerCounter += 1;
  return `lvholo_${shimmerCounter}`;
}

export type HoloShimmerProps = {
  width: number;
  height: number;
  /** Seconds for one full cycle. Design: 4s for the strip, 3s for the sticker. */
  durationSec?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

export function HoloShimmer({
  width,
  height,
  durationSec = 4,
  borderRadius = 0,
  style,
  children,
}: HoloShimmerProps) {
  const shift = useSharedValue(0);
  const gradientId = useMemo(nextShimmerId, []);

  React.useEffect(() => {
    shift.value = 0;
    shift.value = withRepeat(
      withTiming(1, { duration: durationSec * 1000, easing: Easing.linear }),
      -1,
      false,
    );
  }, [shift, durationSec]);

  const slide = useAnimatedStyle(() => ({
    transform: [{ translateX: -shift.value * width }],
  }));

  // One stop per ramp entry per cycle, plus a closing stop that repeats the
  // first colour so the seam between the last and first cycle is invisible.
  const stops = useMemo(() => {
    const total = CYCLES * RAMP.length;
    const out: Array<{ offset: string; color: string }> = [];
    for (let i = 0; i < total; i++) {
      out.push({ offset: `${(i / total) * 100}%`, color: RAMP[i % RAMP.length] });
    }
    out.push({ offset: '100%', color: RAMP[0] });
    return out;
  }, []);

  return (
    <View
      style={[styles.clip, { width, height, borderRadius }, style]}
      pointerEvents="box-none">
      <Reanimated.View style={[StyleSheet.absoluteFill, slide]}>
        <Svg width={width * CYCLES} height={height}>
          <Defs>
            <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
              {stops.map(s => (
                <Stop key={s.offset} offset={s.offset} stopColor={s.color} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect
            x={0}
            y={0}
            width={width * CYCLES}
            height={height}
            fill={`url(#${gradientId})`}
          />
        </Svg>
      </Reanimated.View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});
