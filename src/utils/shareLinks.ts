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

/**
 * A handle as it can appear in a link. Looser than the claim rule (`^[a-z0-9_]{3,30}$`)
 * because a few accounts predate it — the database does the exact match. Mirrors
 * HANDLE_RE in web/api/profile.ts.
 */
const HANDLE_RE = /^[a-z0-9_-]{1,40}$/i;

/**
 * Reading an incoming PROFILE link. Same two forms, and the same strictness, as
 * postIdFromUrl:
 *
 *   livil://profile/<username>            the custom scheme ("Follow on Livil" on the web page)
 *   https://livil-music.com/@<username>   the link people share and put in their bio
 *
 * Returns the handle lowercased (handles are stored lowercase), or null for anything that
 * is not a Livil profile link — post links and auth links included, which have their own
 * readers.
 */
export function profileUsernameFromUrl(url: string): string | null {
  if (!url) { return null; }

  const SCHEME = 'livil://profile/';
  if (url.toLowerCase().startsWith(SCHEME)) {
    return cleanHandle(url.slice(SCHEME.length).split(/[?#/]/)[0] ?? '');
  }

  // Parsed by hand, NOT with URL(). React Native's built-in URL finds the host with a
  // regex whose optional `user@` part swallows `livil-music.com/@` — so for a profile link
  // the "host" comes out as the handle and every one fails the host check, silently. It
  // only works today because lib/supabase.ts installs react-native-url-polyfill; a parser
  // that depends on import order is one refactor from breaking, and Jest (Node's URL)
  // could never notice. Post links have no `@`, which is why postIdFromUrl never hit it.
  //
  // The authority is everything up to the first `/`, `?` or `#`, compared EXACTLY against
  // our hosts: `user@livil-music.com`, `livil-music.com@evil.test`, a port, and
  // `livil-music.com.evil.test` are all simply not in the set.
  const match = /^https:\/\/([^/?#]+)(\/[^?#]*)?(?:[?#][\s\S]*)?$/i.exec(url);
  if (!match) { return null; }
  if (!SHARE_HOSTS.has((match[1] ?? '').toLowerCase())) { return null; }

  // Exactly /@<handle>. A deeper path is not a profile link, for the same reason a
  // deeper /p/ path is not a post link.
  const segments = (match[2] ?? '').split('/').filter(Boolean);
  if (segments.length !== 1) { return null; }
  // `@` may arrive percent-encoded (%40) from a client that over-escapes.
  let segment = segments[0] ?? '';
  try { segment = decodeURIComponent(segment); } catch { return null; }
  if (!segment.startsWith('@')) { return null; }
  return cleanHandle(segment.slice(1));
}

/**
 * The handle of a chat message that is a profile link AND NOTHING ELSE, or null.
 *
 * Stricter than profileUsernameFromUrl on purpose. That parser ignores a query, a
 * fragment and (for the scheme) anything after the first path segment, which is right
 * for opening a link and wrong for deciding to replace a message with a card: a body of
 * `https://livil-music.com/@riya#…a paragraph…` would parse as `riya`, render as a card,
 * and hide the paragraph from recipients on new builds while old builds show it. So the
 * trimmed body must be exactly the canonical https link (apex or www, optional trailing
 * slash) — what the Share sheet sends, and what a pasted link looks like.
 */
export function profileHandleIfExactLink(text: string): string | null {
  const body = text.trim();
  const handle = profileUsernameFromUrl(body);
  if (!handle) { return null; }
  for (const host of SHARE_HOSTS) {
    const canonical = `https://${host}/@${handle}`;
    if (body === canonical || body === `${canonical}/`) { return handle; }
  }
  return null;
}

function cleanHandle(raw: string): string | null {
  let handle = raw;
  try { handle = decodeURIComponent(handle); } catch { return null; }
  return HANDLE_RE.test(handle) ? handle.toLowerCase() : null;
}
