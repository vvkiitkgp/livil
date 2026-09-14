import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

/**
 * The silhouetted crowd along the bottom of step 5.
 *
 * Seven heads-and-shoulders of differing heights, each bobbing ±7px on its own
 * loop. The staggered, deliberately non-harmonic durations are what stop it
 * reading as a mechanical wave — keep them coprime-ish.
 *
 * The design's `filter: blur(1.5px)` is dropped (no cheap RN view blur); the
 * 0.8 opacity against the near-black backdrop carries the same recession.
 */

type Head = { height: number; duration: number; delay: number };

const HEADS: Head[] = [
  { height: 60, duration: 2800, delay: 0 },
  { height: 76, duration: 2300, delay: 200 },
  { height: 54, duration: 3100, delay: 500 },
  { height: 82, duration: 2500, delay: 100 },
  { height: 64, duration: 2900, delay: 400 },
  { height: 74, duration: 2200, delay: 300 },
  { height: 58, duration: 2700, delay: 600 },
];

function Silhouette({ head }: { head: Head }) {
  const bob = useSharedValue(0);

  useEffect(() => {
    bob.value = withDelay(
      head.delay,
      withRepeat(
        withTiming(1, { duration: head.duration, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      ),
    );
  }, [bob, head.duration, head.delay]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: (bob.value * 2 - 1) * 7 }],
  }));

  return <Reanimated.View style={[styles.head, { height: head.height }, style]} />;
}

export function Crowd() {
  return (
    <View style={styles.row} pointerEvents="none">
      {HEADS.map((h, i) => (
        <Silhouette key={i} head={h} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    width: 34,
    borderTopLeftRadius: 17,
    borderTopRightRadius: 17,
    backgroundColor: '#050408',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    gap: 9,
    opacity: 0.8,
  },
});
