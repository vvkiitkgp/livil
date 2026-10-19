import React from 'react';
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/fonts';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { ScreenBackdrop } from '../onboarding/ScreenBackdrop';

/**
 * One step of sign-up, in the onboarding's look (owner's design, 2026-10-19): a kicker,
 * an Anton headline, one short line, the fields, then the button and the step dots at the
 * bottom. Shared by email sign-up, the Google / Apple "almost done" steps and the photo
 * step, so the three read as one flow.
 *
 * The button stays above the keyboard: keyboard-controller's KeyboardAvoidingView pads the
 * screen by the keyboard's height (edge-to-edge Android never resizes the window), and the
 * body scrolls when a short phone cannot fit it — a drag there puts the keyboard away.
 */
export function AuthStep({
  kicker,
  headline,
  line,
  step,
  steps,
  onBack,
  center = false,
  children,
  footer,
}: {
  kicker: string;
  headline: string;
  line?: string;
  /** 1-based. The counter and dots show only when there is more than one step. */
  step: number;
  steps: number;
  /** Shows the back arrow. */
  onBack?: () => void;
  /** Centres the copy and the body (the photo step). */
  center?: boolean;
  children?: React.ReactNode;
  /** The button and any links under it. */
  footer: React.ReactNode;
}) {
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
      <ScreenBackdrop />
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.top}>
            {onBack ? (
              <Pressable
                onPress={onBack}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Back"
                style={({ pressed }) => [styles.back, pressed && styles.pressed]}
              >
                <Icon name="back" size={22} color={COLORS.white} />
              </Pressable>
            ) : <View />}
            {steps > 1 ? <Text style={styles.counter}>{step} / {steps}</Text> : null}
          </View>

          <View style={[styles.copy, center && styles.copyCenter]}>
            <Text style={styles.kicker}>{kicker}</Text>
            <Text style={[styles.headline, center && styles.textCenter]}>{headline}</Text>
            {line ? <Text style={[styles.line, center && styles.textCenter]}>{line}</Text> : null}
          </View>

          <View style={[styles.body, center && styles.bodyCenter]}>{children}</View>

          <View style={styles.footer}>
            {footer}
            {steps > 1 ? (
              <View style={styles.dots} pointerEvents="none">
                {Array.from({ length: steps }, (_, i) => (
                  <View key={i} style={[styles.dot, i === step - 1 ? styles.dotOn : styles.dotOff]} />
                ))}
              </View>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** A field with the step's mono label above it and an optional line under it. */
export function StepField({ label, below, children }: { label: string; below?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {below}
    </View>
  );
}

/** The step's main button: the app's primary Button in the onboarding's mono capitals. */
export function StepButton({ label, onPress, disabled, busy }: {
  label: string; onPress: () => void; disabled?: boolean; busy?: boolean;
}) {
  return (
    <Button
      label={label}
      onPress={onPress}
      disabled={disabled}
      busy={busy}
      variant="primary"
      size="lg"
      fullWidth
      labelStyle={styles.buttonLabel}
    />
  );
}

/** A quiet text link under the button (Sign in, Skip for now, Change photo). */
export function StepLink({ label, onPress, muted = false }: { label: string; onPress: () => void; muted?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
    >
      <Text style={[styles.linkText, muted && styles.linkMuted]}>{label}</Text>
    </Pressable>
  );
}

/** An error or notice, placed at the top of the body so the keyboard never covers it. */
export function StepError({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <View style={styles.error} accessibilityLiveRegion="polite">
      <Text style={styles.errorText}>{message}</Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  fill: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 28, paddingBottom: 20 },
  pressed: { opacity: 0.6 },
  top: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { width: 44, height: 44, marginLeft: -12, alignItems: 'center', justifyContent: 'center' },
  counter: { fontFamily: FONTS.mono, fontSize: 12, letterSpacing: 3, color: COLORS.purpleNeon },
  copy: { marginTop: 28, gap: 10 },
  copyCenter: { alignItems: 'center', marginTop: 56 },
  kicker: { fontFamily: FONTS.mono, fontSize: 11, letterSpacing: 3, color: COLORS.purpleNeon },
  headline: {
    fontFamily: FONTS.display,
    fontSize: 36,
    lineHeight: 46,
    paddingTop: 2,
    letterSpacing: 1,
    color: COLORS.white,
    textTransform: 'uppercase',
  },
  line: { fontFamily: FONTS.mono, fontSize: 14, lineHeight: 21, color: COLORS.purpleLight },
  textCenter: { textAlign: 'center' },
  body: { marginTop: 28, gap: 18 },
  bodyCenter: { alignItems: 'center', marginTop: 40 },
  field: { gap: 8 },
  label: { fontFamily: FONTS.mono, fontSize: 11, letterSpacing: 2, color: COLORS.textSecondary },
  footer: { marginTop: 'auto', paddingTop: 28, alignItems: 'stretch', gap: 12 },
  buttonLabel: { fontFamily: FONTS.monoBold, letterSpacing: 2 },
  link: { minHeight: 44, alignSelf: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  linkText: { fontFamily: FONTS.mono, fontSize: 13, color: COLORS.purpleLight, textAlign: 'center' },
  linkMuted: { color: COLORS.textSecondary },
  dots: { flexDirection: 'row', gap: 6, alignSelf: 'center', marginTop: 4 },
  dot: { height: 6, borderRadius: 3 },
  dotOn: { width: 18, backgroundColor: COLORS.purpleNeon },
  dotOff: { width: 6, backgroundColor: COLORS.border },
  error: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.errorBorder,
    backgroundColor: COLORS.errorBg,
    gap: 6,
  },
  errorText: { fontFamily: FONTS.mono, fontSize: 13, lineHeight: 19, color: COLORS.white },
});
