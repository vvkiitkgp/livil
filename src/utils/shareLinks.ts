/**
 * Reading an incoming share link.
 *
 * Two forms reach the app and both must resolve to the same post:
 *
 *   livil://post/<uuid>                     the custom scheme, works today
 *   https://livil-music.com/p/<uuid>        an Android App Link, once assetlinks.json
 *                                           carries the Play App Signing fingerprint
 *
 * THIS PARSES UNTRUSTED INPUT. A deep link is anything any app on the device — or any
 * web page — can hand us, so the rules are deliberately strict rather than forgiving:
 *
 *   * the host is checked exactly. `livil-music.com.evil.test` and
 *     `evil.test/livil-music.com/p/x` both contain our domain as a substring and
 *     neither is ours, which is why this matches a parsed host and never `includes()`.
 *   * only https for the web form. An `http://` link is someone downgrading it.
 *   * the id must be a well-formed uuid. Anything else is not a post id, and passing
 *     a free-form string through to a query is how a parser becomes an injection.
 *
 * Returns null for anything that is not a Livil post link, including auth links —
 * those have their own handler and must not be confused with this one.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hosts whose `/p/<id>` paths are ours. Kept as a list because the apex and the www
 *  form are both live and either can end up in a pasted link. */
const SHARE_HOSTS = new Set(['livil-music.com', 'www.livil-music.com']);

export function postIdFromUrl(url: string): string | null {
  if (!url) { return null; }

  // Custom scheme. Not parsed with URL(): `livil://post/<id>` has no authority
  // component in the way URL expects, and different engines disagree about whether
  // `post` is the host or the first path segment. A literal prefix match has no such
  // ambiguity.
  const SCHEME = 'livil://post/';
  if (url.toLowerCase().startsWith(SCHEME)) {
    const id = url.slice(SCHEME.length).split(/[?#/]/)[0] ?? '';
    return UUID_RE.test(id) ? id.toLowerCase() : null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') { return null; }
  if (!SHARE_HOSTS.has(parsed.hostname.toLowerCase())) { return null; }

  // Exactly /p/<id>. A deeper path is not a post link, and treating it as one would
  // make every future route under /p/ silently open a post.
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length !== 2 || segments[0] !== 'p') { return null; }

  const id = segments[1] ?? '';
  return UUID_RE.test(id) ? id.toLowerCase() : null;
}
