import React from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, interpolate, Extrapolation } from 'react-native-reanimated';
import { COLORS } from '../theme/colors';
import { REVEAL_WIDTH, useSwipeReveal } from '../contexts/SwipeRevealContext';

// Row wrapper used by both ConversationScreen and ActivityCenterScreen.
//
// The bubble (passed as `children`) is rendered inside an Animated.View that
// translates left in lockstep with the screen-level pan gesture. A small
// timestamp label sits absolutely positioned to the right of the row at
// `right: -REVEAL_WIDTH`, i.e. off-screen by exactly its own width. When the
// row shifts left by REVEAL_WIDTH, the label slides into view from the right
// edge — the same trick iMessage and Instagram use.
//
// `timestamp` is rendered as plain text. Format the label upstream so this
// component stays presentational.
export default function SwipeRevealRow({
  timestamp,
  children,
}: {
  timestamp: string;
  children: React.ReactNode;
}) {
  const { panX } = useSwipeReveal();

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: panX.value }],
  }));

  // Fade the label in over the second half of the reveal so it doesn't pop
  // out the instant the user starts panning — feels more natural.
  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      -panX.value,
      [0, REVEAL_WIDTH * 0.3, REVEAL_WIDTH],
      [0, 0, 1],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    <Animated.View style={[styles.row, rowStyle]}>
      {children}
      <Animated.View style={[styles.labelWrap, labelStyle]} pointerEvents="none">
        <Text style={styles.label} numberOfLines={1}>{timestamp}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    // The row itself doesn't clip — we rely on the parent (FlatList) clipping
    // the off-screen label until it slides in.
    position: 'relative',
  },
  labelWrap: {
    position: 'absolute',
    right: -REVEAL_WIDTH,
    top: 0,
    bottom: 0,
    width: REVEAL_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  label: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '500',
  },
});
