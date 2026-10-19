import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, Pressable, StatusBar, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import Reanimated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/fonts';
import { Button } from '../../components/Button';
import { NOTIFY_ASK, cardsFor, lineFor } from '../../components/guide/cards';
import { PHONE_H } from '../../components/guide/primitives';
import { PickDone, PickThree } from '../../components/guide/PickThree';
import { PICK_COUNT, usePickThree } from '../../components/guide/pickSongs';
import { useToast } from '../../contexts/ToastContext';
import { haptics } from '../../utils/haptics';
import { notificationPermissionGranted, requestPushPermissionInteractive } from '../../services/pushNotifications';

/**
 * The first-run guide: six cards, one short line each, and a step where the new user
 * picks three songs that are reposted for them (cards.ts, PickThree.tsx).
 *
 * Shown ONCE, after sign-up (past the terms and username gates) and before the first
 * Home screen; RootNavigator decides that from `profiles.guide_seen_at` and stamps it in
 * `onDone` — and already in `onPicked`, so an app closed after the reposts never asks
 * for three songs again. The first run cannot be skipped (the owner's call, 2026-10-18):
 * there is no Skip, and the pick step's button stays off until three songs are chosen.
 * Settings can replay it any time (`mode="replay"`) without the welcome or the pick step,
 * and there CLOSE and the hardware back close it.
 *
 * Only the current card is mounted, so exactly one illustration animates at a time and
 * leaving a card cancels its loop. The Anton / Courier Prime pairing is the same one
 * the Backstage Pass onboarding uses — this screen is that flow's continuation, which
 * is the design decision fonts.ts asks for before the faces spread further.
 */

type Props = {
  onDone: () => void;
  /**
   * The signed-in account, on a first run: the last card's button then asks for
   * notifications (NOTIFY_ASK) when they are off. Omitted on a replay.
   */
  userId?: string;
  /** The three songs are reposted — the first run's one required step is done. */
  onPicked?: () => void;
  mode?: 'first' | 'replay';
};

export default function FirstRunGuideScreen({ onDone, onPicked, userId, mode = 'first' }: Props) {
  const [step, setStep] = useState(0);
  const cards = cardsFor(mode);
  const last = cards.length - 1;
  const card = cards[step];
  const pick = usePickThree();
  const { showToast } = useToast();
  const picking = card.interactive === 'pickThree' && pick.status !== 'done';

  // null until the OS answers; false = notifications are off, so the last card asks.
  const [notifyOn, setNotifyOn] = useState<boolean | null>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (mode !== 'first' || !userId) {return;}
    let alive = true;
    notificationPermissionGranted()
      .then(granted => { if (alive) {setNotifyOn(granted);} })
      .catch(() => { if (alive) {setNotifyOn(true);} }); // unknown: never block the last card
    return () => { alive = false; };
  }, [mode, userId]);
  const askNotifications = step === last && mode === 'first' && !!userId && notifyOn === false;

  const finishWithNotifications = useCallback(async () => {
    if (!userId) { onDone(); return; }
    haptics.tap();
    setAsking(true);
    // The phone's own dialog decides; the guide ends whatever the answer.
    await requestPushPermissionInteractive(userId).catch(() => false);
    setAsking(false);
    onDone();
  }, [userId, onDone]);

  // The illustrations are choreographed at a fixed 230×460; on a short screen the
  // whole phone is scaled down rather than reflowed, so nothing inside it moves.
  // ~330dp is the chrome around it: header, copy, dots, button, safe areas.
  const { width, height } = useWindowDimensions();
  const phoneScale = Math.min(1, Math.max(0.6, (height - 330) / PHONE_H));

  const next = useCallback(() => {
    haptics.tap();
    if (step >= last) { onDone(); } else { setStep(s => s + 1); }
  }, [step, last, onDone]);

  const close = useCallback(() => {
    haptics.tap();
    onDone();
  }, [onDone]);

  const { submit } = pick;
  const repostPicks = useCallback(async () => {
    const failed = await submit();
    if (failed) {
      haptics.error();
      showToast(`Couldn't repost ${failed.title}. Try again.`, { kind: 'error' });
      return;
    }
    haptics.success();
    onPicked?.();
  }, [submit, showToast, onPicked]);

  // Android back walks the cards backwards. On the first card: a replay closes; the
  // first run does nothing (there is no "before" — the OS default would exit the app
  // in the middle of onboarding). Nothing moves while the reposts are being sent.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (pick.status === 'posting') { return true; }
      if (step > 0) { setStep(s => s - 1); return true; }
      if (mode === 'replay') { onDone(); }
      return true;
    });
    return () => sub.remove();
  }, [step, mode, onDone, pick.status]);

  const left = PICK_COUNT - pick.picks.length;
  const cta = picking
    ? (left > 0 ? `Pick ${left} more` : 'Repost my 3')
    : askNotifications ? NOTIFY_ASK.cta : (card.cta ?? 'Next');

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
      <Halo />

      <View style={styles.top}>
        <Text style={styles.counter}>{step + 1} / {cards.length}</Text>
        {mode === 'replay' ? (
          <Pressable
            onPress={close}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close the guide"
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          >
            <Text style={styles.closeText}>CLOSE</Text>
          </Pressable>
        ) : picking ? (
          <Text style={styles.picked}>{pick.picks.length} of {PICK_COUNT} picked</Text>
        ) : null}
      </View>

      <StepFade step={step}>
        {card.interactive === 'pickThree' ? (
          pick.status === 'done' ? (
            <PickDone picks={pick.picks} />
          ) : (
            <PickThree
              headline={card.headline}
              line={lineFor(card, mode)}
              picks={pick.picks}
              posted={pick.posted}
              onToggle={pick.toggle}
            />
          )
        ) : (
          <View style={styles.body}>
            {card.Illustration ? (
              <View style={[styles.phoneSlot, { height: PHONE_H * phoneScale }]}>
                <View style={{ transform: [{ scale: phoneScale }] }}>
                  <card.Illustration />
                </View>
              </View>
            ) : null}
            <View style={styles.copy}>
              <Text style={styles.headline}>{card.headline}</Text>
              <Text style={styles.line}>{lineFor(card, mode)}</Text>
            </View>
          </View>
        )}
      </StepFade>

      <View style={styles.bottom}>
        <View style={styles.dots} pointerEvents="none">
          {cards.map((c, i) => (
            <View key={c.key} style={[styles.dot, i === step ? styles.dotOn : styles.dotOff]} />
          ))}
        </View>
        <Button
          label={cta}
          onPress={picking ? () => { void repostPicks(); } : askNotifications ? () => { void finishWithNotifications(); } : next}
          disabled={picking && left > 0}
          busy={pick.status === 'posting' || asking}
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
          labelStyle={[styles.cta, { minWidth: ctaLabelWidth(cta) }]}
        />
        {askNotifications ? <Text style={styles.ctaNote}>{NOTIFY_ASK.note}</Text> : null}
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
  close: { paddingVertical: 10, paddingLeft: 16 },
  closeText: { fontFamily: FONTS.mono, fontSize: 13, letterSpacing: 1, color: COLORS.textSecondary },
  picked: { fontFamily: FONTS.mono, fontSize: 12, letterSpacing: 1, color: COLORS.purpleLight },
  pressed: { opacity: 0.6 },
  fill: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 26 },
  phoneSlot: { justifyContent: 'center' },
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
  ctaNote: { marginTop: -8, fontFamily: FONTS.mono, fontSize: 12, color: COLORS.textSecondary, textAlign: 'center' },
});
