import React from 'react';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { COLORS } from '../theme/colors';
import { SEAL_PATH } from './badgeShapes';

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
