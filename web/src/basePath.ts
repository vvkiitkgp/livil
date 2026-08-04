/**
 * Where the dashboard lives, in one place.
 *
 * The app is served under a subpath (`/studio/`) so the marketing page can own the apex.
 * That means EVERY absolute URL handed to an external system — an OAuth redirect, an
 * emailed confirmation link, a password-reset link — has to carry the base. An origin-only
 * URL like `${location.origin}/reset` is not merely wrong in production; it is wrong in
 * dev too, because Vite serves the app under `base` there as well and answers anything
 * outside it with "The server is configured with a public base URL of /studio/".
 *
 * That failure is expensive rather than merely annoying: a recovery token is SINGLE-USE and
 * is consumed by Supabase's `/verify` endpoint BEFORE the redirect. So the first click burns
 * the token and lands on an error page, and the second click reports `otp_expired` — which
 * reads like a mail-delay problem and is not.
 *
 * Read from `import.meta.env.BASE_URL` rather than hard-coded, so `base` in vite.config.ts
 * stays the single source of truth and dev cannot silently disagree with production.
 */

/** No trailing slash: `/studio`, or `/` when served at the root. */
export const STUDIO_BASE = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

/** Base-prefixed path for router/location comparisons: `/studio/reset`, or `/reset`. */
export function studioPath(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return STUDIO_BASE === '/' ? suffix : `${STUDIO_BASE}${suffix}`;
}

/**
 * Absolute URL for anything that leaves the browser: `https://livil-music.com/studio/reset`.
 *
 * Must be covered by Supabase → Auth → URL Configuration → Redirect URLs. The existing
 * `https://livil-music.com/**` and localhost wildcards already match the subpath.
 */
export function studioUrl(path: string): string {
  return `${window.location.origin}${studioPath(path)}`;
}
