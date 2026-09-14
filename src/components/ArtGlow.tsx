import React from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { COLORS } from '../theme/colors';

const { width: SCREEN_W } = Dimensions.get('window');

/**
 * Dim purple halo behind a piece of cover art, plus the cast shadow that makes
 * it read as floating. Two radial gradients on one canvas:
 *
 *  1. HALO — a wide circle reaching past the card's corners, centered slightly
 *     low so more of it spills below than above (light source overhead).
 *  2. SHADOW — a tight, flat ellipse pooled under the card, brighter than the
 *     halo. Only its lower lobe is visible (the card covers the rest), which is
 *     exactly the shape a cast shadow makes.
 *
 * The shadow is PURPLE, not black, and that is the whole trick: on a #0A0A0F
 * page a black shadow is invisible by definition, so the "surface" the card
 * floats above has to be lit rather than darkened. Same reason this is SVG and
 * not a real shadow — `shadowColor` is iOS-only and Android's `elevation` paints
 * an untintable grey (see GradientBorder for the same reasoning).
 *
 * The canvas spans the FULL screen width and the halo's own diameter, centered
 * on the artwork, with both gradients positioned in user space — so nothing is
 * ever drawn outside its own host. A halo hung on the artwork's own box would be
 * clipped away on Android, where ViewGroups clip children by default.
 *
 * Renders as an absolutely-positioned overlay: drop it in BEFORE the artwork,
 * inside a host whose coordinate space `centerY` is measured in.
 */

/** Spread of the halo past the artwork's corners. */
const GLOW_PAD = 64;
/** How far below the artwork's centre the halo sits. */
const GLOW_DROP = 16;
/**
 * How far below it the cast-shadow pool sits. Bigger than GLOW_DROP so the pool
 * clears the card's bottom edge instead of hiding entirely behind it.
 */
const SHADOW_DROP = 34;
const GLOW_ID = 'lvartglow';
const SHADOW_ID = 'lvartshadow';

export type ArtGlowProps = {
  /** Vertical centre of the artwork, in the host's coordinate space. */
  centerY: number;
  /** Artwork's rendered width. */
  width: number;
  /** Artwork's rendered height. */
  height: number;
};

export function ArtGlow({ centerY, width, height }: ArtGlowProps) {
  // Whole dp before drawing — Android rounds the SVG's backing view DOWN, and
  // geometry computed against a fractional size lands past the real edge.
  const w = Math.floor(SCREEN_W);
  // Reach past the artwork's CORNERS — half of its DIAGONAL, not half a side —
  // plus the pad, so the halo wraps the whole card whatever its proportions.
  // Radiating only to the edge midpoints leaves the corners outside the gradient
  // entirely, unlit.
  const r = Math.hypot(width, height) / 2 + GLOW_PAD;
  // The canvas is exactly the halo's diameter so the ramp reaches zero right at
  // its top and bottom edge. Anything shorter cuts the gradient mid-ramp, which
  // shows as a hard horizontal line across the screen. (Left/right it IS cut
  // short, but that cut lands on the screen's own edge where nothing follows it.)
  const h = Math.ceil(r * 2);
  return (
    <View
      style={[st.host, { top: Math.round(centerY + GLOW_DROP - h / 2), height: h }]}
      pointerEvents="none"
    >
      <Svg width={w} height={h}>
        <Defs>
          <RadialGradient
            id={GLOW_ID}
            cx={w / 2}
            cy={h / 2}
            rx={r}
            ry={r}
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0" stopColor={COLORS.purpleNeon} stopOpacity="0.26" />
            <Stop offset="0.55" stopColor={COLORS.purple} stopOpacity="0.20" />
            <Stop offset="0.82" stopColor={COLORS.purple} stopOpacity="0.08" />
            <Stop offset="1" stopColor={COLORS.purple} stopOpacity="0" />
          </RadialGradient>
          {/* Wider than the card and much flatter — a pool, not a ball. Centred
              on the card's own x so the shadow sits square beneath it. */}
          <RadialGradient
            id={SHADOW_ID}
            cx={w / 2}
            cy={h / 2 - GLOW_DROP + SHADOW_DROP}
            rx={width * 0.58}
            ry={height * 0.4}
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0" stopColor={COLORS.purple} stopOpacity="0.38" />
            <Stop offset="0.55" stopColor={COLORS.purple} stopOpacity="0.24" />
            <Stop offset="1" stopColor={COLORS.purpleDeep} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        {/* Past a gradient's radius SVG pads with its last stop — transparent. */}
        <Rect x={0} y={0} width={w} height={h} fill={`url(#${GLOW_ID})`} />
        <Rect x={0} y={0} width={w} height={h} fill={`url(#${SHADOW_ID})`} />
      </Svg>
    </View>
  );
}

const st = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
});

export default ArtGlow;
