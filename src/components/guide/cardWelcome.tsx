import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/fonts';

/**
 * Card 0: "You're in." The Backstage Pass from the pre-sign-in flow, now hanging from
 * its lanyard and stamped ADMITTED — the account exists, the tour starts here. The
 * stamp lands once (it is an event, not a loop); only the glow breathes.
 */
export function WelcomeIllustration() {
  const stamp = useSharedValue(0);
  const glow = useSharedValue(0);

  useEffect(() => {
    stamp.value = 0;
    stamp.value = withDelay(500, withTiming(1, { duration: 520, easing: Easing.out(Easing.back(1.6)) }));
    glow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(stamp);
      cancelAnimation(glow);
    };
  }, [stamp, glow]);

  const stampStyle = useAnimatedStyle(() => ({
    opacity: stamp.value,
    transform: [{ rotate: '-14deg' }, { scale: 2.2 - 1.2 * stamp.value }],
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: 0.35 + 0.45 * glow.value }));

  return (
    <View style={styles.wrap}>
      <Reanimated.View style={[styles.glow, glowStyle]} pointerEvents="none" />
      <View style={styles.lanyard} />
      <View style={styles.pass}>
        <View style={styles.clip} />
        <View style={styles.head}>
          <Text style={styles.brand}>Livil</Text>
          <Text style={styles.kicker}>BACKSTAGE</Text>
        </View>
        <View style={styles.rule} />
        <Row label="NAME" value="YOU" />
        <Row label="SEAT" value="FRONT ROW" />
        <Row label="VALID" value="FOREVER" />
        <Reanimated.View style={[styles.stamp, stampStyle]} pointerEvents="none">
          <Text style={styles.stampText}>Admitted</Text>
        </Reanimated.View>
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowDots} numberOfLines={1}>· · · · · · · · · · · · · · ·</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const PASS_W = 250;

const styles = StyleSheet.create({
  wrap: { width: 300, height: 380, alignItems: 'center', justifyContent: 'center' },
  glow: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: COLORS.purpleGlow,
  },
  lanyard: {
    position: 'absolute',
    top: 0,
    width: 3,
    height: 110,
    backgroundColor: COLORS.purpleDeep,
    borderRadius: 2,
  },
  pass: {
    width: PASS_W,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: COLORS.purple,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 18,
    gap: 10,
    transform: [{ rotate: '-3deg' }],
    marginTop: 40,
  },
  clip: {
    position: 'absolute',
    top: -8,
    alignSelf: 'center',
    left: PASS_W / 2 - 34,
    width: 68,
    height: 14,
    borderRadius: 7,
    backgroundColor: COLORS.border,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  brand: { fontFamily: FONTS.display, fontSize: 26, letterSpacing: 2, color: COLORS.white, textTransform: 'uppercase' },
  kicker: { fontFamily: FONTS.mono, fontSize: 11, letterSpacing: 2, color: COLORS.textSecondary },
  rule: { height: 1, backgroundColor: COLORS.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowLabel: { fontFamily: FONTS.mono, fontSize: 12, color: COLORS.textSecondary },
  rowDots: { flex: 1, fontFamily: FONTS.mono, fontSize: 12, color: COLORS.border, textAlign: 'center' },
  rowValue: { fontFamily: FONTS.monoBold, fontSize: 12, color: COLORS.purpleLight },
  stamp: {
    position: 'absolute',
    right: 14,
    bottom: 30,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderWidth: 3,
    borderColor: COLORS.info,
    borderRadius: 8,
  },
  stampText: {
    fontFamily: FONTS.display,
    fontSize: 22,
    letterSpacing: 3,
    color: COLORS.info,
    textTransform: 'uppercase',
  },
});
