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
      <Svg width="100%" height="100%">
        <Defs>
          <SvgLinearGradient id={gId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={String(topStopOpacity)} />
            <Stop offset="1" stopColor={color} stopOpacity={String(bottomStopOpacity)} />
          </SvgLinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gId})`} />
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
