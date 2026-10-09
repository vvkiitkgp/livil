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

export const TERMS_URL = 'https://livil-music.com/terms.html';
export const PRIVACY_POLICY_URL = 'https://livil-music.com/privacy-policy.html';
export const SUPPORT_URL = 'https://livil-music.com/support.html';
export const CHILD_SAFETY_URL = 'https://livil-music.com/child-safety.html';
export const DELETE_ACCOUNT_INFO_URL = 'https://livil-music.com/delete-account.html';

export const SUPPORT_EMAIL = 'support@livil-music.com';

/** Confirmed by Vamsi, 2026-08-03. Underscore, not a dot — `livil.music` is a 404. */
export const INSTAGRAM_URL = 'https://instagram.com/livil_music';

/**
 * `market://` opens the Play Store app directly; the https form is the
 * fallback for devices without it (and for iOS later).
 */
export const PLAY_STORE_APP_URL = `market://details?id=${ANDROID_PACKAGE}`;
export const PLAY_STORE_WEB_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

/** App Store Connect id for Livil Music. */
export const APP_STORE_ID = '6809119164';
export const APP_STORE_URL = `https://apps.apple.com/app/id${APP_STORE_ID}`;
/** Opens Livil's page in the App Store app itself (the update prompt); APP_STORE_URL is the fallback. */
export const APP_STORE_APP_URL = `itms-apps://apps.apple.com/app/id${APP_STORE_ID}`;
/** Opens the App Store's review sheet directly (Rate row on iOS). */
export const APP_STORE_REVIEW_URL = `itms-apps://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`;

/**
 * The invite link: ONE URL for both stores. docs/get.html sends a phone straight to its
 * own store and shows both badges to anyone else, and carries the og:* tags that give
 * WhatsApp / iMessage a real preview card. Never share a bare store URL from the app
 * again — it is the wrong store for half the recipients, and store pages have no card.
 * Routed by the `/get` rewrite in web/vercel.json.
 */
export const INVITE_URL = 'https://livil-music.com/get';

/**
 * Body of the "Invite friends" share sheet. The URL goes last and on its own line so
 * chat apps unfurl it into the card rather than burying it mid-sentence.
 *
 * NAMES NO PLATFORM, on purpose. This text is composed inside the iOS app, and App Review
 * guideline 2.3.10 forbids naming another mobile platform in the app — "Free on iPhone and
 * Android" was in 2.1.0–2.1.2 and is the same rule that rejected 2.1.2's What's New. The
 * link itself already sends each phone to its own store, so the words add nothing.
 */
export const INVITE_SHARE_MESSAGE =
  `Come listen with me on Livil — jam in real time, share the moment of a song, and see what your friends are playing. It's free.\n\n${INVITE_URL}`;

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

// ── Profile links ───────────────────────────────────────────────────────────
// See kb/architecture/post-sharing.md §10 for the design these encode.

/**
 * A person's public link: `https://livil-music.com/@{username}` — the one people put in
 * an Instagram bio.
 *
 * Keyed by the HANDLE, not the user id, because that is what makes it a link worth
 * printing: readable, typeable, and the thing a search engine ranks for. That is only
 * safe because a chosen username is permanent (20260628000000 blocks any change), so a
 * link in a bio never starts pointing at someone else or at nothing.
 *
 * The web page behind it is a SIGNPOST — name, handle, photo, and "Follow on Livil".
 * The profile itself is only ever shown in the app.
 *
 * Like the post link, THIS PATH IS A THREE-WAY CONTRACT: here, the `/@:username`
 * rewrite in `web/vercel.json`, and the `/@` App Link / Universal Link paths
 * (AndroidManifest.xml, docs/.well-known/apple-app-site-association).
 */
export function profileShareUrl(username: string): string {
  return `${SHARE_LINK_ORIGIN}/@${encodeURIComponent(username)}`;
}

/** Direct route into the app for a profile — the web page's "Follow on Livil" button. */
export function profileDeepLink(username: string): string {
  return `livil://profile/${encodeURIComponent(username)}`;
}

/**
 * Body of the share-sheet message for a profile. URL last, on its own line, for the same
 * unfurling reason as `buildPostShareMessage`.
 *
 * First person only when it IS your own profile — the preview card that unfurls says
 * "Follow me on Livil", which is right in your bio and wrong in your words about a friend.
 */
export function buildProfileShareMessage(
  username: string,
  opts: { isOwn: boolean; name?: string | null },
): string {
  const lead = opts.isOwn
    ? 'Follow me on Livil 🎵'
    : `Check out ${opts.name?.trim() || `@${username}`} on Livil 🎵`;
  return `${lead}\n\n${profileShareUrl(username)}`;
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
