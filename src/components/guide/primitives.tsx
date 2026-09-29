import React, { useEffect } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Reanimated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type AnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/fonts';
import { Icon, type IconName } from '../Icon';
import { kf, type Stop } from './timeline';

/**
 * Shared parts of the first-run guide illustrations: the mini phone every card is
 * drawn inside, the floating-player circle, the "finger" that demonstrates a gesture,
 * and a few small props (equalizer bars, avatars, chips).
 *
 * All sizes are fixed dp, matching the approved mockup (a 230×460 phone inside a
 * 390-wide card). Nothing here scales with the screen on purpose: the illustrations
 * are choreographed to the pixel, and a 360-wide phone still fits the 230 frame.
 */

export const PHONE_W = 230;
export const PHONE_H = 460;
/** Width inside the frame's 2dp border — what absolute `left`/`right` insets measure from. */
export const PHONE_INNER_W = PHONE_W - 4;
export const ORB = 66;
export const ORB_BOTTOM = 30;

/** What a Reanimated.View's `style` accepts: plain styles or a `useAnimatedStyle` handle. */
export type AnimStyle = StyleProp<AnimatedStyle<ViewStyle>>;

const PURPLE_GLOW = 'rgba(168, 85, 247, 0.32)';
const FINGER_FILL = 'rgba(255, 255, 255, 0.22)';
const FINGER_RING = 'rgba(255, 255, 255, 0.85)';

/** The phone frame. `rows` draws the faded feed skeleton behind the scene. */
export function Phone({
  children,
  rows = 4,
  rowsTop = 22,
  rowsOpacity = 1,
}: {
  children?: React.ReactNode;
  rows?: number;
  rowsTop?: number;
  rowsOpacity?: number;
}) {
  return (
    <View style={styles.phone}>
      {rows > 0 ? (
        <View style={[styles.rows, { paddingTop: rowsTop, opacity: rowsOpacity }]} pointerEvents="none">
          {Array.from({ length: rows }, (_, i) => (
            <View key={i} style={styles.row} />
          ))}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/**
 * The floating-player circle, at its resting spot unless `style` moves it. The glow
 * is a larger translucent disc behind the ring — Android has no coloured shadows,
 * and `elevation` paints grey.
 */
export function Orb({
  style,
  children,
  icon = 'pause',
  glow = true,
}: {
  style?: AnimStyle;
  children?: React.ReactNode;
  icon?: IconName | null;
  glow?: boolean;
}) {
  return (
    <Reanimated.View style={[styles.orb, style]}>
      {glow ? <View style={styles.orbGlow} pointerEvents="none" /> : null}
      <View style={styles.orbRing}>
        {icon ? <Icon name={icon} size={26} color={COLORS.purpleLight} weight="fill" /> : null}
        {children}
      </View>
    </Reanimated.View>
  );
}

/** The demonstrating finger: a translucent disc with a white ring. */
export function Finger({ style }: { style?: AnimStyle }) {
  return <Reanimated.View pointerEvents="none" style={[styles.finger, style]} />;
}

/**
 * The standard "tap" choreography: appear from a slight offset, press, hold, fade.
 * `at` is the percent the finger arrives; the whole beat lasts ~26% of the loop.
 */
export function tapStops(at: number): {
  opacity: Stop[]; x: Stop[]; y: Stop[]; scale: Stop[];
} {
  return {
    opacity: [[at - 6, 0], [at, 1], [at + 14, 1], [at + 20, 0]],
    x: [[at - 6, 14], [at, 0]],
    y: [[at - 6, 14], [at, 0]],
    scale: [[at, 1], [at + 4, 0.8], [at + 8, 1]],
  };
}

/** An animated finger driven by `t` and a set of stops. */
export function TapFinger({
  t,
  at,
  left,
  top,
}: {
  t: SharedValue<number>;
  at: number;
  left: number;
  top: number;
}) {
  const s = tapStops(at);
  const style = useAnimatedStyle(() => ({
    left,
    top,
    opacity: kf(t.value, s.opacity),
    transform: [
      { translateX: kf(t.value, s.x) },
      { translateY: kf(t.value, s.y) },
      { scale: kf(t.value, s.scale) },
    ],
  }));
  return <Finger style={style} />;
}

/** Dancing equalizer bars, each on its own little loop. */
export function EqBars({
  bars = 4,
  height = 18,
  width = 4,
  gap = 4,
  color = COLORS.purpleNeon,
  style,
}: {
  bars?: number;
  height?: number;
  width?: number;
  gap?: number;
  color?: string;
  style?: AnimStyle;
}) {
  return (
    <Reanimated.View style={[{ flexDirection: 'row', alignItems: 'flex-end', height, gap }, style]}>
      {Array.from({ length: bars }, (_, i) => (
        <EqBar key={i} height={height} width={width} color={color} delay={i * 150} />
      ))}
    </Reanimated.View>
  );
}

function EqBar({ height, width, color, delay }: { height: number; width: number; color: string; delay: number }) {
  const s = useSharedValue(0.25);
  useEffect(() => {
    const timer = setTimeout(() => {
      s.value = withRepeat(withTiming(1, { duration: 300 }), -1, true);
    }, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimation(s);
    };
  }, [s, delay]);
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: s.value }] }));
  return (
    <Reanimated.View
      style={[{ width, height, borderRadius: 2, backgroundColor: color, transformOrigin: 'bottom' }, style]}
    />
  );
}

/** Initial-letter avatar. `ring` colours the border; `you` is the cyan "YOU" variant. */
export function Avatar({
  letter,
  size = 30,
  ring = COLORS.purple,
  you = false,
  style,
}: {
  letter: string;
  size?: number;
  ring?: string;
  you?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1.5,
          borderColor: you ? COLORS.info : ring,
          backgroundColor: you ? COLORS.infoBg : COLORS.purpleDeep,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Text
        style={{
          fontFamily: FONTS.monoBold,
          fontSize: you ? Math.round(size * 0.28) : Math.round(size * 0.37),
          color: you ? COLORS.infoLight : COLORS.purpleLight,
        }}
      >
        {letter}
      </Text>
    </View>
  );
}

/** Small uppercase label used for kickers and chips. */
export function Kicker({ children, color = COLORS.textSecondary, size = 9, style }: {
  children: string; color?: string; size?: number; style?: StyleProp<ViewStyle>;
}) {
  return (
    <Text style={[{ fontFamily: FONTS.mono, fontSize: size, letterSpacing: 2, color }, style as object]}>
      {children}
    </Text>
  );
}

/** Track title in the display face. */
export function TrackTitle({ children, size = 14 }: { children: string; size?: number }) {
  return (
    <Text style={{ fontFamily: FONTS.display, fontSize: size, letterSpacing: 1, color: COLORS.white, textTransform: 'uppercase' }}>
      {children}
    </Text>
  );
}

/** Cover-art rectangle (purple gradient stand-in). */
export function Cover({ height = 84, style }: { height?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.cover, { height }, style]} />;
}

const styles = StyleSheet.create({
  phone: {
    width: PHONE_W,
    height: PHONE_H,
    borderRadius: 34,
    borderWidth: 2,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bg,
    overflow: 'hidden',
  },
  rows: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    paddingHorizontal: 16,
    gap: 12,
  },
  row: {
    height: 78,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: '#1B1B2A',
  },
  orb: {
    position: 'absolute',
    left: PHONE_INNER_W / 2 - ORB / 2,
    bottom: ORB_BOTTOM,
    width: ORB,
    height: ORB,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbGlow: {
    position: 'absolute',
    width: ORB * 1.8,
    height: ORB * 1.8,
    borderRadius: ORB * 0.9,
    backgroundColor: PURPLE_GLOW,
    opacity: 0.55,
  },
  orbRing: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
    borderWidth: 2,
    borderColor: COLORS.purple,
    backgroundColor: 'rgba(10, 10, 15, 0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  finger: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: FINGER_FILL,
    borderWidth: 2,
    borderColor: FINGER_RING,
  },
  cover: {
    borderRadius: 10,
    backgroundColor: COLORS.purpleRoyal,
  },
});
