/**
 * Sign in with Apple JS — the browser half of Apple sign-in, kept free of the Supabase
 * client and of `import.meta` so every rule in it can be pinned by a plain Jest test.
 *
 * WHY APPLE'S JS POPUP AND NOT SUPABASE'S OAUTH REDIRECT. `signInWithOAuth({ provider:
 * 'apple' })` would mirror Google exactly, but Apple's redirect flow authenticates the
 * server with a client secret: a JWT signed by a `.p8` key that Apple caps at six months.
 * Forgetting to rotate it takes web Apple sign-in down with no warning. The JS popup returns
 * a signed identity token in the page instead, which `signInWithIdToken` verifies against
 * Apple's public keys — the same path the iPhone app uses (`src/services/appleAuth.ts`), with
 * no secret to configure or rotate. It is also the only web flow in which Apple hands over
 * the person's name (Supabase's OAuth flow never sees it).
 *
 * THE COST: Apple only accepts a registered https return URL, so this cannot run against a
 * localhost dev server, and it loads Apple's script into the page (see `loadAppleId`).
 *
 * WHY THE IPHONE ACCOUNT IS THE SAME ACCOUNT. Apple's `sub` claim — the user id Supabase keys
 * an Apple identity on — is scoped to the developer team, not to the app. The web's Services
 * ID (`com.livil.web`) is grouped under the iOS App ID (`com.livil`), so the same Apple ID
 * yields the same `sub`, and therefore the same `auth.users` row, the same profile and the
 * same "Hide My Email" relay address. Supabase accepts the web token only because
 * `com.livil.web` is listed beside `com.livil` in the Apple provider's Client IDs.
 */

/**
 * The Services ID registered in the Apple Developer portal for livil-music.com. Public by
 * design — it is sent to Apple in the clear on every sign-in — so it is a constant, not an
 * environment variable. Must also be in Supabase → Auth → Providers → Apple → Client IDs.
 */
export const APPLE_WEB_CLIENT_ID = 'com.livil.web';

/** Apple's hosted script. Versioned by Apple under `/1/`; there is no npm package. */
export const APPLE_JS_URL =
  'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

/** `name email`: the email is what Supabase keys the account on; the name seeds the profile. */
export const APPLE_SCOPE = 'name email';

// ── Apple's JS surface (no published types) ──────────────────────────────────────────────

export type AppleIdConfig = {
  clientId: string;
  scope: string;
  redirectURI: string;
  state: string;
  nonce: string;
  usePopup: true;
};

/** Present only on the FIRST authorization of this Apple ID for Livil, on any device. */
export type AppleIdUser = {
  email?: string;
  name?: { firstName?: string; middleName?: string; lastName?: string };
};

export type AppleIdResponse = {
  authorization: { id_token: string; code?: string; state?: string };
  user?: AppleIdUser;
};

export type AppleIdApi = {
  auth: {
    init(config: AppleIdConfig): void;
    signIn(): Promise<AppleIdResponse>;
  };
};

declare global {
  interface Window {
    AppleID?: AppleIdApi;
  }
}

// ── The nonce ────────────────────────────────────────────────────────────────────────────

export type AppleNonce = {
  /** Goes to Supabase, which hashes it and compares the result with the token's claim. */
  raw: string;
  /** Goes to Apple, which copies it verbatim into the identity token's `nonce` claim. */
  hashed: string;
};

function hex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A fresh single-use nonce pair.
 *
 * Apple gets the SHA-256 and Supabase gets the raw value — never the same string to both.
 * GoTrue hashes what it is given before comparing it with the token's `nonce` claim, which is
 * exactly the native rule in `src/services/appleAuth.ts` (there the Apple library does the
 * hashing). Passing the raw value to Apple, as Supabase's own web example does, makes the
 * token's claim the raw value and the comparison fail with "Nonces mismatch".
 */
export async function makeNonce(cryptoApi: Crypto = globalThis.crypto): Promise<AppleNonce> {
  const raw = hex(cryptoApi.getRandomValues(new Uint8Array(32)));
  const hashed = hex(await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(raw)));
  return { raw, hashed };
}

/** CSRF state for the popup round trip; checked against what Apple echoes back. */
export function makeState(cryptoApi: Crypto = globalThis.crypto): string {
  return hex(cryptoApi.getRandomValues(new Uint8Array(16)));
}

// ── Errors ───────────────────────────────────────────────────────────────────────────────

export type AppleErrorKind = 'cancelled' | 'popup-blocked' | 'other';

/**
 * Apple's popup rejects with a plain `{ error: string }`, not an Error. Closing the window
 * or pressing Cancel is something the person chose, so it must not be reported as a failure.
 */
export function appleErrorKind(e: unknown): AppleErrorKind {
  const code = (e as { error?: unknown } | null)?.error;
  if (code === 'popup_closed_by_user' || code === 'user_cancelled_authorize') return 'cancelled';
  if (code === 'popup_blocked_by_browser') return 'popup-blocked';
  return 'other';
}

// ── Names ────────────────────────────────────────────────────────────────────────────────

/** "Riya Sharma" from Apple's one-time `user` block, or null when it was not shared. */
export function appleFullName(user: AppleIdUser | undefined): string | null {
  const name = user?.name;
  if (!name) return null;
  const full = [name.firstName, name.middleName, name.lastName]
    .map(part => part?.trim())
    .filter(Boolean)
    .join(' ');
  return full || null;
}

/**
 * Display name to claim with when an Apple account leaves the name field blank.
 *
 * Mirrors `appleDisplayName` in the app's `ChooseUsernameScreen`. `undefined` keeps what the
 * profile holds (`claim_username` coalesces a missing name to the current one), which is
 * right when sign-in seeded the name Apple shared. Without that seed the profile holds
 * `handle_new_user`'s email-prefix fallback — for "Hide My Email" a relay id like
 * `8kd93jf0q1` — and the chosen username is a far better name than that.
 */
export function appleClaimDisplayName(
  current: string | null | undefined,
  email: string | null | undefined,
  username: string,
): string | undefined {
  const name = current?.trim() ?? '';
  const emailPrefix = email?.split('@')[0] ?? '';
  return !name || name === emailPrefix ? username : undefined;
}

// ── Loading Apple's script ───────────────────────────────────────────────────────────────

let loading: Promise<AppleIdApi> | null = null;
let appleSignInInFlight = false;

/** Set by `signInWithApple` for the span between Apple's answer and the name being saved. */
export function setAppleSignInInFlight(active: boolean): void {
  appleSignInInFlight = active;
}

/**
 * Whether a sign-in on this page must reload it to get rid of Apple's script.
 *
 * True once the script has been requested, for every kind of sign-in (password, another
 * tab) — except during an Apple sign-in itself, whose `SIGNED_IN` arrives before the
 * one-time name is saved; that flow reloads on its own afterwards.
 */
export function mustDropAppleScript(): boolean {
  return (loading !== null || window.AppleID !== undefined) && !appleSignInInFlight;
}

/**
 * Load Apple's script once, on the signed-out screen only.
 *
 * Third-party script runs with this origin's privileges, and the session lives in
 * localStorage, so it is loaded by the sign-in button and nowhere else, and the page is
 * reloaded on ANY sign-in once it has been loaded (`mustDropAppleScript`, used by the auth
 * listener; the Apple button reloads after its own sign-in), so it is never resident in the
 * signed-in dashboard. A failed load is forgotten so the next click retries.
 */
export function loadAppleId(): Promise<AppleIdApi> {
  if (window.AppleID?.auth) return Promise.resolve(window.AppleID);
  if (loading) return loading;

  loading = new Promise<AppleIdApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = APPLE_JS_URL;
    script.async = true;
    script.onload = () => {
      if (window.AppleID?.auth) {
        resolve(window.AppleID);
      } else {
        loading = null;
        reject(new Error('Apple sign-in did not load.'));
      }
    };
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('Apple sign-in could not load.'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

// ── Artwork ──────────────────────────────────────────────────────────────────────────────

/** Canvas of Apple's "Left-aligned - Small" logo file, in its own units. */
export const APPLE_LOGO_CANVAS = { width: 24, height: 44 } as const;

/**
 * The Apple logo from Apple Design Resources ("Logo - SIWA - Left-aligned - Black -
 * Small.svg"), byte for byte — the same artwork as the app's `AppleSignInButton`, which App
 * Review rejected when it was an icon-library redraw (2.1.1, guideline 4). Pinned by SHA-256
 * in `__tests__/appleId.test.ts`; re-copy it from Apple's file rather than editing it.
 */
export const APPLE_LOGO_PATH =
  'M12.2337427,16.9879688 C12.8896607,16.9879688 13.7118677,16.5445313 14.2014966,15.9532812 C14.6449341,15.4174609 14.968274,14.6691602 14.968274,13.9208594 C14.968274,13.8192383 14.9590357,13.7176172 14.9405591,13.6344727 C14.2107349,13.6621875 13.3330982,14.1241016 12.8065162,14.7430664 C12.3907935,15.2142188 12.012024,15.9532812 12.012024,16.7108203 C12.012024,16.8216797 12.0305005,16.9325391 12.0397388,16.9694922 C12.0859302,16.9787305 12.1598365,16.9879688 12.2337427,16.9879688 Z M9.92417241,28.1662891 C10.8202857,28.1662891 11.2175318,27.5658008 12.3353638,27.5658008 C13.4716724,27.5658008 13.721106,28.1478125 14.7188404,28.1478125 C15.6980982,28.1478125 16.3540162,27.2424609 16.972981,26.3555859 C17.6658521,25.339375 17.9522388,24.3416406 17.9707154,24.2954492 C17.9060474,24.2769727 16.0306763,23.5101953 16.0306763,21.3576758 C16.0306763,19.491543 17.5088013,18.6508594 17.5919459,18.5861914 C16.612688,17.1819727 15.1253248,17.1450195 14.7188404,17.1450195 C13.6194849,17.1450195 12.7233716,17.8101758 12.1598365,17.8101758 C11.5501099,17.8101758 10.7463794,17.1819727 9.79483648,17.1819727 C7.98413335,17.1819727 6.14571538,18.6785742 6.14571538,21.5054883 C6.14571538,23.2607617 6.8293482,25.1176563 7.67003179,26.3186328 C8.39061773,27.3348438 9.01882085,28.1662891 9.92417241,28.1662891 Z';
