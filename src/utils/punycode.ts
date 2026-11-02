/**
 * Punycode (RFC 3492) ENCODING of one domain label — `bücher` → `bcher-kva`. Encode only:
 * Livil turns a link's host into the ASCII form a browser actually visits, to NAME it before
 * leaving the app (utils/chatLinks.ts); it never needs to decode one.
 *
 * Why it is here at all: the phone's URL parser (react-native-url-polyfill, built on
 * whatwg-url-without-unicode) leaves a Unicode host as typed — `https://аpple.com` (a Cyrillic
 * а) parses to hostname "аpple.com", which reads as apple.com. Node's URL (Jest) would have
 * converted it, so a test run on Node alone could never notice.
 */

const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let d = firstTime ? Math.floor(delta / DAMP) : Math.floor(delta / 2);
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > Math.floor(((BASE - TMIN) * TMAX) / 2)) {
    d = Math.floor(d / (BASE - TMIN));
    k += BASE;
  }
  return Math.floor(k + ((BASE - TMIN + 1) * d) / (d + SKEW));
}

/** 0–25 → a–z, 26–35 → 0–9. */
function digit(d: number): string {
  return String.fromCharCode(d < 26 ? 97 + d : 22 + d);
}

/** The Punycode of one label, WITHOUT the `xn--` prefix. Lowercase input expected. */
export function punycodeEncode(label: string): string {
  const cps = Array.from(label).map(c => c.codePointAt(0)!);
  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;
  let output = cps.filter(c => c < 0x80).map(c => String.fromCharCode(c)).join('');
  const basic = output.length;
  let handled = basic;
  if (basic > 0) { output += '-'; }
  while (handled < cps.length) {
    let m = Infinity;
    for (const c of cps) { if (c >= n && c < m) { m = c; } }
    delta += (m - n) * (handled + 1);
    n = m;
    for (const c of cps) {
      if (c < n) { delta++; }
      if (c === n) {
        let q = delta;
        for (let k = BASE; ; k += BASE) {
          const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
          if (q < t) { break; }
          output += digit(t + ((q - t) % (BASE - t)));
          q = Math.floor((q - t) / (BASE - t));
        }
        output += digit(q);
        bias = adapt(delta, handled + 1, handled === basic);
        delta = 0;
        handled++;
      }
    }
    delta++;
    n++;
  }
  return output;
}
