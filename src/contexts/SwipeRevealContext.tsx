import React, { createContext, useContext, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  type SharedValue,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

// Width of the timestamp column that slides in from the right when the user
// swipes left on a chat thread (mirrors iMessage / Instagram). Single source
// of truth — used by both the gesture clamp and the off-screen position of
// each row's timestamp label.
export const REVEAL_WIDTH = 64;

// Gesture only activates after this much leftward translation, so vertical
// scrolling on the underlying FlatList still wins on near-vertical drags.
const PAN_ACTIVATION_X = 12;
// If the user moves more than this vertically before activation, give up —
// they're scrolling, not swiping to reveal.
const PAN_FAIL_Y = 10;

const SPRING_BACK = { damping: 22, stiffness: 240, mass: 0.6 };

type Ctx = {
  panX: SharedValue<number>;
};

const SwipeRevealCtx = createContext<Ctx | null>(null);

export function SwipeRevealProvider({ children }: { children: React.ReactNode }) {
  // panX is clamped between 0 (closed) and -REVEAL_WIDTH (fully revealed).
  // Values flow through React Native's UI thread via Reanimated; only one
  // SharedValue exists per provider so every row stays in lockstep.
  const panX = useSharedValue(0);
  const value = useMemo(() => ({ panX }), [panX]);
  return (
    <SwipeRevealCtx.Provider value={value}>
      {children}
    </SwipeRevealCtx.Provider>
  );
}

// Read the pan offset. Throws if used outside a SwipeRevealProvider — that's
// always a bug at the wiring level, not a runtime fallback worth tolerating.
export function useSwipeReveal(): Ctx {
  const ctx = useContext(SwipeRevealCtx);
  if (!ctx) {
    throw new Error('useSwipeReveal must be used inside a SwipeRevealProvider');
  }
  return ctx;
}

// Wraps a chat list in a horizontal-only pan gesture that drives panX.
//
// activeOffsetX is asymmetric ([−12, +9999]) so the handler ONLY claims
// leftward motion — rightward swipes pass through untouched, leaving room
// for a future right-swipe-to-reply gesture without a Race/Simultaneous
// rewrite. failOffsetY makes sure vertical scrolling on the FlatList still
// wins when the user is scrolling rather than panning.
export function SwipeRevealGestureView({ children }: { children: React.ReactNode }) {
  const { panX } = useSwipeReveal();

  const pan = useMemo(() => Gesture.Pan()
    .activeOffsetX([-PAN_ACTIVATION_X, 9999])
    .failOffsetY([-PAN_FAIL_Y, PAN_FAIL_Y])
    .onUpdate(e => {
      'worklet';
      // Clamp to the reveal width, with a small rubber-band region past it
      // so an over-pull still feels alive but doesn't drift indefinitely.
      const raw = e.translationX;
      if (raw >= 0) {
        panX.value = 0;
        return;
      }
      if (raw >= -REVEAL_WIDTH) {
        panX.value = raw;
        return;
      }
      const overshoot = -raw - REVEAL_WIDTH;
      panX.value = -(REVEAL_WIDTH + overshoot * 0.25);
    })
    .onEnd(() => {
      'worklet';
      panX.value = withSpring(0, SPRING_BACK);
    })
    .onFinalize(() => {
      'worklet';
      // Safety: if the gesture is cancelled mid-pan (e.g. interrupted by a
      // modal), still spring back so rows don't get stuck off-screen.
      panX.value = withSpring(0, SPRING_BACK);
    }),
    [panX]);

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={styles.fill}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
