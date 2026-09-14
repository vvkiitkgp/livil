import React, { useCallback, useState } from 'react';
import { View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { COLORS } from '../theme/colors';
import { Logo } from './Logo';

/**
 * What a track shows instead of cover art (or, for a video, instead of a
 * thumbnail): the Livil mark on a solid black tile.
 *
 * Opaque, not transparent. A cover is a picture — it occupies its frame and has
 * edges. Letting the backdrop through makes the frame ambiguous, worst of all in
 * the fullscreen player where the art card carries a halo and a cast shadow that
 * need something solid to sit against.
 *
 * Replaces the two coloured blobs that used to fill this role in four different
 * components, each with its own hand-tuned copy of the same two circles.
 *
 * ── The one place this cannot be used ────────────────────────────────────────
 * The LOCK SCREEN / media notification. That artwork comes from
 * `buildNowPlayingMetadata`'s `imageUri`, which must be a reachable REMOTE URL —
 * a rendered component has none. A coverless track therefore still shows a blank
 * artwork tile there, exactly as it did before. Putting the mark on the lock
 * screen means hosting a real image file.
 */

// Both taken from the real app icon (docs/favicon.svg) rather than tuned by eye,
// so a coverless track shows the mark exactly as it appears on the home screen:
// a 160-wide glyph on a 200 tile, pure white on the app's black. Do not dim it —
// an alpha here reads as a greyed-out or half-loaded asset, not as branding.
const MARK_SCALE = 160 / 200;
const MARK_COLOR = '#FFFFFF';

export default function CoverFallback() {
  const [side, setSide] = useState(0);

  // Sized from the container rather than a prop, so a 60dp floating player and a
  // full-width art card both get a proportionate mark with nothing to tune.
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSide(Math.floor(Math.min(width, height)));
  }, []);

  return (
    <View style={styles.fill} onLayout={onLayout} pointerEvents="none">
      {side > 0 ? <Logo size={Math.round(side * MARK_SCALE)} color={MARK_COLOR} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bg,
  },
});
