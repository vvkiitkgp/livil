/**
 * The app's only custom fonts, bundled for the "Backstage Pass" pre-auth
 * onboarding. Everywhere else still uses system sans — do not spread these
 * across the app without a design decision.
 *
 * Android resolves `fontFamily` by FILENAME (minus extension), not by the
 * family name inside the TTF. iOS resolves by PostScript name, which for these
 * three happens to match. Keep the filenames in assets/fonts/ in sync with the
 * values below, and re-run `npx react-native-asset` after any change.
 *
 * Both families are SIL Open Font License 1.1 (Google Fonts).
 */
export const FONTS = {
  /** Anton — display headlines only, 34–42px, uppercase. */
  display: 'Anton-Regular',
  /** Courier Prime — body copy, spec rows, kickers. */
  mono: 'CourierPrime-Regular',
  /** Courier Prime Bold — CTA labels, row titles. */
  monoBold: 'CourierPrime-Bold',
} as const;
