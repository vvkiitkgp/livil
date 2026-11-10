import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { GradientFill } from '../../components/GradientFill';
import { Logo } from '../../components/Logo';
import { COLORS } from '../../theme/colors';

type Props = {
  /** "Opening the Editor", "Opening your draft". */
  title: string;
  /** What it is doing right now, in plain words. */
  detail?: string;
  /** 0..1 when known; an indeterminate sweep otherwise. */
  progress?: number | null;
};

const LOGO = 132;
const BAR_W = 180;

/**
 * The Editor's loading screen: the Livil pulse beating like a heart (two quick beats and a
 * rest), a glow breathing behind it, and what is happening underneath — instead of a lone
 * spinner on a black screen.
 */
export function StudioLoading({ title, detail, progress = null }: Props) {
  const beat = useSharedValue(1);
  const glow = useSharedValue(0.25);
  const sweep = useSharedValue(0);
  const [barW, setBarW] = useState(BAR_W);
  // The bar glides to each reported step, then keeps creeping a little toward the next one, so
  // a long native read (one call, no progress of its own) never looks frozen. It never moves
  // backwards, and never reaches the end before the work does.
  const shown = useSharedValue(0);
  useEffect(() => {
    if (progress == null) return;
    cancelAnimation(shown);
    const to = Math.max(shown.value, Math.min(1, progress));
    const creep = Math.min(0.97, Math.max(to, progress + 0.08));
    shown.value = withSequence(
      withTiming(to, { duration: 400, easing: Easing.out(Easing.quad) }),
      withTiming(creep, { duration: 6000, easing: Easing.out(Easing.quad) }),
    );
  }, [progress, shown]);
  const fillStyle = useAnimatedStyle(() => ({ width: Math.max(4, barW * shown.value) }));

  useEffect(() => {
    const ease = Easing.out(Easing.quad);
    beat.value = withRepeat(
      withSequence(
        withTiming(1.08, { duration: 140, easing: ease }),
        withTiming(1, { duration: 160, easing: ease }),
        withTiming(1.05, { duration: 120, easing: ease }),
        withTiming(1, { duration: 220, easing: ease }),
        withDelay(460, withTiming(1, { duration: 0 })),
      ),
      -1,
    );
    glow.value = withRepeat(withTiming(0.6, { duration: 1100, easing: Easing.inOut(Easing.sin) }), -1, true);
    sweep.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.cubic) }), -1);
    // Reanimated keeps an infinite repeat running after unmount otherwise.
    return () => { cancelAnimation(beat); cancelAnimation(glow); cancelAnimation(sweep); cancelAnimation(shown); };
  }, [beat, glow, sweep, shown]);

  const logoStyle = useAnimatedStyle(() => ({ transform: [{ scale: beat.value }] }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value, transform: [{ scale: 0.9 + glow.value * 0.4 }] }));
  const sweepStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -barW * 0.4 + sweep.value * barW * 1.4 }] }));
  const known = progress != null;

  return (
    <View style={styles.root} accessibilityRole="progressbar" accessibilityLabel={`${title}. ${detail ?? ''}`}>
      <View style={styles.mark}>
        <Animated.View style={[styles.glow, glowStyle]} />
        <Animated.View style={logoStyle}>
          <Logo size={LOGO} color={COLORS.purpleNeon} />
        </Animated.View>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.detail}>{detail ?? ' '}</Text>
      <View style={styles.track} onLayout={e => setBarW(Math.floor(e.nativeEvent.layout.width))}>
        {known ? (
          <Animated.View style={[styles.fill, fillStyle]}>
            <GradientFill width={barW} height={4} borderRadius={2} />
          </Animated.View>
        ) : (
          <Animated.View style={[styles.sweep, { width: barW * 0.4 }, sweepStyle]}>
            <GradientFill width={barW * 0.4} height={4} borderRadius={2} />
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  mark: { width: 220, height: 120, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  glow: { position: 'absolute', width: 180, height: 90, borderRadius: 90, backgroundColor: COLORS.purpleGlow },
  title: { color: COLORS.white, fontSize: 18, fontWeight: '800' },
  detail: { color: COLORS.textSecondary, fontSize: 13, marginTop: 6, textAlign: 'center' },
  // The bar's parent clips the fill / sweep (the one place overflow: hidden is right — see CLAUDE.md).
  track: { width: BAR_W, height: 4, borderRadius: 2, backgroundColor: COLORS.card, marginTop: 22, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, overflow: 'hidden' },
  sweep: { height: 4, borderRadius: 2, overflow: 'hidden' },
});
