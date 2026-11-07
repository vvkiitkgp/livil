import React, { useMemo } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { haptics } from '../utils/haptics';
import { isSwipeBack } from '../utils/swipeBack';

/** How far in from the screen's left edge a swipe may start. */
const EDGE_WIDTH = 24;

/**
 * Swiping right from the left edge of a tab goes Home, on iPhone. Android's system back gesture
 * already does this (the navigator's `firstRoute` back behaviour), but a tab root on iOS has no
 * screen behind it for the system's own swipe to return to.
 *
 * Only from the edge and only rightward, so vertical scrolling and anything else on the screen keep
 * their touches.
 */
export default function TabSwipeBack({
  navigation,
  children,
}: {
  navigation: { navigate: (name: 'Home') => void };
  children: React.ReactNode;
}) {
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .hitSlop({ left: 0, width: EDGE_WIDTH })
        .activeOffsetX(12)
        .failOffsetY([-16, 16])
        .runOnJS(true)
        .onEnd((e, success) => {
          if (!success || !isSwipeBack(e.translationX, e.velocityX)) { return; }
          // The same tick as tapping a tab.
          haptics.select();
          // Tabs are otherwise unreachable with the keyboard up, because it covers the bar.
          Keyboard.dismiss();
          navigation.navigate('Home');
        }),
    [navigation],
  );
  return (
    <GestureDetector gesture={pan}>
      <View style={styles.fill}>{children}</View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
