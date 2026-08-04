import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/fonts';
import { Button } from '../../components/Button';
import { GoogleGlyph } from '../../components/GoogleGlyph';
import { BackstagePass, MiniPass, type PassRole } from '../../components/onboarding/BackstagePass';
import { Crowd } from '../../components/onboarding/Crowd';
import { ScreenBackdrop } from '../../components/onboarding/ScreenBackdrop';
import { StageLamp } from '../../components/onboarding/StageLamp';
import { signInWithGoogle } from '../../services/googleAuth';
import { useToast } from '../../contexts/ToastContext';
import type { AuthStackParamList } from '../../navigation/types';

/**
 * "Backstage Pass" — the pre-auth onboarding flow.
 *
 * Six steps: pass hand-off → role pick → itinerary → soundcheck → crowd →
 * guest list + sign-in. Deliberately silent; nothing here touches the audio
 * engine, which is not even mounted before a session exists.
 *
 * The ROLE is interaction only. It is printed onto the pass at step 6 and then
 * discarded — nothing is persisted and no backend knows about it. Do not wire it
 * to a profile column without a product decision.
 *
 * Deviations from the handoff, all deliberate:
 *  - CTAs use the app's `Button` (gradient-glow outline), not a solid #8B3DFF
 *    fill. Solid purple buttons are banned app-wide; see CLAUDE.md.
 *  - No Apple button — Apple sign-in is not implemented and the app ships
 *    Android-only today. Google and Email are wired; Apple slots in above them.
 *  - Android hardware back steps BACKWARD through the flow instead of leaving
 *    the screen. The prototype had no back affordance at all.
 *  - The "already have an account" link is added; the handoff's three auth
 *    buttons all read as sign-UP to a returning user.
 */

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Onboarding'>;
};

const STEPS = 6;

const ROLES: Array<{ key: PassRole; initial: string; chip: string; desc: string }> = [
  { key: 'ARTIST', initial: 'A', chip: COLORS.purple, desc: 'You make the thing. Demos, drops, DMs.' },
  { key: 'FAN', initial: 'F', chip: COLORS.purpleNeon, desc: 'You found them first. Front row forever.' },
  { key: 'CREW', initial: 'C', chip: COLORS.info, desc: 'Producer, designer, manager — the engine room.' },
];

const ITINERARY = [
  { time: '20:00', title: 'DOORS — drop a demo', sub: 'Share rough cuts with your inner circle first' },
  { time: '21:30', title: 'FRONT ROW — fan DMs', sub: 'Your realest listeners, one tap away' },
  { time: '23:00', title: 'AFTERS — green room', sub: 'Late-night collab threads with other artists' },
];

export default function BackstagePassOnboarding({ navigation }: Props) {
  const [step, setStep] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [role, setRole] = useState<PassRole | null>(null);
  const [lamps, setLamps] = useState([false, false, false]);
  const [googleBusy, setGoogleBusy] = useState(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { showToast } = useToast();

  const next = useCallback(() => setStep(s => Math.min(s + 1, STEPS - 1)), []);

  // Android back walks the flow backwards. Returning false on step 0 lets the
  // OS do its normal thing (exit), which is correct for the first screen.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === 0) { return false; }
      setStep(s => s - 1);
      return true;
    });
    return () => sub.remove();
  }, [step]);

  useEffect(() => () => {
    if (advanceTimer.current) { clearTimeout(advanceTimer.current); }
  }, []);

  const allLit = lamps.every(Boolean);

  const toggleLamp = useCallback((i: number) => {
    setLamps(prev => {
      const out = [...prev];
      out[i] = !out[i];
      return out;
    });
  }, []);

  // Auto-advance once the rig is hot — the button stays live so a user who
  // reaches for it during the 900ms still gets a response.
  useEffect(() => {
    if (step !== 3 || !allLit) { return; }
    advanceTimer.current = setTimeout(() => setStep(s => (s === 3 ? 4 : s)), 900);
    return () => {
      if (advanceTimer.current) { clearTimeout(advanceTimer.current); }
    };
  }, [step, allLit]);

  const handleGoogle = useCallback(async () => {
    setGoogleBusy(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      showToast(msg || 'Google sign-in failed. Please try again.', { kind: 'error' });
    } finally {
      setGoogleBusy(false);
    }
  }, [showToast]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
      <ScreenBackdrop />

      <StepFade step={step}>
        {step === 0 && (
          <PassHandoff
            flipped={flipped}
            onFlip={() => setFlipped(f => !f)}
            role={role}
            onNext={next}
          />
        )}
        {step === 1 && (
          <RolePick role={role} onPick={setRole} onNext={next} />
        )}
        {step === 2 && <Itinerary onNext={next} />}
        {step === 3 && (
          <Soundcheck lamps={lamps} allLit={allLit} onToggle={toggleLamp} onNext={next} />
        )}
        {step === 4 && <CrowdStep onNext={next} />}
        {step === 5 && (
          <GuestList
            role={role}
            googleBusy={googleBusy}
            onGoogle={handleGoogle}
            onEmail={() => navigation.navigate('SignUp')}
            onSignIn={() => navigation.navigate('SignIn')}
          />
        )}
      </StepFade>

      <View style={styles.dots} pointerEvents="none">
        {Array.from({ length: STEPS }, (_, i) => (
          <View
            key={i}
            style={[styles.dot, i <= step ? styles.dotOn : styles.dotOff]}
          />
        ))}
      </View>
    </SafeAreaView>
  );
}

/* ── shared chrome ───────────────────────────────────────────────────────── */

/** opacity 0→1 + translateY 16→0, replayed on every step change. */
function StepFade({ step, children }: { step: number; children: React.ReactNode }) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = 0;
    t.value = withTiming(1, { duration: 450, easing: Easing.out(Easing.ease) });
  }, [t, step]);

  const style = useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [{ translateY: (1 - t.value) * 16 }],
  }));

  return <Reanimated.View style={[styles.stepFill, style]}>{children}</Reanimated.View>;
}

function Kicker({ children }: { children: string }) {
  return <Text style={styles.kicker}>{children}</Text>;
}

function Headline({ children, size = 38 }: { children: React.ReactNode; size?: number }) {
  return <Text style={[styles.headline, { fontSize: size, lineHeight: size * 1.1 }]}>{children}</Text>;
}

function PrimaryCta({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      label={label}
      onPress={onPress}
      disabled={disabled}
      variant="primary"
      size="lg"
      fullWidth
      style={styles.cta}
      labelStyle={styles.ctaLabel}
    />
  );
}

/* ── 1. pass hand-off ────────────────────────────────────────────────────── */

function PassHandoff({
  flipped,
  onFlip,
  role,
  onNext,
}: {
  flipped: boolean;
  onFlip: () => void;
  role: PassRole | null;
  onNext: () => void;
}) {
  const flick = useSharedValue(1);

  useEffect(() => {
    // Two dips per 4s — a tired bulb, not a strobe.
    flick.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1200 }),
        withTiming(0.55, { duration: 260 }),
        withTiming(1, { duration: 400 }),
        withTiming(0.55, { duration: 260 }),
        withTiming(1, { duration: 1880 }),
      ),
      -1,
      false,
    );
  }, [flick]);

  const hintStyle = useAnimatedStyle(() => ({ opacity: flick.value }));

  return (
    <View style={styles.passStep}>
      <BackstagePass flipped={flipped} onFlip={onFlip} role={role} />
      <Reanimated.Text style={[styles.flipHint, hintStyle]}>TAP PASS TO FLIP</Reanimated.Text>
      <View style={styles.ctaSlot}>
        <PrimaryCta label="CLIP IT ON →" onPress={onNext} />
      </View>
    </View>
  );
}

/* ── 2. role pick ────────────────────────────────────────────────────────── */

function RolePick({
  role,
  onPick,
  onNext,
}: {
  role: PassRole | null;
  onPick: (r: PassRole) => void;
  onNext: () => void;
}) {
  return (
    <View style={styles.step}>
      <Kicker>LAMINATION STATION</Kicker>
      <Headline>WHO'S THE PASS FOR?</Headline>
      <Text style={styles.sub}>
        Pick one — we'll print it while you wait. You can re-laminate later.
      </Text>

      <View style={styles.roleList}>
        {ROLES.map(r => {
          const selected = role === r.key;
          return (
            <Pressable
              key={r.key}
              onPress={() => onPick(r.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.roleCard,
                selected && styles.roleCardOn,
                pressed && styles.rolePressed,
              ]}>
              <View style={[styles.roleChip, { backgroundColor: r.chip }]}>
                <Text style={styles.roleInitial}>{r.initial}</Text>
              </View>
              <View style={styles.roleCopy}>
                <Text style={styles.roleName}>{r.key}</Text>
                <Text style={styles.roleDesc}>{r.desc}</Text>
              </View>
              {selected && <Text style={styles.roleCheck}>✓</Text>}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.ctaSlot}>
        <PrimaryCta
          label={role ? 'PRINT IT →' : 'PICK A ROLE FIRST'}
          onPress={onNext}
          disabled={!role}
        />
      </View>
    </View>
  );
}

/* ── 3. itinerary ────────────────────────────────────────────────────────── */

function Itinerary({ onNext }: { onNext: () => void }) {
  return (
    <View style={styles.step}>
      <Kicker>TONIGHT'S ITINERARY</Kicker>
      <Headline>EVERY NIGHT IS A SHOW NIGHT</Headline>

      <View style={styles.itinerary}>
        {ITINERARY.map((row, i) => (
          <View
            key={row.time}
            style={[styles.itemRow, i === ITINERARY.length - 1 && styles.itemRowLast]}>
            <Text style={styles.itemTime}>{row.time}</Text>
            <View style={styles.itemCopy}>
              <Text style={styles.itemTitle}>{row.title}</Text>
              <Text style={styles.itemSub}>{row.sub}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.ctaSlot}>
        <PrimaryCta label="SOUNDCHECK →" onPress={onNext} />
      </View>
    </View>
  );
}

/* ── 4. soundcheck ───────────────────────────────────────────────────────── */

function Soundcheck({
  lamps,
  allLit,
  onToggle,
  onNext,
}: {
  lamps: boolean[];
  allLit: boolean;
  onToggle: (i: number) => void;
  onNext: () => void;
}) {
  const litCount = lamps.filter(Boolean).length;

  return (
    <View style={styles.step}>
      <Kicker>SOUNDCHECK</Kicker>
      <Headline>LIGHT THE RIG</Headline>
      <Text style={styles.sub}>
        Tap each lamp until the whole truss is hot. House rules: no show without lights.
      </Text>

      <View style={styles.stage}>
        <View style={styles.truss}>
          {Array.from({ length: 24 }, (_, i) => (
            <View
              key={i}
              style={[styles.trussSegment, i % 2 === 0 ? styles.trussDark : styles.trussDarker]}
            />
          ))}
        </View>

        {[0.22, 0.5, 0.78].map((x, i) => (
          <StageLamp key={x} x={x} index={i} lit={lamps[i]} onToggle={() => onToggle(i)} />
        ))}
      </View>

      <Text style={[styles.rigStatus, allLit && styles.rigStatusHot]}>
        {allLit ? 'RIG IS HOT. WE HAVE A SHOW.' : `${litCount} / 3 LAMPS LIT`}
      </Text>

      <View style={styles.ctaSlot}>
        <PrimaryCta
          label={allLit ? 'CUE THE CROWD →' : 'LIGHTS FIRST'}
          onPress={onNext}
          disabled={!allLit}
        />
      </View>
    </View>
  );
}

/* ── 5. crowd ────────────────────────────────────────────────────────────── */

function CrowdStep({ onNext }: { onNext: () => void }) {
  const flick = useSharedValue(1);

  useEffect(() => {
    flick.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2600 }),
        withTiming(0.72, { duration: 320 }),
        withTiming(1, { duration: 3080 }),
      ),
      -1,
      false,
    );
  }, [flick]);

  const coneStyle = useAnimatedStyle(() => ({ opacity: flick.value }));

  return (
    <View style={styles.crowdStep}>
      <Reanimated.View style={[styles.cone, coneStyle]} pointerEvents="none">
        <Svg width={340} height={480}>
          <Defs>
            <RadialGradient id="lvCone" cx="0.5" cy="0" rx="0.5" ry="1">
              <Stop offset="0" stopColor="#8B3DFF" stopOpacity={0.35} />
              <Stop offset="0.7" stopColor="#8B3DFF" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={340} height={480} fill="url(#lvCone)" />
        </Svg>
      </Reanimated.View>

      <View style={styles.crowdCopy}>
        <Headline size={42}>{'YOUR CROWD IS\nALREADY QUEUING'}</Headline>
        <Text style={styles.crowdSub}>
          Fans on livil follow artists before{'\n'}the algorithm does.
        </Text>
      </View>

      <View style={styles.crowdRow}>
        <Crowd />
      </View>

      <View style={styles.ctaSlotFlush}>
        <PrimaryCta label="OPEN THE DOORS →" onPress={onNext} />
      </View>
    </View>
  );
}

/* ── 6. guest list ───────────────────────────────────────────────────────── */

function GuestList({
  role,
  googleBusy,
  onGoogle,
  onEmail,
  onSignIn,
}: {
  role: PassRole | null;
  googleBusy: boolean;
  onGoogle: () => void;
  onEmail: () => void;
  onSignIn: () => void;
}) {
  return (
    <View style={styles.step}>
      <Kicker>THE GUEST LIST</Kicker>
      <Headline size={34}>YOUR PASS IS PRINTED</Headline>

      <View style={styles.miniWrap}>
        <MiniPass role={role} />
      </View>

      <View style={styles.authStack}>
        <Button
          label="Continue with Google"
          onPress={onGoogle}
          busy={googleBusy}
          leading={<GoogleGlyph size={18} />}
          variant="primary"
          size="lg"
          fullWidth
          style={styles.authBtn}
          labelStyle={styles.authLabel}
        />
        <Button
          label="Continue with Email"
          onPress={onEmail}
          variant="secondary"
          size="lg"
          fullWidth
          style={styles.authBtn}
          labelStyle={styles.authLabel}
        />
        {/* A bare <Text> inside a Pressable is only ~16dp tall, well under the
            44–48dp minimum touch target — it looked right and was almost
            unhittable. The padding does the work; hitSlop is belt-and-braces
            for the gap between this and the Email button above. */}
        <Pressable
          onPress={onSignIn}
          accessibilityRole="link"
          hitSlop={{ top: 10, bottom: 10, left: 24, right: 24 }}>
          {({ pressed }) => (
            <Text style={[styles.signInLink, pressed && styles.signInPressed]}>
              Already have a pass? Sign in
            </Text>
          )}
        </Pressable>
        <Text style={styles.legal}>
          By continuing you agree to soundcheck the Terms &amp; Privacy.
        </Text>
      </View>
    </View>
  );
}

/* ── styles ──────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  stepFill: { flex: 1 },

  step: { flex: 1, paddingHorizontal: 28, paddingTop: 46, paddingBottom: 44 },
  passStep: { flex: 1, alignItems: 'center', paddingHorizontal: 28, paddingBottom: 44 },
  crowdStep: { flex: 1, alignItems: 'center', paddingHorizontal: 28, paddingTop: 30, paddingBottom: 44 },

  kicker: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    letterSpacing: 3,
    color: COLORS.purpleNeon,
  },
  headline: {
    fontFamily: FONTS.display,
    color: COLORS.white,
    marginTop: 12,
  },
  sub: {
    fontFamily: FONTS.mono,
    fontSize: 13,
    lineHeight: 21,
    color: COLORS.textSecondary,
    marginTop: 12,
  },

  ctaSlot: { marginTop: 'auto' },
  ctaSlotFlush: { marginTop: 'auto', alignSelf: 'stretch' },
  cta: { paddingVertical: 18, borderRadius: 12 },
  ctaLabel: { fontFamily: FONTS.monoBold, fontSize: 16, letterSpacing: 1 },

  flipHint: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    letterSpacing: 2,
    color: COLORS.textSecondary,
    marginTop: 20,
  },

  roleList: { marginTop: 28, gap: 14 },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  roleCardOn: {
    borderColor: COLORS.purple,
    backgroundColor: COLORS.purpleDim,
  },
  rolePressed: { opacity: 0.85 },
  roleChip: {
    width: 46,
    height: 46,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleInitial: { fontFamily: FONTS.display, fontSize: 20, color: COLORS.white },
  roleCopy: { flex: 1, minWidth: 0 },
  roleName: {
    fontFamily: FONTS.monoBold,
    fontSize: 15,
    letterSpacing: 1,
    color: COLORS.white,
  },
  roleDesc: {
    fontFamily: FONTS.mono,
    fontSize: 11.5,
    color: COLORS.textSecondary,
    marginTop: 3,
  },
  roleCheck: { fontSize: 16, color: COLORS.purpleNeon },

  itinerary: { marginTop: 30 },
  itemRow: {
    flexDirection: 'row',
    gap: 16,
    paddingVertical: 18,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    borderStyle: 'dashed',
  },
  itemRowLast: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  itemTime: { fontFamily: FONTS.mono, fontSize: 13, color: COLORS.purpleNeon, width: 52 },
  itemCopy: { flex: 1, minWidth: 0 },
  itemTitle: { fontFamily: FONTS.monoBold, fontSize: 15, color: COLORS.white },
  itemSub: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
  },

  stage: { marginTop: 40, height: 300 },
  truss: {
    position: 'absolute',
    top: 0,
    left: '6%',
    right: '6%',
    height: 12,
    flexDirection: 'row',
    borderRadius: 3,
    overflow: 'hidden',
  },
  trussSegment: { flex: 1, height: 12 },
  trussDark: { backgroundColor: '#2A2438' },
  trussDarker: { backgroundColor: '#1C1729' },
  rigStatus: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    letterSpacing: 2,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  rigStatusHot: { color: COLORS.info },

  cone: { position: 'absolute', top: 0, alignSelf: 'center' },
  crowdCopy: { marginTop: 110, alignItems: 'center' },
  crowdSub: {
    fontFamily: FONTS.mono,
    fontSize: 13,
    lineHeight: 21,
    color: COLORS.textSecondary,
    marginTop: 16,
    textAlign: 'center',
  },
  crowdRow: { marginTop: 'auto' },

  miniWrap: { marginTop: 22, alignItems: 'center' },
  authStack: { marginTop: 'auto', gap: 12 },
  authBtn: { paddingVertical: 17, borderRadius: 12 },
  authLabel: { fontFamily: FONTS.monoBold, fontSize: 15 },
  signInLink: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: COLORS.purpleLight,
    textAlign: 'center',
    paddingVertical: 14,
  },
  signInPressed: { opacity: 0.6 },
  legal: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.textMuted,
    textAlign: 'center',
  },

  dots: {
    position: 'absolute',
    bottom: 14,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  dotOn: { backgroundColor: COLORS.purple },
  dotOff: { backgroundColor: 'rgba(255,255,255,0.18)' },
});
