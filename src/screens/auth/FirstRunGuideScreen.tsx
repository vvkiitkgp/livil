import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, Pressable, StatusBar, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import Reanimated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/fonts';
import { Button } from '../../components/Button';
import { cardsFor, lineFor } from '../../components/guide/cards';
import { PHONE_H } from '../../components/guide/primitives';
import { haptics } from '../../utils/haptics';
import { useSpotifyAvailability } from '../../services/spotify';
import { useMyRepostsPublic } from '../../hooks/useMyRepostsPublic';

/**
 * The first-run guide: a welcome card, then fifteen looping animations, one idea each,
 * Next / Skip.
 *
 * Shown ONCE, after sign-up (past the terms and username gates) and before the first
 * Home screen; RootNavigator decides that from `profiles.guide_seen_at`, and stamps it
 * in `onDone` whether the user finished or skipped. Settings can replay it any time
 * (`mode="replay"`), where Skip and the hardware back simply close it.
 *
 * Only the current card is mounted, so exactly one illustration animates at a time and
 * leaving a card cancels its loop. The Anton / Courier Prime pairing is the same one
 * the Backstage Pass onboarding uses — this screen is that flow's continuation, which
 * is the design decision fonts.ts asks for before the faces spread further.
 */

type Props = {
  onDone: () => void;
  mode?: 'first' | 'replay';
};

export default function FirstRunGuideScreen({ onDone, mode = 'first' }: Props) {
  const [step, setStep] = useState(0);
  const cards = cardsFor(mode);
  const last = cards.length - 1;
  const card = cards[step];
  // Asked from the first card, so the answer is in by the Repost card (cached for the app).
  const { reposts: spotifyReposts } = useSpotifyAvailability();
  const myRepostsPublic = useMyRepostsPublic();

  // The illustrations are choreographed at a fixed 230×460; on a short screen the
  // whole phone is scaled down rather than reflowed, so nothing inside it moves.
  // ~330dp is the chrome around it: header, copy, dots, button, safe areas.
  const { width, height } = useWindowDimensions();
  const phoneScale = Math.min(1, Math.max(0.6, (height - 330) / PHONE_H));

  const next = useCallback(() => {
    haptics.tap();
    if (step >= last) { onDone(); } else { setStep(s => s + 1); }
  }, [step, last, onDone]);

  const skip = useCallback(() => {
    haptics.tap();
    onDone();
  }, [onDone]);

  // Android back walks the cards backwards. On the first card: a replay closes; the
  // first run does nothing (there is no "before" — the OS default would exit the app
  // in the middle of onboarding).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step > 0) { setStep(s => s - 1); return true; }
      if (mode === 'replay') { onDone(); }
      return true;
    });
    return () => sub.remove();
  }, [step, mode, onDone]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
      <Halo />

      <View style={styles.top}>
        <Text style={styles.counter}>{step + 1} / {cards.length}</Text>
        <Pressable
          onPress={skip}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={mode === 'replay' ? 'Close the guide' : 'Skip the guide'}
          style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
        >
          <Text style={styles.skipText}>{mode === 'replay' ? 'CLOSE' : 'SKIP'}</Text>
        </Pressable>
      </View>

      <StepFade step={step}>
        <View style={styles.body}>
          <View style={{ height: PHONE_H * phoneScale, justifyContent: 'center' }}>
            <View style={{ transform: [{ scale: phoneScale }] }}>
              <card.Illustration />
            </View>
          </View>
          <View style={styles.copy}>
            <Text style={styles.headline}>{card.headline}</Text>
            <Text style={styles.line}>{lineFor(card, { spotifyReposts, repostAudience: myRepostsPublic !== null })}</Text>
          </View>
        </View>
      </StepFade>

      <View style={styles.bottom}>
        <View style={styles.dots} pointerEvents="none">
          {cards.map((c, i) => (
            <View key={c.key} style={[styles.dot, i === step ? styles.dotOn : styles.dotOff]} />
          ))}
        </View>
        <Button
          label={card.cta ?? 'Next'}
          onPress={next}
          variant="primary"
          size="lg"
          // Half the content width is a FLOOR, not a fixed width. Computed from the window
          // rather than `minWidth: '50%'` because percentage sizing has failed silently in
          // RN 0.85 before. 56 = the container's horizontal padding.
          style={{ minWidth: (width - 56) / 2 }}
          // The width that actually fixes truncation goes on the LABEL: Android measures
          // letter-spaced custom-font text a few px short, and Button's content row
          // shrink-wraps the Text, so widening the button alone leaves the Text box short
          // and "SHOW ME AROUND" still ellipsized. See ctaLabelWidth.
          labelStyle={[styles.cta, { minWidth: ctaLabelWidth(card.cta ?? 'Next') }]}
        />
      </View>
    </SafeAreaView>
  );
}


// The CTA label's typography (styles.cta on a `lg` Button, 16pt). Courier Prime is
// monospaced — every glyph advances 1228/2048 em — so the label's true width is
// chars × (advance + letterSpacing), plus slack for Android's short measurement.
const CTA_FONT_SIZE = 16;
const CTA_LETTER_SPACING = 2;
const CTA_ADVANCE_EM = 1228 / 2048;
const CTA_SLACK = 8;

function ctaLabelWidth(label: string): number {
  return Math.ceil(label.length * (CTA_FONT_SIZE * CTA_ADVANCE_EM + CTA_LETTER_SPACING)) + CTA_SLACK;
}

/**
 * The violet bloom behind the illustration — the mockup's
 * `radial-gradient(circle, rgba(139,61,255,.22) 0%, transparent 66%)`. A flat disc reads
 * as a hard-edged circle; only a real gradient fades to nothing. Bounded to the bloom's
 * own box (not full-screen) for the same compositing reason as ScreenBackdrop.
 */
function Halo() {
  const { width } = useWindowDimensions();
  const size = Math.min(520, width * 1.25);
  return (
    <Svg
      pointerEvents="none"
      width={size}
      height={size}
      style={[styles.halo, { left: (width - size) / 2 }]}
    >
      <Defs>
        <RadialGradient id="guideHalo" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={COLORS.purple} stopOpacity={0.22} />
          <Stop offset="0.66" stopColor={COLORS.purple} stopOpacity={0} />
          <Stop offset="1" stopColor={COLORS.purple} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={size} height={size} fill="url(#guideHalo)" />
    </Svg>
  );
}

/** opacity 0→1 + translateY 16→0, replayed on every step change. */
function StepFade({ step, children }: { step: number; children: React.ReactNode }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = 0;
    t.value = withTiming(1, { duration: 380, easing: Easing.out(Easing.ease) });
  }, [t, step]);
  const style = useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [{ translateY: (1 - t.value) * 16 }],
  }));
  return <Reanimated.View style={[styles.fill, style]}>{children}</Reanimated.View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: 28 },
  // `left` is set inline from the window width; the SafeAreaView's horizontal padding
  // would otherwise shift a centred child.
  halo: { position: 'absolute', top: 90, marginLeft: -28 },
  top: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  counter: { fontFamily: FONTS.mono, fontSize: 12, letterSpacing: 3, color: COLORS.purpleNeon },
  skip: { paddingVertical: 10, paddingLeft: 16 },
  skipText: { fontFamily: FONTS.mono, fontSize: 13, letterSpacing: 1, color: COLORS.textSecondary },
  pressed: { opacity: 0.6 },
  fill: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 26 },
  copy: { alignItems: 'center', gap: 10, maxWidth: 300 },
  headline: {
    fontFamily: FONTS.display,
    fontSize: 34,
    lineHeight: 44,
    paddingTop: 2,
    letterSpacing: 1,
    color: COLORS.white,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  line: {
    fontFamily: FONTS.mono,
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.purpleLight,
    textAlign: 'center',
  },
  bottom: { gap: 20, alignItems: 'center', paddingBottom: 8 },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { height: 6, borderRadius: 3 },
  dotOn: { width: 18, backgroundColor: COLORS.purpleNeon },
  dotOff: { width: 6, backgroundColor: COLORS.border },
  cta: { fontFamily: FONTS.monoBold, letterSpacing: 2, textTransform: 'uppercase', textAlign: 'center' },
});
