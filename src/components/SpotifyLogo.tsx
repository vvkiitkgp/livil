import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import {
  SPOTIFY_FULL_LOGO_ASPECT,
  SPOTIFY_FULL_LOGO_PATHS,
  SPOTIFY_FULL_LOGO_VIEWBOX,
  SPOTIFY_GREEN,
  SPOTIFY_ICON_ASPECT,
  SPOTIFY_ICON_PATHS,
  SPOTIFY_ICON_VIEWBOX,
} from './spotifyLogoArtwork';

/**
 * Spotify attribution for Spotify reposts (ADR-0027) — the one place the Spotify mark is
 * drawn. Deliberately NOT an `Icon` registry entry, for the same reason there is no Apple
 * logo in `Icon`: a brand's mark is that brand's artwork, governed by its guidelines, not a
 * glyph to restyle. (App Review rejected 2.1.1 for exactly that with the Apple logo.)
 *
 * The artwork is Spotify's own, copied verbatim from the official downloads into
 * `spotifyLogoArtwork.ts` — never redrawn here.
 *
 * What Spotify's design guidelines require, and how this meets them:
 *  - use the FULL logo (icon + wordmark) wherever there is room, the icon alone only where
 *    there is not → `withName` draws Spotify's full logo. It used to pair the icon with
 *    the word "Spotify" typed in Livil's font, which the guidelines forbid (the wordmark is
 *    never re-typed);
 *  - full logo at least 70px wide, icon at least 21px → every size below is ≥ 21px tall,
 *    and the full logo is ~3.66× its height, so ≥ 77px wide at the smallest size;
 *  - Spotify Green only on a black or white background → Livil's surfaces are near-black;
 *  - unaltered: no recolouring, stretching (the aspect ratio comes from the artwork's own
 *    viewBox), rotating or effects.
 *
 * Clear space (half the icon's height around the mark) is the CALLER's margin to keep.
 */
const SIZES = { xs: 21, sm: 22, md: 24 } as const;

/** Rendered width × height for a size; exported so the guideline minimums are testable. */
export function spotifyLogoBox(
  size: keyof typeof SIZES,
  withName: boolean,
): { width: number; height: number } {
  const height = SIZES[size];
  const aspect = withName ? SPOTIFY_FULL_LOGO_ASPECT : SPOTIFY_ICON_ASPECT;
  return { width: Math.round(height * aspect), height };
}

export function SpotifyLogo({
  size = 'sm',
  withName = false,
  style,
}: {
  size?: keyof typeof SIZES;
  /** Spotify's full logo (icon + wordmark) instead of the icon alone — where there is room. */
  withName?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { width, height } = spotifyLogoBox(size, withName);
  const paths = withName ? SPOTIFY_FULL_LOGO_PATHS : SPOTIFY_ICON_PATHS;
  return (
    <View
      style={style}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Spotify"
    >
      <Svg
        width={width}
        height={height}
        viewBox={withName ? SPOTIFY_FULL_LOGO_VIEWBOX : SPOTIFY_ICON_VIEWBOX}
      >
        {paths.map((d, i) => (
          <Path key={i} d={d} fill={SPOTIFY_GREEN} />
        ))}
      </Svg>
    </View>
  );
}

export default SpotifyLogo;
