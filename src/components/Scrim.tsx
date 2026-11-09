import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from 'react-native-svg';
import { COLORS } from '../theme/colors';

type Props = {
  /**
   * Which edge the scrim is anchored to. `top` is opaque at the top and fades to
   * transparent going down; `bottom` is opaque at the bottom and fades going up.
   */
  edge: 'top' | 'bottom';
  /** Scrim height in dp. */
  height: number;
  /** Peak opacity at the anchored edge (0..1). Default 0.72. */
  peakOpacity?: number;
  /**
   * Share of the height (0..1), measured from the anchored edge, held at peak
   * opacity before the fade begins. Default 0: a straight ramp edge to edge.
   */
  plateau?: number;
  /** Colour to fade from. Default the app's near-black background floor. */
  color?: string;
  style?: StyleProp<ViewStyle>;
};

const DEFAULT_SCRIM_COLOR = COLORS.bg;

/**
 * A vertical dark-to-transparent gradient overlay, used to keep white chrome and
 * text legible over arbitrary media (the story viewer). There is deliberately no
 * `react-native-linear-gradient` in this project (see GradientBorder), and the
 * house gradient primitives (`GradientBorder`, `GradientFill`) are purple/outline
 * only — so this draws its own vertical ramp with the same `react-native-svg`
 * dependency and pattern. Non-interactive by construction.
 */
export default function Scrim({
  edge,
  height,
  peakOpacity = 0.72,
  plateau = 0,
  color = DEFAULT_SCRIM_COLOR,
  style,
}: Props) {
  // Stable, collision-free id per instance (useId can contain ':' which breaks
  // SVG url(#…) references).
  const gId = `scrim_${React.useId().replace(/:/g, '')}`;

  // For a top scrim the opaque stop is at the top (offset 0); for a bottom scrim
  // it is at the bottom (offset 1).
  const topStopOpacity = edge === 'top' ? peakOpacity : 0;
  const bottomStopOpacity = edge === 'top' ? 0 : peakOpacity;
  // Where the held band ends and the fade starts, as a gradient offset from the top.
  const held = Math.min(1, Math.max(0, plateau));
  const plateauOffset = edge === 'top' ? held : 1 - held;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.base,
        edge === 'top' ? styles.edgeTop : styles.edgeBottom,
        { height },
        style,
      ]}
    >
      {/* The height is passed as a NUMBER, not "100%": when a caller's height changes
          after mount, a percentage is not re-resolved and the ramp stays painted at
          the old size, leaving a bare strip at the bottom (seen on iPhone in the
          full-screen player, whose height follows a measured block). */}
      <Svg width="100%" height={height}>
        <Defs>
          <SvgLinearGradient id={gId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={String(topStopOpacity)} />
            {/* With no plateau this lands on the anchored edge's own stop and changes
                nothing. Always rendered: the gradient's children cannot be null. */}
            <Stop offset={String(plateauOffset)} stopColor={color} stopOpacity={String(peakOpacity)} />
            <Stop offset="1" stopColor={color} stopOpacity={String(bottomStopOpacity)} />
          </SvgLinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height={height} fill={`url(#${gId})`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  edgeTop: {
    top: 0,
  },
  edgeBottom: {
    bottom: 0,
  },
});
