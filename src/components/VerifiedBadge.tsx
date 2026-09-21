import React from 'react';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { COLORS } from '../theme/colors';
import { SEAL_PATH } from './badgeShapes';

/**
 * The verified mark: the shared seal in cyan with a white check.
 *
 * PLACEHOLDER ARTWORK, deliberately. The final look is not decided, and this exists so the
 * grant path, the rail, the popup and the notification can be built and tested against a
 * real mark rather than a box. Swapping it is this one file — nothing else references the
 * artwork, only `BADGES.verified.render` in ProfileBadgeRail.
 *
 * WHY IT SHARES THE SEAL. Shape says "Livil badge", colour and glyph say which one. Same
 * outline as First 100, cyan instead of gold, a check instead of a star — related at a
 * glance, never confusable.
 *
 * WHY CYAN AND NOT PURPLE. Purple is the app's primary accent and is already everywhere on
 * a profile, including the avatar's own story ring; a purple badge would disappear into it.
 * `info` is an existing token, distinct from `gold`, and reads the way a verification mark
 * is expected to read.
 *
 * A CHECK IS A CLAIM. It says somebody confirmed this person is who they say they are. If
 * that claim has no process behind it, this is a decoration users will read as a guarantee
 * — worth settling before the first grant, not after.
 */

const CHECK_PATH =
  'M31.5,51.5 L44,64 L69,36 L76,42.5 L44,78 L24.5,58 Z';

/**
 * Unique per instance: react-native-svg resolves url(#id) against one document, so two
 * marks sharing an id make the second paint with the first's gradient — and unmounting the
 * first leaves the survivor unfilled. Same counter approach as FirstHundredBadge.
 */
let verifiedGradientCounter = 0;

export default function VerifiedBadge({ size = 24 }: { size?: number }) {
  const gradientId = React.useMemo(
    () => `verifiedSeal${(verifiedGradientCounter += 1)}`,
    [],
  );

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={COLORS.infoLight} />
          <Stop offset="0.45" stopColor={COLORS.info} />
          <Stop offset="1" stopColor={COLORS.infoDeep} />
        </LinearGradient>
      </Defs>
      <Path d={SEAL_PATH} fill={`url(#${gradientId})`} stroke={COLORS.infoDeep} strokeWidth={2} />
      <Path d={CHECK_PATH} fill={COLORS.white} />
    </Svg>
  );
}
