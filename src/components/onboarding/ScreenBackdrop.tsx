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
 * SVG's objectBoundingBox units map that directly — cx/cy at (0.5, -0.1) with
 * rx/ry of (1.4, 0.9). The centre sits ABOVE the viewport on purpose, so what
 * renders on screen is the lower arc of the bloom rather than a visible hotspot.
 *
 * Absolutely positioned and non-interactive; render it first inside the step
 * container and lay content over it.
 */
export function ScreenBackdrop() {
  const { width, height } = useWindowDimensions();

  return (
    <Svg
      style={StyleSheet.absoluteFill}
      width={width}
      height={height}
      pointerEvents="none">
      <Defs>
        <RadialGradient id="lvBackdrop" cx="0.5" cy="-0.1" rx="1.4" ry="0.9">
          <Stop offset="0" stopColor="#1E1040" />
          <Stop offset="0.55" stopColor="#0A0A0F" />
          <Stop offset="1" stopColor="#0A0A0F" />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill="url(#lvBackdrop)" />
    </Svg>
  );
}
