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

// ── Post sharing ────────────────────────────────────────────────────────────
// See kb/architecture/post-sharing.md for the design these three constants encode.

/**
 * Where a shared post is readable on the web.
 *
 * The path is `/p/{postId}` — the raw post uuid, with no short code and no lookup
 * table. A uuid v4 is 122 bits, so the id IS the capability: there is no listing
 * endpoint and the space cannot be walked. The link is uglier than `livil.to/aB3xY9z`
 * and that is the whole cost; the pretty version needs a table, an insert path and
 * collision handling to improve a string that WhatsApp renders as a card anyway.
 *
 * THIS PATH IS A THREE-WAY CONTRACT and all three have to move together:
 *   1. here (what the app puts in people's messages, permanently),
 *   2. `web/vercel.json`, which routes /p/:id to the share function,
 *   3. the App Links intent-filter in AndroidManifest.xml, whose `pathPrefix` is /p/.
 * Change one alone and links either 404 or stop opening the app, and the broken ones
 * are already in somebody's chat history where they cannot be fixed.
 */
export const SHARE_LINK_ORIGIN = 'https://livil-music.com';

/** Public web page for a post: `https://livil-music.com/p/{postId}`. */
export function postShareUrl(postId: string): string {
  return `${SHARE_LINK_ORIGIN}/p/${postId}`;
}

/**
 * Direct route into the app for a post.
 *
 * Deliberately kept alongside the https link rather than replaced by it. Android App
 * Links (the https form opening the app directly) only work once
 * `/.well-known/assetlinks.json` carries the Play App Signing fingerprint — a file only
 * the maintainer can produce. Until then the https link opens the browser, and the web
 * page's "Open in app" button falls back to THIS, which needs no verification and has
 * worked since the `livil` scheme was registered.
 */
export function postDeepLink(postId: string): string {
  return `livil://post/${postId}`;
}

/**
 * Body of the share-sheet message. The URL goes last and on its own line because chat
 * apps unfurl a preview from the trailing URL and several of them stop looking if text
 * follows it.
 */
export function buildPostShareMessage(
  trackTitle: string,
  artistName: string,
  postId: string,
): string {
  return `🎵 ${trackTitle} — ${artistName}\n\n${postShareUrl(postId)}`;
}

/**
 * Facebook App ID, required by Instagram for the ADD_TO_STORY intent.
 *
 * EMPTY UNTIL THE MAINTAINER REGISTERS ONE at developers.facebook.com. Instagram will
 * not accept a Story share without it, so `shareStoryCard` treats an empty value as
 * "Instagram unavailable" and falls back to the normal share sheet rather than firing
 * an intent that is going to be rejected. Nothing else in the app reads this, and no
 * secret is involved — a Facebook App ID is public by design and ships in client apps.
 */
export const FACEBOOK_APP_ID = '';
