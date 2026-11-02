import { punycodeEncode } from './punycode';
import { postIdFromUrl, profileUsernameFromUrl } from './shareLinks';

/**
 * Links in chat messages: finding them, and deciding whether — and how — one may be opened.
 *
 * THIS READS UNTRUSTED INPUT. A message is whatever its sender typed, and a link is the
 * classic way to send someone somewhere they did not mean to go. So:
 *
 *   * only http and https. `javascript:`, `intent:`, `file:`, `livil:`, `tel:` … are never
 *     links here — not drawn as one, never opened.
 *   * parsed with a real URL parser, then the HOST is checked again by hand, because the
 *     phone's parser (react-native-url-polyfill → whatwg-url-without-unicode) does not do
 *     what a browser does with a Unicode host: `https://аpple.com` (Cyrillic а) stays
 *     "аpple.com", and `https://livil-music.com＠evil.com` (a full-width ＠) parses with that
 *     whole string as its host. Node's URL, which Jest uses, does both properly — so the
 *     tests run every case through BOTH parsers.
 *   * no user-info. `https://livil-music.com@evil.com` goes to evil.com; any `@` before the
 *     path (ASCII or a look-alike) is refused outright rather than explained.
 *   * the host is named in ASCII (Punycode) — the name the browser will actually visit.
 *     Only these open without asking, over https on the default port: a Livil POST or
 *     PROFILE link (exactly what the app's own deep-link parsers accept — opened inside the
 *     app) and anything on open.spotify.com. Everything else asks first
 *     (ConfirmActionModal, naming that host) — other livil-music.com pages included: one of
 *     them (/confirm) turns a sign-in token in its query into a livil://auth link, so a
 *     crafted one could sign the reader into someone else's account (security review).
 */

/** Hosts whose links may open without asking (see checkChatLink for which). Exact, ASCII, lowercase. */
const LIVIL_HOSTS = new Set(['livil-music.com', 'www.livil-music.com']);
const SPOTIFY_HOSTS = new Set(['open.spotify.com']);

/** Longer than any real link someone sends; past it, it is not worth parsing. */
const MAX_LINK_LENGTH = 2048;

export type LinkTrust = 'livil' | 'spotify';

export type CheckedLink = {
  /** What is opened: the scheme, the ASCII host, the port if any, then path/query/fragment. */
  href: string;
  /** The real host, in ASCII (Punycode for an international name) — what a confirmation names. */
  host: string;
  /** Opened without asking — or null: ask first. */
  trust: LinkTrust | null;
};

/** The parts of a parsed URL this file reads. Both Node's URL and the polyfill's have them. */
export type ParsedUrl = {
  protocol: string;
  username: string;
  password: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
};
export type UrlParser = new (input: string) => ParsedUrl;

/** `@` and its look-alikes: full-width ＠ (FF20) and small ﹫ (FE6B). */
const AT_SIGNS = /[@＠﹫]/;
/** Ideographic, full-width and half-width full stops — a browser reads each as `.`. */
const DOT_VARIANTS = /[。．｡]/g;
const ASCII_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** NFKC folds full-width letters to ASCII (ｌ → l), as a browser does; a no-op where unsupported. */
function nfkc(s: string): string {
  try {
    return typeof s.normalize === 'function' ? s.normalize('NFKC') : s;
  } catch {
    return s;
  }
}

/**
 * The host as a browser would visit it, in ASCII — or null when it is not a host Livil will
 * send anyone to (empty, one label, an IPv6 literal, a stray `@`, `_`, `%`, a space …).
 */
export function asciiHost(hostname: string): string | null {
  let h = nfkc(hostname).toLowerCase().replace(DOT_VARIANTS, '.');
  if (h.endsWith('.')) { h = h.slice(0, -1); }
  if (!h || h.length > 253) { return null; }
  const labels = h.split('.');
  if (labels.length < 2) { return null; }
  const ascii: string[] = [];
  for (const label of labels) {
    // eslint-disable-next-line no-control-regex
    const out = /^[\x00-\x7f]*$/.test(label) ? label : `xn--${punycodeEncode(label)}`;
    if (!ASCII_LABEL.test(out)) { return null; }
    ascii.push(out);
  }
  return ascii.join('.');
}

/**
 * Whether `raw` may be opened, and how — or null when it may not be (and so is not drawn as
 * a link either). `Parser` is the global URL on the phone (the polyfill, installed by
 * lib/supabase.ts); tests pass each parser explicitly.
 */
export function checkChatLink(raw: string, Parser: UrlParser = URL as unknown as UrlParser): CheckedLink | null {
  const s = raw.trim();
  if (!s || s.length > MAX_LINK_LENGTH) { return null; }
  if (!/^https?:\/\//i.test(s)) { return null; }
  // eslint-disable-next-line no-control-regex
  if (/[\s\x00-\x1f\x7f]/.test(s)) { return null; }
  // The authority as typed: up to the first / ? # or \ (a browser reads \ as /).
  const authority = s.slice(s.indexOf('//') + 2).split(/[/?#\\]/)[0] ?? '';
  if (AT_SIGNS.test(authority) || AT_SIGNS.test(nfkc(authority))) { return null; }

  let parsed: ParsedUrl;
  try {
    parsed = new Parser(s);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') { return null; }
  if (parsed.username || parsed.password) { return null; }
  const host = asciiHost(parsed.hostname);
  if (!host) { return null; }
  const port = parsed.port;
  if (port && !/^\d{1,5}$/.test(port)) { return null; }

  const href = `${parsed.protocol}//${host}${port ? `:${port}` : ''}${parsed.pathname}${parsed.search}${parsed.hash}`;
  const plain = parsed.protocol === 'https:' && !port;
  const trust: LinkTrust | null = !plain
    ? null
    : LIVIL_HOSTS.has(host) && (postIdFromUrl(href) !== null || profileUsernameFromUrl(href) !== null)
      ? 'livil'
      : SPOTIFY_HOSTS.has(host)
        ? 'spotify'
        : null;
  return { href, host, trust };
}

/** A run of a message's text: plain, or a link that passed checkChatLink. */
export type ChatTextPart = { text: string; link: CheckedLink | null };

const LINK_CANDIDATE = /(?:https?:\/\/|www\.)[^\s<>"]+/gi;
/** Punctuation that ends a sentence rather than a link: "see https://x.com/a." */
const TRAILING = /[.,;:!?'"*…»”’]$/;

/** Drops sentence punctuation, and a closing bracket the link did not open, from the end. */
function trimTrailing(candidate: string): string {
  let c = candidate;
  for (;;) {
    if (TRAILING.test(c)) { c = c.slice(0, -1); continue; }
    const last = c[c.length - 1];
    const pair = last === ')' ? '(' : last === ']' ? '[' : last === '}' ? '{' : null;
    if (pair) {
      const opens = c.split(pair).length - 1;
      const closes = c.split(last!).length - 1;
      if (closes > opens) { c = c.slice(0, -1); continue; }
    }
    return c;
  }
}

/**
 * The message's text split into plain runs and links — joined back, it is the text exactly.
 * A candidate that fails checkChatLink stays plain text: it is shown, never opened. A `www.`
 * link without a scheme is opened over https.
 */
export function splitChatLinks(text: string, Parser?: UrlParser): ChatTextPart[] {
  const parts: ChatTextPart[] = [];
  let plainFrom = 0;
  LINK_CANDIDATE.lastIndex = 0;
  for (let m = LINK_CANDIDATE.exec(text); m; m = LINK_CANDIDATE.exec(text)) {
    const start = m.index;
    // Inside a word or an address ("xhttps://…", "me@www.site.com"): not a link.
    const before = start > 0 ? text[start - 1]! : '';
    if (before && /[\w@./:-]/.test(before)) { continue; }
    const candidate = trimTrailing(m[0]);
    const withScheme = /^www\./i.test(candidate) ? `https://${candidate}` : candidate;
    const link = checkChatLink(withScheme, Parser);
    if (!link) { continue; }
    if (start > plainFrom) { parts.push({ text: text.slice(plainFrom, start), link: null }); }
    parts.push({ text: candidate, link });
    plainFrom = start + candidate.length;
    LINK_CANDIDATE.lastIndex = plainFrom;
  }
  if (plainFrom < text.length) { parts.push({ text: text.slice(plainFrom), link: null }); }
  return parts;
}
