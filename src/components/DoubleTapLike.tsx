import React, { useCallback, useEffect, useRef, type ReactNode } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  type AccessibilityActionEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
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
 * but now waits DOUBLE_TAP_MS for a second tap first.
 *
 * Built on TouchableOpacity and a timer, NOT gesture-handler taps, on purpose (code review):
 *  - a tap that stops a fling must only stop it. RN's ScrollView claims that touch through the
 *    responder system, which a TouchableOpacity honours and a native gesture-handler tap does
 *    not on iOS — the stop-tap would have played the song;
 *  - a screen reader's activate is TouchableOpacity's onPress on both platforms (Fabric iOS
 *    never routes 'activate' to onAccessibilityAction), and "Like" stays a custom action;
 *  - it keeps the press fade, and a long hold still counts as a tap on release.
 *
 * A double tap only ever LIKES (usePostLike.like) and pops a heart over the art, so a
 * double tap on a post already liked is acknowledged, never undone.
 *
 * `burst={false}` skips the heart: a Spotify repost's artwork must be shown with nothing
 * drawn over it (Spotify's guidelines, ADR-0027), so there the action row's heart is the
 * only feedback.
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
  const pendingTap = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A card scrolled away mid-wait must not act on the tap.
  useEffect(() => () => {
    if (pendingTap.current) { clearTimeout(pendingTap.current); }
  }, []);

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

  const handlePress = useCallback(() => {
    if (pendingTap.current) {
      clearTimeout(pendingTap.current);
      pendingTap.current = null;
      handleDoubleTap();
      return;
    }
    pendingTap.current = setTimeout(() => {
      pendingTap.current = null;
      onSingleTap();
    }, DOUBLE_TAP_MS);
  }, [handleDoubleTap, onSingleTap]);

  const heartStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const onAccessibilityAction = useCallback((e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'like') { handleDoubleTap(); }
  }, [handleDoubleTap]);

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={handlePress}
      style={style}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityActions={[{ name: 'like', label: 'Like' }]}
      onAccessibilityAction={onAccessibilityAction}
    >
      {children}
      {burst ? (
        <Animated.View pointerEvents="none" style={[styles.heartLayer, heartStyle]}>
          <Icon name="heart" size={HEART_SIZE} color={LIKED_PINK} weight="fill" />
        </Animated.View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  heartLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
});
