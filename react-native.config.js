/**
 * Asset linking for the bundled onboarding fonts.
 *
 * Anton (display) and Courier Prime (body/mono) are used by the "Backstage Pass"
 * pre-auth onboarding. They are the app's ONLY custom fonts — everything else is
 * system sans.
 *
 * After adding or changing a file in assets/fonts, re-run:
 *
 *   npx react-native-asset
 *
 * That copies the TTFs into android/app/src/main/assets/fonts/, which is a native
 * asset change — a Metro reload will NOT pick it up. Rebuild with ./gradlew.
 *
 * On Android the fontFamily string is the FILENAME without extension
 * (e.g. 'CourierPrime-Bold'), not the family name. See src/theme/fonts.ts.
 */
module.exports = {
  assets: ['./assets/fonts'],
};
