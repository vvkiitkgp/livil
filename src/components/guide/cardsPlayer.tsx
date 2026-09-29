import React from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/fonts';
import { Icon } from '../Icon';
import { kf, useLoop } from './timeline';
import { EqBars, Finger, Orb, Phone, PHONE_INNER_W, ORB, ORB_BOTTOM, TrackTitle } from './primitives';

/**
 * Cards 1–4: the floating player, one gesture each. Stops are transcribed from the
 * approved CSS mockup (percent of the loop → value); see timeline.ts.
 */

// Finger resting spot when it "touches" the circle: slightly right of and below
// the orb's centre, as a real thumb would land.
const FINGER_LEFT = PHONE_INNER_W / 2 - 8;
const FINGER_BOTTOM = ORB_BOTTOM - 6;

/* ── 1. Tap: play / pause ─────────────────────────────────────────────────── */
export function TapIllustration() {
  const t = useLoop(6000);

  const finger = useAnimatedStyle(() => ({
    left: FINGER_LEFT,
    bottom: FINGER_BOTTOM,
    opacity: kf(t.value, [[0, 0], [12, 0], [20, 1], [40, 1], [48, 0], [62, 0], [70, 1], [90, 1], [98, 0], [100, 0]]),
    transform: [
      { translateX: kf(t.value, [[0, 14], [12, 14], [20, 0], [48, 0], [62, 14], [70, 0], [100, 0]]) },
      { translateY: kf(t.value, [[0, -14], [12, -14], [20, 0], [48, 0], [62, -14], [70, 0], [100, 0]]) },
      { scale: kf(t.value, [[20, 1], [26, 0.8], [32, 1], [70, 1], [76, 0.8], [82, 1]]) },
    ],
  }));
  const orb = useAnimatedStyle(() => ({
    transform: [{ scale: kf(t.value, [[24, 1], [28, 0.86], [36, 1], [74, 1], [78, 0.86], [86, 1]]) }],
  }));
  const ring = useAnimatedStyle(() => ({
    opacity: kf(t.value, [[0, 0], [27, 0], [28, 0.9], [55, 0], [77, 0], [78, 0.9], [100, 0]]),
    transform: [{ scale: kf(t.value, [[0, 1], [27, 1], [55, 2.2], [77, 1], [100, 2.2]]) }],
  }));
  const playIcon = useAnimatedStyle(() => ({ opacity: kf(t.value, [[27, 1], [29, 0], [77, 0], [79, 1]]) }));
  const pauseIcon = useAnimatedStyle(() => ({ opacity: kf(t.value, [[27, 0], [29, 1], [77, 1], [79, 0]]) }));
  const eq = useAnimatedStyle(() => ({ opacity: kf(t.value, [[28, 0], [30, 1], [76, 1], [78, 0]]) }));

  return (
    <Phone>
      <EqBars style={[styles.eqAboveOrb, eq]} />
      <Reanimated.View style={[styles.ripple, ring]} pointerEvents="none" />
      <Orb style={orb} icon={null}>
        <Reanimated.View style={[StyleSheet.absoluteFill, styles.center, playIcon]}>
          <Icon name="play" size={26} color={COLORS.purpleLight} weight="fill" />
        </Reanimated.View>
        <Reanimated.View style={[StyleSheet.absoluteFill, styles.center, pauseIcon]}>
          <Icon name="pause" size={24} color={COLORS.purpleLight} weight="fill" />
        </Reanimated.View>
      </Orb>
      <Finger style={finger} />
    </Phone>
  );
}

/* ── 2. Swipe up: full screen ─────────────────────────────────────────────── */
const FULL_W = 206;
const FULL_H = 436;

export function SwipeUpIllustration() {
  const t = useLoop(5000);

  const finger = useAnimatedStyle(() => ({
    left: FINGER_LEFT,
    bottom: FINGER_BOTTOM,
    opacity: kf(t.value, [[0, 0], [8, 0], [14, 1], [34, 1], [40, 0], [100, 0]]),
    transform: [{ translateY: kf(t.value, [[0, 0], [14, 0], [34, -170], [100, -170]]) }],
  }));
  // The circle grows into the full-screen frame: width/height/radius animate on the
  // UI thread; `left` is recomputed so it stays centred.
  const frame = useAnimatedStyle(() => {
    const w = kf(t.value, [[0, ORB], [14, ORB], [38, FULL_W], [70, FULL_W], [92, ORB], [100, ORB]]);
    const h = kf(t.value, [[0, ORB], [14, ORB], [38, FULL_H], [70, FULL_H], [92, ORB], [100, ORB]]);
    return {
      width: w,
      height: h,
      left: PHONE_INNER_W / 2 - w / 2,
      bottom: kf(t.value, [[0, ORB_BOTTOM], [14, ORB_BOTTOM], [38, 10], [70, 10], [92, ORB_BOTTOM], [100, ORB_BOTTOM]]),
      borderRadius: kf(t.value, [[0, 33], [14, 33], [38, 26], [70, 26], [92, 33], [100, 33]]),
    };
  });
  const art = useAnimatedStyle(() => ({ opacity: kf(t.value, [[0, 0], [20, 0], [40, 1], [70, 1], [92, 0], [100, 0]]) }));
  const title = useAnimatedStyle(() => ({ opacity: kf(t.value, [[0, 0], [34, 0], [44, 1], [68, 1], [80, 0], [100, 0]]) }));

  return (
    <Phone>
      <Reanimated.View style={[styles.growFrame, frame]}>
        <Reanimated.View style={[StyleSheet.absoluteFill, styles.art, art]}>
          <Reanimated.View style={[styles.artText, title]}>
            <TrackTitle size={22}>Midnight Loop</TrackTitle>
            <View style={styles.artBar}><View style={styles.artBarFill} /></View>
          </Reanimated.View>
        </Reanimated.View>
        <View style={styles.center}>
          <Icon name="play" size={26} color={COLORS.purpleLight} weight="fill" />
        </View>
      </Reanimated.View>
      <Finger style={finger} />
    </Phone>
  );
}

/* ── 3. Flick: next / previous ────────────────────────────────────────────── */
export function FlickIllustration() {
  const t = useLoop(4500);

  const finger = useAnimatedStyle(() => ({
    left: FINGER_LEFT,
    bottom: FINGER_BOTTOM,
    opacity: kf(t.value, [[0, 0], [10, 0], [16, 1], [26, 1], [32, 0], [100, 0]]),
    transform: [{ translateX: kf(t.value, [[0, 0], [16, 0], [26, 86], [100, 86]]) }],
  }));
  const orb = useAnimatedStyle(() => ({
    transform: [{ translateX: kf(t.value, [[0, 0], [16, 0], [26, 44], [40, -10], [52, 0], [100, 0]]) }],
  }));
  const artB = useAnimatedStyle(() => ({ opacity: kf(t.value, [[0, 0], [24, 0], [30, 1], [80, 1], [88, 0], [100, 0]]) }));
  const label = useAnimatedStyle(() => ({
    opacity: kf(t.value, [[0, 0], [26, 0], [34, 1], [70, 1], [80, 0], [100, 0]]),
    transform: [{ translateY: kf(t.value, [[0, 6], [26, 6], [34, 0], [100, 0]]) }],
  }));

  return (
    <Phone>
      <Reanimated.Text style={[styles.flickLabel, label]}>NEXT SONG</Reanimated.Text>
      <Orb style={orb} icon={null}>
        <View style={[StyleSheet.absoluteFill, styles.artA]} />
        <Reanimated.View style={[StyleSheet.absoluteFill, styles.artB, artB]} />
        <Icon name="pause" size={24} color={COLORS.purpleLight} weight="fill" />
      </Orb>
      <Finger style={finger} />
    </Phone>
  );
}

/* ── 4. Hold & drag: move it ──────────────────────────────────────────────── */
const DRAG_X = 62;
const DRAG_Y = -300;

export function DragIllustration() {
  const t = useLoop(6000);

  const finger = useAnimatedStyle(() => ({
    left: FINGER_LEFT,
    bottom: FINGER_BOTTOM,
    opacity: kf(t.value, [[0, 0], [8, 0], [14, 1], [54, 1], [60, 0], [100, 0]]),
    transform: [
      { translateX: kf(t.value, [[0, 0], [24, 0], [54, DRAG_X], [100, DRAG_X]]) },
      { translateY: kf(t.value, [[0, 0], [24, 0], [54, DRAG_Y], [100, DRAG_Y]]) },
    ],
  }));
  // The "hold" — a halo that swells while the finger rests before the drag starts.
  const hold = useAnimatedStyle(() => ({
    left: FINGER_LEFT - 10,
    bottom: FINGER_BOTTOM - 10,
    opacity: kf(t.value, [[0, 0], [14, 0], [24, 0.35], [54, 0.35], [60, 0], [100, 0]]),
    transform: [
      { translateX: kf(t.value, [[0, 0], [24, 0], [54, DRAG_X], [100, DRAG_X]]) },
      { translateY: kf(t.value, [[0, 0], [24, 0], [54, DRAG_Y], [100, DRAG_Y]]) },
      { scale: kf(t.value, [[0, 1], [14, 1], [24, 1.5], [54, 1.5], [60, 1], [100, 1]]) },
    ],
  }));
  const orb = useAnimatedStyle(() => ({
    transform: [
      { translateX: kf(t.value, [[0, 0], [24, 0], [54, DRAG_X], [82, DRAG_X], [96, 0], [100, 0]]) },
      { translateY: kf(t.value, [[0, 0], [24, 0], [54, DRAG_Y], [82, DRAG_Y], [96, 0], [100, 0]]) },
    ],
  }));

  return (
    <Phone>
      <View style={styles.ghost} />
      <Orb style={orb} />
      <Reanimated.View style={[styles.holdHalo, hold]} pointerEvents="none" />
      <Finger style={finger} />
    </Phone>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  eqAboveOrb: {
    position: 'absolute',
    left: PHONE_INNER_W / 2 - 14,
    bottom: ORB_BOTTOM + ORB + 16,
  },
  ripple: {
    position: 'absolute',
    left: PHONE_INNER_W / 2 - ORB / 2 - 2,
    bottom: ORB_BOTTOM - 2,
    width: ORB + 4,
    height: ORB + 4,
    borderRadius: (ORB + 4) / 2,
    borderWidth: 2,
    borderColor: COLORS.purpleNeon,
  },
  growFrame: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: COLORS.purple,
    backgroundColor: 'rgba(10, 10, 15, 0.94)',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  art: { backgroundColor: COLORS.purpleRoyal },
  artText: { position: 'absolute', left: 18, right: 18, bottom: 14, gap: 8 },
  artBar: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)' },
  artBarFill: { width: '38%', height: 3, borderRadius: 2, backgroundColor: COLORS.white },
  flickLabel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: ORB_BOTTOM + ORB + 14,
    textAlign: 'center',
    fontFamily: FONTS.mono,
    fontSize: 11,
    letterSpacing: 3,
    color: COLORS.purpleLight,
  },
  artA: { backgroundColor: COLORS.purpleDeep },
  artB: { backgroundColor: COLORS.infoDeep },
  ghost: {
    position: 'absolute',
    left: PHONE_INNER_W / 2 - ORB / 2,
    bottom: ORB_BOTTOM,
    width: ORB,
    height: ORB,
    borderRadius: ORB / 2,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.border,
  },
  holdHalo: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.white,
  },
});
