import React, { useMemo } from 'react';
import { StyleSheet, Vibration, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';

// Per-row bidirectional swipe-to-reply, modelled on Instagram / iMessage.
//
// The bubble (passed as `children`) follows the finger in either direction up
// to MAX_PULL with a soft rubber-band region past it. Two reply icons sit
// absolutely positioned, one off-screen on each side; the one on the trailing
// edge fades in as the bubble pulls toward the opposite side.
//
// activeOffsetX is symmetric ([-12, 12]) — left and right swipes both arm a
// reply. The global timestamp-reveal gesture lives one level up, but since
// gesture-handler resolves the closest detector first, swipes that start on
// a row hit this handler instead. Swipes on empty space (gaps between rows,
// list padding) fall through to the global handler.
//
// At REPLY_THRESHOLD a single Vibration tick fires (guarded so a hold past
// the threshold doesn't keep buzzing). On release past threshold, onReply
// fires once and the bubble springs back.

const MAX_PULL = 90;
const REPLY_THRESHOLD = 60;
const ICON_GUTTER = 48;
const PAN_ACTIVATION_X = 12;
const PAN_FAIL_Y = 10;
const SPRING_CFG = { damping: 22, stiffness: 240, mass: 0.6 };
// 10ms was too short to feel on modern Android — devices like OnePlus on
// OxygenOS clamp very short vibrations down to nothing. 35ms reads as a
// crisp single tap without feeling like a buzz. iOS treats this as a
// short system vibration (no Taptic Engine without a native module).
const HAPTIC_MS = 35;

function tick() {
  // JS-side helper so the worklet can runOnJS it. Requires the VIBRATE
  // permission in AndroidManifest.xml — without it the API silently no-ops.
  Vibration.vibrate(HAPTIC_MS);
}

export default function SwipeReplyRow({
  onReply,
  children,
}: {
  // Called once per gesture when the user releases past the threshold. The
  // caller decides what to do with the trigger — typically setReplyingTo(msg).
  onReply: () => void;
  children: React.ReactNode;
}) {
  const tx = useSharedValue(0);
  // Guards `onReply` to fire at most once per gesture.
  const fired = useSharedValue(false);
  // Guards the haptic tick — only buzz on the first crossing of the
  // threshold within a single gesture, not on every frame past it.
  const hapticArmed = useSharedValue(true);

  const pan = useMemo(() => Gesture.Pan()
    .activeOffsetX([-PAN_ACTIVATION_X, PAN_ACTIVATION_X])
    .failOffsetY([-PAN_FAIL_Y, PAN_FAIL_Y])
    .onStart(() => {
      'worklet';
      fired.value = false;
      hapticArmed.value = true;
    })
    .onUpdate(e => {
      'worklet';
      const raw = e.translationX;
      const sign = raw < 0 ? -1 : 1;
      const mag = Math.abs(raw);
      const next = mag <= MAX_PULL
        ? mag
        : MAX_PULL + (mag - MAX_PULL) * 0.25;  // rubber-band
      tx.value = sign * next;

      // Fire the haptic exactly once as the user crosses the threshold.
      if (hapticArmed.value && mag >= REPLY_THRESHOLD) {
        hapticArmed.value = false;
        runOnJS(tick)();
      } else if (!hapticArmed.value && mag < REPLY_THRESHOLD * 0.85) {
        // Re-arm if they pull back below a hysteresis floor, so dragging
        // forward again still buzzes. Prevents accidental rearm jitter
        // right at the threshold.
        hapticArmed.value = true;
      }
    })
    .onEnd(e => {
      'worklet';
      if (!fired.value && Math.abs(e.translationX) >= REPLY_THRESHOLD) {
        fired.value = true;
        runOnJS(onReply)();
      }
      tx.value = withSpring(0, SPRING_CFG);
    })
    .onFinalize(() => {
      'worklet';
      tx.value = withSpring(0, SPRING_CFG);
    }),
    [tx, fired, hapticArmed, onReply]);

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
  }));

  // Left icon is revealed when the bubble pulls RIGHT (positive tx).
  const leftIconStyle = useAnimatedStyle(() => {
    const t = Math.max(tx.value, 0);
    return {
      opacity: interpolate(t, [0, REPLY_THRESHOLD * 0.4, REPLY_THRESHOLD], [0, 0.4, 1], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(t, [0, REPLY_THRESHOLD], [0.7, 1], Extrapolation.CLAMP) }],
    };
  });

  // Right icon is revealed when the bubble pulls LEFT (negative tx).
  const rightIconStyle = useAnimatedStyle(() => {
    const t = Math.max(-tx.value, 0);
    return {
      opacity: interpolate(t, [0, REPLY_THRESHOLD * 0.4, REPLY_THRESHOLD], [0, 0.4, 1], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(t, [0, REPLY_THRESHOLD], [0.7, 1], Extrapolation.CLAMP) }],
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.row, rowStyle]}>
        <Animated.View style={[styles.iconWrapLeft, leftIconStyle]} pointerEvents="none">
          <View style={styles.iconCircle}>
            <Icon name="reply" size={16} color={COLORS.purpleLight} />
          </View>
        </Animated.View>
        {children}
        <Animated.View style={[styles.iconWrapRight, rightIconStyle]} pointerEvents="none">
          <View style={styles.iconCircle}>
            <Icon name="reply" size={16} color={COLORS.purpleLight} />
          </View>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  row: { position: 'relative' },
  iconWrapLeft: {
    position: 'absolute',
    left: -ICON_GUTTER,
    top: 0, bottom: 0,
    width: ICON_GUTTER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapRight: {
    position: 'absolute',
    right: -ICON_GUTTER,
    top: 0, bottom: 0,
    width: ICON_GUTTER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1,
    borderColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
