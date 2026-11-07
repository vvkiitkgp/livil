import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { COLORS } from '../theme/colors';

/** How far below the status bar the fade eases out to nothing. */
const FADE_BELOW = 20;

/**
 * A light dark fade behind the clock and battery on Home, where the feed runs up behind the status
 * bar: without it they can sit on bright artwork. A gradient rather than a blur, which read as a
 * heavy grey band over the artwork. Over the feed, under the top bar and pinned pills, and it never
 * takes a touch.
 */
export default function StatusBarFade() {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="none" style={[styles.strip, { height: insets.top + FADE_BELOW }]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="statusBarFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={COLORS.bg} stopOpacity="0.6" />
            <Stop offset="0.6" stopColor={COLORS.bg} stopOpacity="0.35" />
            <Stop offset="1" stopColor={COLORS.bg} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#statusBarFade)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 8,
  },
});
