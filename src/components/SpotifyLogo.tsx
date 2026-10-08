import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { COLORS } from '../theme/colors';

/**
 * Spotify attribution for Spotify reposts (ADR-0027) — the one place the Spotify mark is
 * drawn. Deliberately NOT an `Icon` registry entry, for the same reason there is no Apple
 * logo in `Icon`: a brand's mark is that brand's artwork, governed by its guidelines, not a
 * glyph to restyle.
 *
 * What Spotify's design guidelines require, and how this meets them:
 *  - the ICON (circle + three bars) in Spotify Green on a dark background, unaltered — no
 *    recolouring, stretching, rotating or effects;
 *  - at least 21px tall on mobile — every size below is ≥ 21;
 *  - the wordmark is never re-typed in another font. `withName` adds the plain word
 *    "Spotify" in Livil's own type as a LABEL next to the icon, not as a wordmark.
 *
 * The path is the standard single-colour Spotify icon (24×24); the bars are cut-outs, so
 * they show the dark surface behind, as in Spotify's green-on-black artwork.
 *
 * TODO(before public release): swap the path for the one in Spotify's own logo download
 * (developer.spotify.com/documentation/design) so the artwork is byte-for-byte theirs.
 */
const SPOTIFY_GREEN = '#1ED760';

const ICON_PATH =
  'M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z';

const SIZES = { xs: 21, sm: 22, md: 24 } as const;

export function SpotifyLogo({
  size = 'sm',
  withName = false,
  style,
}: {
  size?: keyof typeof SIZES;
  /** Adds the word "Spotify" beside the icon, where the icon alone would not say enough. */
  withName?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const px = SIZES[size];
  return (
    <View
      style={[styles.wrap, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Spotify"
    >
      <Svg width={px} height={px} viewBox="0 0 24 24">
        <Path d={ICON_PATH} fill={SPOTIFY_GREEN} />
      </Svg>
      {withName ? <Text style={[styles.name, size === 'md' && styles.nameMd]}>Spotify</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: COLORS.white, fontSize: 13, fontWeight: '700' },
  nameMd: { fontSize: 14 },
});

export default SpotifyLogo;
