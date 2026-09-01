import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from 'react-native-svg';
import { COLORS } from '../theme/colors';
import { Logo } from './Logo';

/**
 * The 9:16 card that becomes an Instagram Story background.
 *
 * This component exists ONLY to be photographed by `captureRef`. It is never
 * meaningfully visible: `SharePostSheet` renders it behind its own opaque backdrop.
 * Three consequences follow from that, and all three have bitten people before:
 *
 *   1. NEVER set `opacity: 0` to hide it. `captureRef` draws the view into a bitmap
 *      including its alpha, so a hidden-by-opacity card captures as a transparent
 *      rectangle. Hide it by putting something on top, not by making it invisible.
 *
 *   2. The cover art must be DECODED before capture, not merely requested. Capturing
 *      early yields a beautifully rendered card with a grey hole where the artwork
 *      should be — and it reproduces only on a cold image cache, which is exactly
 *      never on the developer's own phone. Hence `onArtworkReady`.
 *
 *   3. It is sized in device-independent pixels from the window width, so the natural
 *      capture lands near 1080px wide on a typical phone and `captureRef` only has to
 *      normalise rather than upscale. Sizing it at a literal 1080x1920 dp instead
 *      would put most of the view outside the window, where Android's layout pass
 *      stops being reliable.
 *
 * No gradient library: the backdrop is an SVG rect on the react-native-svg already in
 * the tree, matching how GradientFill and ScreenBackdrop draw theirs.
 */

export type StoryCardProps = {
  width: number;
  height: number;
  title: string;
  artistName: string;
  coverArtUrl: string | null;
  /** Fires when the artwork has decoded — or immediately when there is none to wait
   *  for. The capture must not run before this. */
  onArtworkReady: () => void;
};

export function StoryCard({
  width,
  height,
  title,
  artistName,
  coverArtUrl,
  onArtworkReady,
}: StoryCardProps) {
  // Scale every dimension off the card width so the layout is identical whatever the
  // device density resolves the card to. A card laid out in fixed dp would be a
  // different composition on a 320dp phone than on a 440dp one.
  const u = width / 100;
  const art = Math.round(width * 0.62);

  // Nothing to decode: signal readiness on the first render rather than leaving the
  // caller waiting on an onLoad that will never fire.
  React.useEffect(() => {
    if (!coverArtUrl) { onArtworkReady(); }
  }, [coverArtUrl, onArtworkReady]);

  return (
    <View style={[styles.card, { width, height }]} collapsable={false}>
      <Svg style={StyleSheet.absoluteFill} width={width} height={height} pointerEvents="none">
        <Defs>
          <SvgLinearGradient id="storyBg" x1="0" y1="0" x2="0.35" y2="1">
            <Stop offset="0" stopColor={COLORS.bg} stopOpacity="1" />
            <Stop offset="0.55" stopColor={COLORS.purpleDeep} stopOpacity="1" />
            <Stop offset="1" stopColor={COLORS.purple} stopOpacity="1" />
          </SvgLinearGradient>
        </Defs>
        <Rect x="0" y="0" width={width} height={height} fill="url(#storyBg)" />
      </Svg>

      <View style={[styles.body, { paddingHorizontal: u * 10 }]}>
        <View style={[styles.artWrap, { width: art, height: art, borderRadius: u * 4 }]}>
          {coverArtUrl ? (
            <Image
              source={{ uri: coverArtUrl }}
              style={styles.art}
              resizeMode="cover"
              onLoad={onArtworkReady}
              // A broken image still has to release the capture, or the Story path
              // hangs on artwork that is never coming.
              onError={onArtworkReady}
            />
          ) : (
            <View style={styles.artFallback}>
              <Logo size={art * 0.34} color={COLORS.purpleLight} />
            </View>
          )}
        </View>

        <Text style={[styles.title, { fontSize: u * 7, marginTop: u * 7 }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[styles.artist, { fontSize: u * 4.4, marginTop: u * 2 }]} numberOfLines={1}>
          {artistName}
        </Text>

        <View style={[styles.brand, { marginTop: u * 9, paddingVertical: u * 2.6, paddingHorizontal: u * 5, borderRadius: 999 }]}>
          <Logo size={u * 5} color={COLORS.white} />
          <Text style={[styles.brandText, { fontSize: u * 3.6, marginLeft: u * 2.2 }]}>
            Listen on Livil
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden', backgroundColor: COLORS.bg },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // overflow:hidden is correct here — the artwork genuinely needs clipping to the
  // rounded corner. It is not a GradientBorder host.
  artWrap: { overflow: 'hidden', backgroundColor: COLORS.surface },
  art: { width: '100%', height: '100%' },
  artFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.white, fontWeight: '800', textAlign: 'center' },
  artist: { color: COLORS.purpleLight, fontWeight: '600', textAlign: 'center' },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  brandText: { color: COLORS.white, fontWeight: '700', letterSpacing: 0.3 },
});
