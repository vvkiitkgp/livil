import React from 'react';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { COLORS } from '../theme/colors';

/**
 * The First 100 mark: a scalloped gold seal with a white five-pointed star.
 *
 * Drawn here as raw SVG rather than registered in `Icon` because it is a brand
 * mark, not a UI icon — `Icon`'s single-`color` API cannot express the bevel
 * gradient, and every other rule about icon usage is about semantic glyphs.
 *
 * Shape decisions, all of which were tried the other way first:
 *
 *   * SEAL, NOT HEXAGON. A hexagon around a symbol is rank iconography (game
 *     tiers, XP chips). A scalloped seal is award iconography. Same gold, same
 *     star, and people read them completely differently.
 *   * FIVE POINTS, NOT SIX. A six-pointed star becomes a hexagram as its inner
 *     radius grows, and a gold six-pointed star used to mark out a category of
 *     person is the Judenstern. Not a shape to go near.
 *   * THE STAR IS LARGE relative to the seal (outer radius 31 of a 100 viewBox,
 *     against the ring's ~38.5 inner radius). Smaller, the scalloped outline
 *     dominates the silhouette and the whole mark reads as a lumpy rock rather
 *     than a star in a frame.
 *
 * No shadow and no `elevation`: Android ignores `shadowColor` and paints
 * `elevation` as a grey smudge, which on a small gold mark reads as dirt.
 */

const SEAL_PATH =
  'M50.00,2.50 L54.11,4.38 L57.50,8.68 L60.36,12.46 L63.68,13.54 L68.22,12.16 L73.49,10.68 ' +
  'L77.92,11.57 L80.14,15.51 L80.36,20.98 L80.45,25.72 L82.50,28.54 L86.98,30.10 L92.12,32.00 ' +
  'L95.18,35.32 L94.66,39.81 L91.62,44.36 L88.91,48.25 L88.50,50.00 L90.03,53.60 L93.29,57.86 ' +
  'L95.36,62.52 L94.05,66.53 L89.64,69.09 L84.50,70.62 L81.15,72.63 L80.27,76.45 L80.41,81.80 ' +
  'L79.34,86.79 L75.92,89.27 L70.85,88.75 L65.80,86.96 L61.90,86.62 L58.94,89.19 L55.91,93.60 ' +
  'L52.11,97.01 L50.00,97.50 L45.89,95.62 L42.50,91.32 L39.64,87.54 L36.32,86.46 L31.78,87.84 ' +
  'L26.51,89.32 L22.08,88.43 L19.86,84.49 L19.64,79.02 L19.55,74.28 L17.50,71.46 L13.02,69.90 ' +
  'L7.88,68.00 L4.82,64.68 L5.34,60.19 L8.38,55.64 L11.09,51.75 L11.50,50.00 L9.97,46.40 ' +
  'L6.71,42.14 L4.64,37.48 L5.95,33.47 L10.36,30.91 L15.50,29.38 L18.85,27.37 L19.73,23.55 ' +
  'L19.59,18.20 L20.66,13.21 L24.08,10.73 L29.15,11.25 L34.20,13.04 L38.10,13.38 L41.06,10.81 ' +
  'L44.09,6.40 L47.89,2.99 Z';

const STAR_PATH =
  'M50.00,19.00 L42.40,39.54 L20.52,40.42 L37.71,53.99 L31.78,75.08 L50.00,62.93 ' +
  'L68.22,75.08 L62.29,53.99 L79.48,40.42 L57.60,39.54 Z';

/**
 * Gradient ids must be unique per mounted instance: react-native-svg resolves
 * `url(#id)` against a single document, so two badges sharing an id make the
 * second one paint with the first's gradient — which on unmount leaves the
 * survivor unfilled. Same reason GradientBorder counts its own ids.
 */
let sealGradientCounter = 0;

export default function FirstHundredBadge({ size = 24 }: { size?: number }) {
  const gradientId = React.useMemo(
    () => `first100Seal${(sealGradientCounter += 1)}`,
    [],
  );

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={COLORS.goldLight} />
          <Stop offset="0.45" stopColor={COLORS.gold} />
          <Stop offset="1" stopColor={COLORS.goldDeep} />
        </LinearGradient>
      </Defs>
      <Path d={SEAL_PATH} fill={`url(#${gradientId})`} stroke={COLORS.goldDeep} strokeWidth={2} />
      <Path d={STAR_PATH} fill={COLORS.white} />
    </Svg>
  );
}
