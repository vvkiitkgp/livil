import React, { useEffect, useRef } from 'react';
import { Animated, type StyleProp, type TextStyle } from 'react-native';
import { COLORS } from '../theme/colors';

/**
 * A time readout that grows and brightens while the thing it names is being dragged.
 *
 * The clip handles and the playhead all live inside `WaveformScrubber`, but their
 * readouts do not — each surface lays those out itself. So while a finger is on a
 * handle, the number that says what the finger is doing sits outside the component that
 * knows. This closes that gap: the scrubber reports its active handle, the surface holds
 * it in state, and the matching label answers.
 *
 * SCALE, NOT fontSize. Animating `fontSize` reflows text on every frame and cannot use
 * the native driver, so it stutters exactly when the finger is busy. A transform runs on
 * the UI thread and costs nothing.
 *
 * `transformOrigin` is why the label does not drift: the three readouts sit at the left,
 * centre and right of a row, and a centre-origin scale would push the outer two toward
 * the edges — the left one off its own end of the track. Each grows away from the edge
 * it is pinned to.
 */

type Props = {
  children: React.ReactNode;
  /** True while this label's handle is held. */
  active: boolean;
  style?: StyleProp<TextStyle>;
  /** Colour while active. Defaults to the accent used for interactive text. */
  activeColor?: string;
  /** Which edge the label is pinned to, so it grows away from it. */
  align?: 'left' | 'center' | 'right';
};

/** Enough to be unmistakable at a glance without colliding with its neighbours. */
const ACTIVE_SCALE = 1.45;

export function ScrubTimeLabel({
  children,
  active,
  style,
  activeColor = COLORS.purpleNeon,
  align = 'center',
}: Props) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: active ? 1 : 0,
      useNativeDriver: true,
      speed: 20,
      // A little overshoot on the way up so it pops; none on the way back, so
      // releasing settles rather than wobbling.
      bounciness: active ? 10 : 0,
    }).start();
  }, [active, anim]);

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, ACTIVE_SCALE] });
  const origin = align === 'left' ? '0% 50%' : align === 'right' ? '100% 50%' : '50% 50%';

  return (
    <Animated.Text
      // The colour switch is a plain style, not an animation: interpolating colour is
      // barred from the native driver, and it would drag the scale onto the JS thread
      // with it. An instant colour change under a springing scale is not perceptible.
      style={[style, active && { color: activeColor }, { transformOrigin: origin, transform: [{ scale }] }]}
      allowFontScaling={false}
    >
      {children}
    </Animated.Text>
  );
}
