import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Reanimated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { COLORS } from '../theme/colors';
import { haptics } from '../utils/haptics';
import { CLOSE_HOLD_MS, CLOSE_TARGET_REST_SIZE, CLOSE_TARGET_SIZE } from '../utils/playerCloseGesture';
import { Icon } from './Icon';

const AnimatedCircle = Reanimated.createAnimatedComponent(Circle);

const HOLD_SECONDS = Math.round(CLOSE_HOLD_MS / 1000);
const RING_WIDTH = 4;
// 1dp in from the edge: a stroke exactly on the canvas boundary gets clipped on Android.
const RING_R = CLOSE_TARGET_SIZE / 2 - RING_WIDTH / 2 - 1;
const RING_LEN = 2 * Math.PI * RING_R;
const BORDER_WIDTH = 2;
const REST_SCALE = CLOSE_TARGET_REST_SIZE / CLOSE_TARGET_SIZE;

type Props = {
  /** The circle is being pulled down: dim the screen and show the X. */
  visible: boolean;
  /** The circle is on the X: run the countdown. Leaving the X cancels it. */
  holding: boolean;
  /** Distance of the X from the bottom of the screen. */
  bottom: number;
  /** The circle stayed on the X for the full hold. */
  onHoldComplete: () => void;
};

/**
 * The X the floating player's circle is dragged onto to close the player. It never takes a
 * touch: the circle's own pan gesture decides when it is `visible` and `holding`, and this
 * only draws that and times the hold.
 */
export default function PlayerCloseTarget({ visible, holding, bottom, onHoldComplete }: Props) {
  const shown = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(shown, { toValue: visible ? 1 : 0, duration: 150, useNativeDriver: true }).start();
  }, [visible, shown]);

  const grown = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(grown, { toValue: holding ? 1 : 0, useNativeDriver: true, bounciness: 8, speed: 24 }).start();
  }, [holding, grown]);

  const [secondsLeft, setSecondsLeft] = useState(HOLD_SECONDS);
  const progress = useSharedValue(0);
  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: RING_LEN * (1 - progress.value),
  }));

  const onHoldCompleteRef = useRef(onHoldComplete);
  onHoldCompleteRef.current = onHoldComplete;

  useEffect(() => {
    if (!holding) { return; }
    haptics.impact();
    progress.value = withTiming(1, { duration: CLOSE_HOLD_MS, easing: Easing.linear });
    // The finger covers the ring, so each second is also felt.
    const timers = Array.from({ length: HOLD_SECONDS - 1 }, (_, i) => setTimeout(() => {
      haptics.select();
      setSecondsLeft(HOLD_SECONDS - 1 - i);
    }, (i + 1) * 1000));
    timers.push(setTimeout(() => onHoldCompleteRef.current(), CLOSE_HOLD_MS));
    return () => {
      timers.forEach(clearTimeout);
      cancelAnimation(progress);
      progress.value = 0;
      setSecondsLeft(HOLD_SECONDS);
    };
  }, [holding, progress]);

  const scale = Animated.multiply(
    shown.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }),
    grown.interpolate({ inputRange: [0, 1], outputRange: [REST_SCALE, 1] }),
  );

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: shown }]} pointerEvents="none">
      <Text style={styles.label}>
        {holding
          ? `Keep holding for ${secondsLeft} ${secondsLeft === 1 ? 'second' : 'seconds'} to close`
          : 'Drag on X to close'}
      </Text>
      <View style={[styles.anchor, { bottom }]}>
        <Animated.View style={[styles.target, holding && styles.targetHolding, { transform: [{ scale }] }]}>
          <Icon name="close" size={30} color={COLORS.white} />
          <Svg width={CLOSE_TARGET_SIZE} height={CLOSE_TARGET_SIZE} style={styles.ring}>
            <AnimatedCircle
              cx={CLOSE_TARGET_SIZE / 2}
              cy={CLOSE_TARGET_SIZE / 2}
              r={RING_R}
              fill="none"
              stroke={COLORS.white}
              strokeWidth={RING_WIDTH}
              strokeDasharray={RING_LEN}
              animatedProps={ringProps}
            />
          </Svg>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(0,0,0,0.8)', alignItems: 'center', justifyContent: 'center' },
  anchor: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  // "Keep holding for 2 seconds to close" can wrap on a narrow phone: centre it, off the edges.
  label: { color: COLORS.white, fontSize: 20, fontWeight: '700', textAlign: 'center', paddingHorizontal: 32 },
  target: {
    width: CLOSE_TARGET_SIZE,
    height: CLOSE_TARGET_SIZE,
    borderRadius: CLOSE_TARGET_SIZE / 2,
    borderWidth: BORDER_WIDTH,
    borderColor: COLORS.white,
    backgroundColor: 'rgba(10,10,15,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetHolding: { backgroundColor: COLORS.error, borderColor: COLORS.error },
  // Starts the sweep at 12 o'clock. The offset cancels the target's border, which insets children.
  ring: { position: 'absolute', left: -BORDER_WIDTH, top: -BORDER_WIDTH, transform: [{ rotate: '-90deg' }] },
});
