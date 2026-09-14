import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/**
 * One lamp on the soundcheck truss. Tapping it toggles the light.
 *
 * The design draws the beam as a CSS border triangle — 52px transparent sides
 * over a 210px solid top edge, which paints a wedge that is full-width at the
 * lamp and points DOWN to a point. React Native has no border-triangle trick, so
 * this is an SVG polygon with the same geometry: top edge across the full 104px,
 * apex at bottom centre.
 *
 * The spec's `filter: blur(2px)` on the beam is dropped — RN has no cheap view
 * blur, and at 22% opacity over a near-black stage the hard edge is not visible
 * enough to justify a blur library.
 */

const BEAM_W = 104;
const BEAM_H = 210;

export type StageLampProps = {
  lit: boolean;
  onToggle: () => void;
  /** Horizontal centre as a fraction of the stage width (0.22 / 0.5 / 0.78). */
  x: number;
  index: number;
};

export function StageLamp({ lit, onToggle, x, index }: StageLampProps) {
  const on = useSharedValue(lit ? 1 : 0);

  useEffect(() => {
    on.value = withTiming(lit ? 1 : 0, {
      duration: 300,
      easing: Easing.out(Easing.quad),
    });
  }, [on, lit]);

  const housingStyle = useAnimatedStyle(() => ({
    backgroundColor: on.value > 0.5 ? '#3A3050' : '#211B30',
    shadowOpacity: 0.65 * on.value,
  }));

  const lensStyle = useAnimatedStyle(() => ({
    backgroundColor: on.value > 0.5 ? '#C9B6FF' : '#0D0B12',
  }));

  const beamStyle = useAnimatedStyle(() => ({ opacity: on.value }));

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: lit }}
      accessibilityLabel={`Stage lamp ${index + 1}`}
      style={[styles.lamp, { left: `${x * 100}%` }]}>
      <View style={styles.stem} />

      <Reanimated.View style={[styles.housing, housingStyle]}>
        <Reanimated.View style={[styles.lens, lensStyle]} />
      </Reanimated.View>

      <Reanimated.View style={[styles.beam, beamStyle]} pointerEvents="none">
        <Svg width={BEAM_W} height={BEAM_H}>
          <Polygon
            points={`0,0 ${BEAM_W},0 ${BEAM_W / 2},${BEAM_H}`}
            fill="rgba(139,61,255,0.22)"
          />
        </Svg>
      </Reanimated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  lamp: {
    position: 'absolute',
    top: 12,
    width: 64,
    marginLeft: -32,
    alignItems: 'center',
  },
  stem: {
    width: 8,
    height: 14,
    backgroundColor: '#2A2438',
  },
  housing: {
    width: 44,
    height: 52,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 5,
    // iOS-only glow. Android deliberately gets no `elevation` — it paints as a
    // grey smudge rather than a purple halo (see CLAUDE.md); the beam and the
    // lit lens carry the "on" state there.
    shadowColor: '#8B3DFF',
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  lens: {
    width: 26,
    height: 10,
    borderRadius: 5,
  },
  beam: {
    marginTop: 2,
  },
});
