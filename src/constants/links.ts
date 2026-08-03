/**
 * Outbound URLs used by Settings. Centralized so the marketing site, the store
 * listing and the app never drift apart.
 *
 * The policy pages are the ones already served from `docs/` on the
 * livil-music.com GitHub Pages site — the same URLs the Play Store listing
 * points at, which is why they must not be changed casually.
 */

/** Play Store package id. Must match `applicationId` in android/app/build.gradle. */
export const ANDROID_PACKAGE = 'com.livil';

export const PRIVACY_POLICY_URL = 'https://livil-music.com/privacy-policy.html';
export const CHILD_SAFETY_URL = 'https://livil-music.com/child-safety.html';
export const DELETE_ACCOUNT_INFO_URL = 'https://livil-music.com/delete-account.html';

export const SUPPORT_EMAIL = 'vvk.iitkgp@gmail.com';

/** Confirmed by Vamsi, 2026-08-03. Underscore, not a dot — `livil.music` is a 404. */
export const INSTAGRAM_URL = 'https://instagram.com/livil_music';

/**
 * `market://` opens the Play Store app directly; the https form is the
 * fallback for devices without it (and for iOS later).
 */
export const PLAY_STORE_APP_URL = `market://details?id=${ANDROID_PACKAGE}`;
export const PLAY_STORE_WEB_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

/** Body of the "Invite friends" share sheet. */
export const INVITE_SHARE_MESSAGE =
  `Come listen with me on Livil — upload your music, jam in real time, and see what your friends are playing.\n\n${PLAY_STORE_WEB_URL}`;
