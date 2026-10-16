import React from 'react';
import { StyleSheet, View } from 'react-native';
import { COLORS } from '../theme/colors';
import { Logo } from './Logo';

/** How much of the circle's width the mark spans. */
const MARK_SHARE = 0.82;

/**
 * livil Bot's picture: the vector pulse mark (the app icon's artwork) on a black circle.
 *
 * Replaces `assets/livil-logo.png` everywhere the bot appears — the Messages row, the
 * thread header, beside every message, the empty thread. That bitmap's mark filled barely
 * half its circle and read as a thin squiggle at avatar sizes; one component keeps every
 * place the bot shows up identical.
 */
export function LivilBotAvatar({ size }: { size: number }) {
  return (
    <View
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Logo size={size * MARK_SHARE} color={COLORS.white} />
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
