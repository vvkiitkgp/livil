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
 *     Black - Small.svg" (Apple Design Resources), byte for byte. Do not
 *     "optimise", round or re-export it. Small, because Apple ships three sizes
 *     "so you can match logo sizes in all the sign-up buttons you display", and
 *     Small is the one that sits level with the 18pt Google "G" beside it.
 *   * THE LOGO FILE IS THE FULL BUTTON HEIGHT. The file is a 24x44 canvas whose
 *     built-in padding sets the logo's proportion to the button and its distance
 *     from the title. So: scale the whole canvas to the button's height, do not
 *     crop it (keep the viewBox), add no vertical padding, and put no gap
 *     between it and the title.
 *   * TITLE FONT IS OURS; ITS COLOUR IS NOT. The HIG lets a custom button change
 *     the "title font ... weight and size" to coordinate with the app, so the
 *     title matches the sign-in buttons beside it (`labelStyle`). The same page
 *     also says the title should keep the system's proportion, 43% of button
 *     height (22pt here). We tried that: it towers over its neighbours. The
 *     review that rejected us cited the artwork only, so we take the explicit
 *     allowance. If a review ever cites title size, `labelStyle={{ fontSize:
 *     Math.round(height * 0.43) }}` is the literal reading.
 *   * COLOURS. Logo and title both pure black on a pure white fill (the WHITE
 *     style, which Apple specifies for dark backgrounds — ours is #0A0A0F).
 *   * At least 8% of the button's width must stay clear between the title and
 *     the trailing edge; minimum size 140x30pt.
 *   * Title text is one of Apple's three; we use "Continue with Apple".
 *
 * Corner radius and outer margins ARE ours to choose, so `style` stays open for
 * those, and `labelStyle` for the title's font. Height is a prop rather than
 * padding because the logo file has to be drawn at exactly that height.
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
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import {
  isAppleSignInAvailable,
  signInWithApple,
  isAppleSignInCancellation,
} from '../services/appleAuth';

/** Canvas of Apple's "Left-aligned - Small" logo file, in its own units. */
export const APPLE_LOGO_CANVAS = { width: 24, height: 44 } as const;

/**
 * The Apple logo, from Apple Design Resources ("Logo - SIWA - Left-aligned -
 * Black - Small.svg"). Verbatim. The file's white <rect> is a preview backdrop
 * the size of the canvas and is not drawn: the button's own fill is that white.
 */
export const APPLE_LOGO_PATH =
  'M12.2337427,16.9879688 C12.8896607,16.9879688 13.7118677,16.5445313 14.2014966,15.9532812 C14.6449341,15.4174609 14.968274,14.6691602 14.968274,13.9208594 C14.968274,13.8192383 14.9590357,13.7176172 14.9405591,13.6344727 C14.2107349,13.6621875 13.3330982,14.1241016 12.8065162,14.7430664 C12.3907935,15.2142188 12.012024,15.9532812 12.012024,16.7108203 C12.012024,16.8216797 12.0305005,16.9325391 12.0397388,16.9694922 C12.0859302,16.9787305 12.1598365,16.9879688 12.2337427,16.9879688 Z M9.92417241,28.1662891 C10.8202857,28.1662891 11.2175318,27.5658008 12.3353638,27.5658008 C13.4716724,27.5658008 13.721106,28.1478125 14.7188404,28.1478125 C15.6980982,28.1478125 16.3540162,27.2424609 16.972981,26.3555859 C17.6658521,25.339375 17.9522388,24.3416406 17.9707154,24.2954492 C17.9060474,24.2769727 16.0306763,23.5101953 16.0306763,21.3576758 C16.0306763,19.491543 17.5088013,18.6508594 17.5919459,18.5861914 C16.612688,17.1819727 15.1253248,17.1450195 14.7188404,17.1450195 C13.6194849,17.1450195 12.7233716,17.8101758 12.1598365,17.8101758 C11.5501099,17.8101758 10.7463794,17.1819727 9.79483648,17.1819727 C7.98413335,17.1819727 6.14571538,18.6785742 6.14571538,21.5054883 C6.14571538,23.2607617 6.8293482,25.1176563 7.67003179,26.3186328 C8.39061773,27.3348438 9.01882085,28.1662891 9.92417241,28.1662891 Z';

/** Default title size: the same as the `lg` Button (Google) it sits beside. */
export const APPLE_TITLE_DEFAULT_SIZE = 16;
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
   * Button height in points. The logo file is drawn at exactly this height.
   * Must not be smaller than the other sign-in buttons on the screen.
   */
  height?: number;
  /**
   * Corner radius and outer spacing only. Colours and padding are deliberately
   * NOT overridable: Apple specifies them, so a call site must not be able to
   * restyle the button out of compliance.
   */
  style?: StyleProp<ViewStyle>;
  /**
   * Title font only (family, size, weight, letter spacing), so the title can
   * match the other sign-in buttons on the screen. Its colour is locked.
   */
  labelStyle?: StyleProp<TextStyle>;
};

export default function AppleSignInButton({
  onError,
  disabled,
  height = APPLE_BUTTON_DEFAULT_HEIGHT,
  style,
  labelStyle,
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
            // `titleLocked` last: a call site chooses the font, never the colour.
            style={[styles.title, labelStyle, styles.titleLocked]}
            numberOfLines={1}
            // Safety valve for very narrow phones only: shrink a little rather
            // than truncate "Continue with Apple" into the 8% margin.
            adjustsFontSizeToFit
            minimumFontScale={0.8}
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
  // System font unless the call site matches its own buttons. No gap before it:
  // the logo file's own trailing padding is the spacing.
  title: {
    fontSize: APPLE_TITLE_DEFAULT_SIZE,
    fontWeight: '600',
  },
  titleLocked: {
    flexShrink: 1,
    color: APPLE_BLACK,
  },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.85 },
});
