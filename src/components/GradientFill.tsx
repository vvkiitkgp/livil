import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from 'react-native-svg';
import { COLORS } from '../theme/colors';

/**
 * A horizontal brand-gradient bar, for progress fills.
 *
 * Progress is the one place the "never fill with purple" button rule can't
 * apply — a progress bar IS its fill. So instead of dropping the fill, it uses
 * the same deep→neon ramp as GradientBorder, which is what keeps it consistent
 * with the outlined buttons rather than reading as a leftover flat purple slab.
 *
 * Render this inside the *filled* element and pass the FULL track width. The
 * parent's animated width then reveals a slice of a gradient that stays pinned
 * to the track, so the colours don't stretch and shift as playback advances —
 * which is what happens if you let the gradient scale with the fill.
 * The parent needs `overflow: 'hidden'`.
 */
export type GradientFillProps = {
  /** FULL track width, not the filled width. */
  width: number;
  height: number;
  borderRadius?: number;
  /**
   * Distance from the track's left edge to the filled element's left edge.
   * Shifts the gradient back so it stays pinned to the TRACK when the fill does
   * not start at zero (e.g. a fill that begins at a clip start rather than at 0).
   */
  offsetX?: number;
};

let gradientCounter = 0;
function nextGradientId(): string {
  gradientCounter += 1;
  return `lvfill_${gradientCounter}`;
}

export function GradientFill({
  width,
  height,
  borderRadius = 0,
  offsetX = 0,
}: GradientFillProps) {
  const gId = React.useMemo(() => nextGradientId(), []);
  const w = Math.floor(width);
  const h = Math.floor(height);
  if (w <= 0 || h <= 0) {
    return null;
  }
  return (
    <Svg width={w} height={h} style={[StyleSheet.absoluteFill, { left: -offsetX }]}>
      <Defs>
        <SvgLinearGradient id={gId} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={COLORS.purpleRoyal} stopOpacity="1" />
          <Stop offset="0.55" stopColor={COLORS.purple} stopOpacity="1" />
          <Stop offset="1" stopColor={COLORS.purpleNeon} stopOpacity="1" />
        </SvgLinearGradient>
      </Defs>
      <Rect
        x={0}
        y={0}
        width={w}
        height={h}
        rx={Math.min(borderRadius, h / 2)}
        ry={Math.min(borderRadius, h / 2)}
        fill={`url(#${gId})`}
      />
    </Svg>
  );
}

export default GradientFill;
