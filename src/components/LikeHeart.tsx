import React, { useEffect, useRef } from 'react';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { Icon } from './Icon';
import { COLORS } from '../theme/colors';

/** The liked heart's pink, as on the cards' action row. */
const LIKED_PINK = '#FF4D6D';
/** The bounce's top: size and how far it rises toward the artwork, in dp. */
const PEAK_SCALE = 1.9;
const PEAK_LIFT = 14;

/**
 * A post card's like heart, with one big bounce on every like (owner, 2026-10-19): it
 * swells to nearly twice its size and lifts toward the artwork, then drops straight back —
 * one bounce, no wobble (a spring that overshot read as too much). Nothing above it clips:
 * a view's overflow is visible by default, and the card's padding gives it the room.
 *
 * `pulse` comes from usePostLike and goes up on each like from the heart AND each double tap
 * on the artwork — including a double tap on a post already liked, which changes nothing
 * but still answers the tap. Never on an unlike. The first value is the mount's, so a card
 * does not bounce as it scrolls into view.
 */
export function LikeHeart({ liked, pulse, size }: { liked: boolean; pulse: number; size: number }) {
  const scale = useSharedValue(1);
  const lift = useSharedValue(0);
  const lastPulse = useRef(pulse);

  useEffect(() => {
    if (pulse === lastPulse.current) { return; }
    lastPulse.current = pulse;
    const up = { duration: 140, easing: Easing.out(Easing.cubic) };
    const down = { duration: 200, easing: Easing.in(Easing.quad) };
    scale.value = withSequence(withTiming(PEAK_SCALE, up), withTiming(1, down));
    lift.value = withSequence(withTiming(-PEAK_LIFT, up), withTiming(0, down));
  }, [pulse, scale, lift]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value }, { scale: scale.value }],
  }));

  return (
    <Animated.View style={style}>
      <Icon
        name="heart"
        size={size}
        color={liked ? LIKED_PINK : COLORS.white}
        weight={liked ? 'fill' : 'regular'}
      />
    </Animated.View>
  );
}
