import React from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

/**
 * The shared onboarding backdrop: a violet bloom hanging off the top edge,
 * falling to the app background by just past halfway down.
 *
 * Design spec is
 *   radial-gradient(140% 90% at 50% -10%, #1E1040 0%, #0A0A0F 55%)
 *
 * PERFORMANCE — why this only covers the top of the screen.
 *
 * This was originally a full-viewport <Svg>. It is the only one in the app;
 * every other SVG here is bounded and small (GradientBorder is button-sized,
 * GradientFill is a progress bar). On a 1080x2400 device a full-screen SVG is a
 * ~2.6M-pixel layer Android has to composite on every frame of a stack push —
 * which made navigating AWAY from onboarding visibly slower than any other
 * navigation in the app, while the destination screens were blameless.
 *
 * The gradient is already flat #0A0A0F by roughly 40% of the height, and the
 * screen behind it is COLORS.bg, so everything below was painting nothing. This
 * draws the top 55% only and lets the screen background cover the rest; the
 * seam lands inside the flat region and is invisible.
 *
 * The gradient geometry is declared in userSpaceOnUse against the FULL window
 * height, not the reduced canvas, so the bloom keeps exactly the shape the
 * design specifies instead of being squashed into the shorter box.
 */

/** Fraction of the window height actually rasterized. Keep above ~0.45. */
const COVER = 0.55;

export function ScreenBackdrop() {
  const { width, height } = useWindowDimensions();
  const canvasHeight = Math.ceil(height * COVER);

  return (
    <Svg style={styles.backdrop} width={width} height={canvasHeight} pointerEvents="none">
      <Defs>
        <RadialGradient
          id="lvBackdrop"
          gradientUnits="userSpaceOnUse"
          cx={width / 2}
          cy={-0.1 * height}
          rx={1.4 * width}
          ry={0.9 * height}>
          <Stop offset="0" stopColor="#1E1040" />
          <Stop offset="0.55" stopColor="#0A0A0F" />
          <Stop offset="1" stopColor="#0A0A0F" />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={canvasHeight} fill="url(#lvBackdrop)" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
