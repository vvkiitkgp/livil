/**
 * "Continue with Apple" — the App Store's price of admission.
 *
 * Guideline 4.8 requires an Apple login wherever a third-party login is offered,
 * and we offer Google. Rendered on iOS only; returns null everywhere else, so
 * both auth screens can drop it in unconditionally.
 *
 * Why this is hand-built rather than the library's `AppleButton`:
 *   * `AppleButton` is a legacy native view (`requireNativeComponent`). This app
 *     runs the New Architecture, where legacy view managers only reach the screen
 *     through the Fabric interop layer — an avoidable risk for a control that
 *     literally gates shipping.
 *   * The project rule is that every button is built from our own components.
 * Apple allows a custom button provided it uses one of their specified
 * appearances. This is the WHITE variant — solid white, pure-black mark and
 * label — chosen because the app's background is #0A0A0F, against which Apple's
 * black variant would be very nearly invisible. It is therefore also at least as
 * prominent as the Google button, which the same guideline asks for.
 *
 * The solid fill is a deliberate exception to the app's no-filled-buttons rule,
 * on the same footing as `destructive`: Apple specifies the appearance, so the
 * design system does not get a vote.
 */
import React, { useState } from 'react';
import {
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  View,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';
import {
  isAppleSignInAvailable,
  signInWithApple,
  isAppleSignInCancellation,
} from '../services/appleAuth';

type Props = {
  /** Shown to the user when sign-in fails. A cancellation never calls this. */
  onError: (message: string) => void;
  /** True while a sibling auth action is running, so the row disables together. */
  disabled?: boolean;
  /**
   * Shape overrides so the button can sit in a screen with its own button
   * metrics (the onboarding flow uses taller buttons and a mono label). Colour
   * is deliberately NOT overridable: Apple specifies white-with-black for this
   * variant, so a call-site must not be able to restyle it out of compliance.
   */
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
};

export default function AppleSignInButton({ onError, disabled, style, labelStyle }: Props) {
  const [busy, setBusy] = useState(false);

  if (!isAppleSignInAvailable()) { return null; }

  const handlePress = async () => {
    setBusy(true);
    try {
      await signInWithApple();
      // On success RootNavigator's session listener swaps the navigator out from
      // under us, so there is nothing to navigate to here.
    } catch (e) {
      // Dismissing Apple's sheet throws like a failure does. Saying "sign-in
      // failed" for something the user chose to do is just noise.
      if (!isAppleSignInCancellation(e)) {
        onError((e as Error)?.message || 'Apple sign-in failed. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const isDisabled = busy || !!disabled;

  return (
    <Pressable
      // No `android_ripple`: it paints a rectangle that ignores borderRadius.
      // Irrelevant on iOS-only today, but the rule holds if this ever renders
      // elsewhere.
      style={({ pressed }) => [
        styles.button,
        style,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
      ]}
      onPress={handlePress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel="Continue with Apple"
    >
      {busy ? (
        <ActivityIndicator color={COLORS.black} />
      ) : (
        <>
          {/* Icon is an SVG, so it is wrapped in a View rather than nested in
              <Text> — nesting one inside Text is not allowed here. */}
          <View style={styles.mark}>
            <Icon name="apple" size={19} color={COLORS.black} />
          </View>
          <Text style={[styles.label, labelStyle]}>Continue with Apple</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingVertical: 15,
    backgroundColor: COLORS.white,
    gap: 8,
  },
  // Optical centring: the Apple mark's visual mass sits low, so it needs lifting
  // a hair to look level with the cap height of the label beside it.
  mark: { marginTop: -2 },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.black,
  },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.85 },
});
