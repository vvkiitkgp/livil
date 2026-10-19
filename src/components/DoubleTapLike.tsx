import React, { useCallback, useMemo, type ReactNode } from 'react';
import { StyleSheet, View, type AccessibilityActionEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Icon } from './Icon';

/**
 * Double-tap a feed card's artwork to like it (owner, 2026-10-19).
 *
 * A single tap still does what it did — play, open the full-screen player, open Spotify —
 * but now waits out the window for a second tap first. DOUBLE_TAP_MS keeps that wait short
 * enough that play still feels immediate (gesture-handler's default is 500 ms).
 *
 * A double tap only ever LIKES (usePostLike.like) and pops a heart over the art, so a
 * double tap on a post already liked is acknowledged, never undone.
 *
 * `burst={false}` skips the heart: a Spotify repost's artwork must be shown with nothing
 * drawn over it (Spotify's guidelines, ADR-0027), so there the action row's heart filling
 * in is the only feedback.
 *
 * A screen reader's double tap IS "activate", so it can't reach this gesture; the view
 * offers "Like" as an accessibility action instead.
 */
const DOUBLE_TAP_MS = 250;
const HEART_SIZE = 96;
/** The liked heart's pink, as on the cards' action row. */
const LIKED_PINK = '#FF4D6D';

export function DoubleTapLike({
  children,
  style,
  onSingleTap,
  onDoubleTap,
  accessibilityLabel,
  burst = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onSingleTap: () => void;
  onDoubleTap: () => void;
  accessibilityLabel: string;
  burst?: boolean;
}) {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);

  const handleDoubleTap = useCallback(() => {
    if (burst) {
      scale.value = 0;
      opacity.value = 1;
      scale.value = withSequence(
        withSpring(1.15, { damping: 9, stiffness: 260 }),
        withTiming(1, { duration: 120 }),
      );
      opacity.value = withDelay(450, withTiming(0, { duration: 250 }));
    }
    onDoubleTap();
  }, [burst, onDoubleTap, opacity, scale]);

  const gesture = useMemo(() => {
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDelay(DOUBLE_TAP_MS)
      .runOnJS(true)
      .onEnd((_e, ok) => { if (ok) { handleDoubleTap(); } });
    const singleTap = Gesture.Tap()
      .numberOfTaps(1)
      .runOnJS(true)
      .onEnd((_e, ok) => { if (ok) { onSingleTap(); } });
    return Gesture.Exclusive(doubleTap, singleTap);
  }, [handleDoubleTap, onSingleTap]);

  const heartStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const onAccessibilityAction = useCallback((e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'activate') { onSingleTap(); }
    if (e.nativeEvent.actionName === 'like') { handleDoubleTap(); }
  }, [onSingleTap, handleDoubleTap]);

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={style}
        collapsable={false}
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityActions={[{ name: 'activate' }, { name: 'like', label: 'Like' }]}
        onAccessibilityAction={onAccessibilityAction}
      >
        {children}
        {burst ? (
          <Animated.View pointerEvents="none" style={[styles.heartLayer, heartStyle]}>
            <Icon name="heart" size={HEART_SIZE} color={LIKED_PINK} weight="fill" />
          </Animated.View>
        ) : null}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  heartLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
});
