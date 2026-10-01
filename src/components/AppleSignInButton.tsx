/**
 * "Continue with Apple" — the App Store's price of admission.
 *
 * Guideline 4.8 requires an Apple login wherever a third-party login is offered,
 * and we offer Google. Rendered on iOS only; returns null everywhere else, so
 * both auth screens can drop it in unconditionally.
 *
 * ── THIS IS A CUSTOM BUTTON, AND APP REVIEW EVALUATES EVERY ONE OF THOSE ────
 * App Review rejected 2.1.1 (75) under guideline 4: "Sign in with Apple button
 * includes logo artwork that is not downloaded from Apple Design Resources."
 * The mark had been Phosphor's `AppleLogo` icon — a third-party redraw with
 * slightly different curves. It looked right and was not.
 *
 * Everything below follows the Human Interface Guidelines section "Creating a
 * custom Sign in with Apple button". The rules that are easy to break:
 *
 *   * ARTWORK. Only Apple's logo file, never an icon-library Apple logo and never
 *     a redraw. `APPLE_LOGO_PATH` is the path from "Logo - SIWA - Left-aligned -
 *     Black - Medium.svg" (Apple Design Resources), byte for byte. Do not
 *     "optimise", round or re-export it.
 *   * THE LOGO FILE IS THE FULL BUTTON HEIGHT. The file is a 31x44 canvas whose
 *     built-in padding sets the logo's proportion to the button and its distance
 *     from the title. So: scale the whole canvas to the button's height, do not
 *     crop it (keep the viewBox), add no vertical padding, and put no gap
 *     between it and the title.
 *   * TITLE = 43% OF BUTTON HEIGHT, system font, vertically centred. Apple's
 *     words: the title and button height "need to use the same proportions that
 *     the system uses". That is why the size is computed, not styled, and why a
 *     call site cannot override it.
 *   * COLOURS. Logo and title both pure black on a pure white fill (the WHITE
 *     style, which Apple specifies for dark backgrounds — ours is #0A0A0F).
 *   * At least 8% of the button's width must stay clear between the title and
 *     the trailing edge; minimum size 140x30pt.
 *   * Title text is one of Apple's three; we use "Continue with Apple".
 *
 * Corner radius and outer margins ARE ours to choose, so `style` stays open for
 * those. Height is a prop rather than padding because the logo file has to be
 * drawn at exactly that height.
 *
 * Why not the library's `AppleButton` (the system-drawn button): it is a legacy
 * native view (`requireNativeComponent`) and this app runs the New Architecture,
 * where such views reach the screen only through the Fabric interop layer. If a
 * future review disputes this custom button anyway, that is the fallback — it
 * is "guaranteed to use an Apple-approved appearance" — after a device check.
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
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import {
  isAppleSignInAvailable,
  signInWithApple,
  isAppleSignInCancellation,
} from '../services/appleAuth';

/** Canvas of Apple's "Left-aligned - Medium" logo file, in its own units. */
export const APPLE_LOGO_CANVAS = { width: 31, height: 44 } as const;

/**
 * The Apple logo, from Apple Design Resources ("Logo - SIWA - Left-aligned -
 * Black - Medium.svg"). Verbatim. The file's white <rect> is a preview backdrop
 * the size of the canvas and is not drawn: the button's own fill is that white.
 */
export const APPLE_LOGO_PATH =
  'M15.7099491,14.8846154 C16.5675461,14.8846154 17.642562,14.3048315 18.28274,13.5317864 C18.8625238,12.8312142 19.2852829,11.852829 19.2852829,10.8744437 C19.2852829,10.7415766 19.2732041,10.6087095 19.2490464,10.5 C18.2948188,10.5362365 17.1473299,11.140178 16.4588366,11.9494596 C15.9152893,12.56548 15.4200572,13.5317864 15.4200572,14.5222505 C15.4200572,14.6671964 15.4442149,14.8121424 15.4562937,14.8604577 C15.5166879,14.8725366 15.6133185,14.8846154 15.7099491,14.8846154 Z M12.6902416,29.5 C13.8618881,29.5 14.3812778,28.714876 15.8428163,28.714876 C17.3285124,28.714876 17.6546408,29.4758423 18.9591545,29.4758423 C20.2395105,29.4758423 21.0971074,28.292117 21.9063891,27.1325493 C22.8123013,25.8038779 23.1867451,24.4993643 23.2109027,24.4389701 C23.1263509,24.4148125 20.6743484,23.4122695 20.6743484,20.5979021 C20.6743484,18.1579784 22.6069612,17.0588048 22.7156707,16.974253 C21.4353147,15.1382708 19.490623,15.0899555 18.9591545,15.0899555 C17.5217737,15.0899555 16.3501271,15.9596313 15.6133185,15.9596313 C14.8161157,15.9596313 13.7652575,15.1382708 12.521138,15.1382708 C10.1536872,15.1382708 7.75,17.0950413 7.75,20.7911634 C7.75,23.0861411 8.64383344,25.513986 9.74300699,27.0842339 C10.6851558,28.4129053 11.5065162,29.5 12.6902416,29.5 Z';

/** Apple: the title's font size is 43% of the button's height. */
export const APPLE_TITLE_RATIO = 0.43;
/** Apple: keep at least 8% of the button's width clear beside the title. */
export const APPLE_MIN_SIDE_MARGIN_RATIO = 0.08;
/** No smaller than the Google button beside it (Button size="lg" is ~51pt). */
export const APPLE_BUTTON_DEFAULT_HEIGHT = 52;

const APPLE_BLACK = '#000000';
const APPLE_WHITE = '#FFFFFF';

type Props = {
  /** Shown to the user when sign-in fails. A cancellation never calls this. */
  onError: (message: string) => void;
  /** True while a sibling auth action is running, so the row disables together. */
  disabled?: boolean;
  /**
   * Button height in points. The logo file is drawn at exactly this height and
   * the title at 43% of it, so this is the one knob that sizes the control.
   * Must not be smaller than the other sign-in buttons on the screen.
   */
  height?: number;
  /**
   * Corner radius and outer spacing only. Colours, padding and the title are
   * deliberately NOT overridable: Apple specifies them, so a call site must not
   * be able to restyle the button out of compliance.
   */
  style?: StyleProp<ViewStyle>;
};

export default function AppleSignInButton({
  onError,
  disabled,
  height = APPLE_BUTTON_DEFAULT_HEIGHT,
  style,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [width, setWidth] = useState(0);

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

  const onLayout = (e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.width;
    if (next !== width) { setWidth(next); }
  };

  const isDisabled = busy || !!disabled;
  const logoWidth = (height * APPLE_LOGO_CANVAS.width) / APPLE_LOGO_CANVAS.height;
  const titleSize = Math.round(height * APPLE_TITLE_RATIO);
  const sideMargin = Math.ceil(width * APPLE_MIN_SIDE_MARGIN_RATIO);

  return (
    <Pressable
      // No `android_ripple`: it paints a rectangle that ignores borderRadius.
      // Irrelevant on iOS-only today, but the rule holds if this ever renders
      // elsewhere.
      style={({ pressed }) => [
        styles.button,
        style,
        // After `style`, so a call site's padding or colours cannot win.
        styles.locked,
        { height, paddingHorizontal: sideMargin },
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
      ]}
      onLayout={onLayout}
      onPress={handlePress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel="Continue with Apple"
    >
      {busy ? (
        <ActivityIndicator color={APPLE_BLACK} />
      ) : (
        <>
          {/* Apple's logo file, whole canvas, at the button's full height. An
              SVG, so it is a sibling of the title rather than nested in <Text>. */}
          <Svg
            width={logoWidth}
            height={height}
            viewBox={`0 0 ${APPLE_LOGO_CANVAS.width} ${APPLE_LOGO_CANVAS.height}`}
            accessible={false}
          >
            <Path d={APPLE_LOGO_PATH} fill={APPLE_BLACK} fillRule="nonzero" />
          </Svg>
          <Text
            style={[styles.title, { fontSize: titleSize }]}
            numberOfLines={1}
            // Safety valve for very narrow phones only: shrink a little rather
            // than truncate "Continue with Apple" into the 8% margin.
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            allowFontScaling={false}
          >
            Continue with Apple
          </Text>
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
    minWidth: 140,
  },
  locked: {
    backgroundColor: APPLE_WHITE,
    paddingVertical: 0,
    minHeight: 30,
  },
  // System font (no fontFamily), as Apple prefers. No gap before it: the logo
  // file's own trailing padding is the spacing.
  title: {
    flexShrink: 1,
    fontWeight: '600',
    color: APPLE_BLACK,
  },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.85 },
});
