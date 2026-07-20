import React from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from 'react-native-svg';
import { COLORS } from '../theme/colors';

/**
 * Draws a glowing purple gradient OUTLINE (stroke only, no fill) that fills its
 * parent. Sits behind the parent's content as an absolute overlay.
 *
 * React Native has no native gradient-border support, so this strokes a rounded
 * <Rect> with an SVG linear gradient — same approach (and same dependency) as
 * EmojiCoverArt, rather than adding react-native-linear-gradient. See CLAUDE.md
 * "no new packages".
 *
 * Why an SVG and not a shadow: `shadowColor` is iOS-only, and Android's
 * `elevation` paints a grey shadow that reads as a smudge on a dark outlined
 * button. A stroked border renders identically on both platforms.
 *
 * The glow is three concentric strokes — a crisp core plus two wider, fainter
 * passes — which fakes a bloom without needing SVG filters (RNSVG's filter
 * support is uneven across platforms) and without a colored shadow.
 *
 * The bloom is drawn INWARD, not outward: every stroke's outer edge sits on the
 * component's own bounds. Android ViewGroups clip children by default, so an
 * outward halo would be silently cut off on the primary target platform.
 *
 * The gradient sweeps deep→bright→light→neon rather than a plain two-stop ramp;
 * the light stop lands off-center and reads as a glint travelling the edge.
 */
export type GradientBorderProps = {
  /** Must match the parent's borderRadius so the outline traces its shape. */
  borderRadius: number;
  /** Width of the crisp core stroke. The bloom scales off this. */
  strokeWidth?: number;
  /** Set false for a flat single-stroke border with no bloom. */
  glow?: boolean;
};

let gradientCounter = 0;
function nextGradientId(): string {
  gradientCounter += 1;
  return `lvborder_${gradientCounter}`;
}

/**
 * Widest + faintest first so the crisp core paints last, on top.
 *
 * Six closely-spaced layers rather than two: a large jump between stroke widths
 * reads as visible concentric rings, not a glow. The opacity roughly halves each
 * step out, approximating a gaussian falloff.
 */
const BLOOM_LAYERS = [
  { scale: 8, opacity: 0.018 },
  { scale: 6.2, opacity: 0.035 },
  { scale: 4.6, opacity: 0.065 },
  { scale: 3.4, opacity: 0.11 },
  { scale: 2.5, opacity: 0.18 },
  { scale: 1.8, opacity: 0.28 },
];

/**
 * The bloom must not swallow small controls: on a 36px pill an unclamped 12px
 * inward glow leaves almost no clear interior. Cap total spread to a fraction of
 * the shortest side so pills stay crisp while large CTAs glow properly.
 */
const MAX_BLOOM_FRACTION = 0.22;

/**
 * Small controls drop to every other bloom layer. Two reasons: the clamp already
 * compresses their spread so the extra passes overlap into the same few pixels
 * and add nothing visible, and the `sm` Repost pill renders on every feed card —
 * halving its <Rect> count keeps a long scroll cheap.
 */
const COMPACT_THRESHOLD = 44;

export function GradientBorder({
  borderRadius,
  strokeWidth = 1.5,
  glow = true,
}: GradientBorderProps) {
  const [size, setSize] = React.useState({ w: 0, h: 0 });

  const onLayout = React.useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize(prev => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  }, []);

  // Stable id per mount — <Defs> are scoped to their own <Svg>, so collisions
  // across instances are harmless, but a stable id avoids re-creating the def.
  const gId = React.useMemo(() => nextGradientId(), []);

  const minSide = Math.min(size.w, size.h);
  const maxBloom = minSide * MAX_BLOOM_FRACTION;
  const layers = React.useMemo(
    () => (minSide < COMPACT_THRESHOLD ? BLOOM_LAYERS.filter((_, i) => i % 2 === 1) : BLOOM_LAYERS),
    [minSide],
  );

  const strokeFor = React.useCallback(
    (width: number, opacity: number, key?: string) => {
      const inset = width / 2;
      return (
        <Rect
          key={key}
          x={inset}
          y={inset}
          width={Math.max(0, size.w - width)}
          height={Math.max(0, size.h - width)}
          rx={Math.max(0, borderRadius - inset)}
          fill="none"
          stroke={`url(#${gId})`}
          strokeWidth={width}
          opacity={opacity}
        />
      );
    },
    [size.w, size.h, borderRadius, gId],
  );

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      {size.w > 0 && size.h > 0 ? (
        <Svg width={size.w} height={size.h}>
          <Defs>
            <SvgLinearGradient id={gId} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={COLORS.purpleRoyal} stopOpacity="1" />
              <Stop offset="0.45" stopColor={COLORS.purple} stopOpacity="1" />
              <Stop offset="0.72" stopColor={COLORS.purpleLight} stopOpacity="1" />
              <Stop offset="1" stopColor={COLORS.purpleNeon} stopOpacity="1" />
            </SvgLinearGradient>
          </Defs>
          {glow
            ? layers.map(l =>
                strokeFor(
                  Math.min(strokeWidth * l.scale, maxBloom),
                  l.opacity,
                  `bloom-${l.scale}`,
                ),
              )
            : null}
          {strokeFor(strokeWidth, 1, 'core')}
        </Svg>
      ) : null}
    </View>
  );
}

export default GradientBorder;
