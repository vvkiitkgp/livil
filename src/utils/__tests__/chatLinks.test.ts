/**
 * Links in chat (owner, 2026-11-02): tappable and copyable — but a message is whatever its
 * sender typed, so only http(s), parsed for real, no user-info tricks, and anything but
 * Livil / Spotify names its real (Punycode) host and asks before leaving the app.
 *
 * Every case runs through BOTH parsers: Node's URL (what Jest has by default) and the
 * phone's — react-native-url-polyfill, which leaves Unicode hosts as typed. A checker that
 * only passed on Node would pass here and fail on the phone.
 */
/* eslint-disable no-script-url -- the script URLs below are the attacks being refused */
import { asciiHost, checkChatLink, splitChatLinks, type UrlParser } from '../chatLinks';
import { punycodeEncode } from '../punycode';

const PhoneURL = require('react-native-url-polyfill/js/URL').URL as UrlParser;
const NodeURL = URL as unknown as UrlParser;

const PARSERS: Array<[string, UrlParser]> = [['phone (url-polyfill)', PhoneURL], ['node', NodeURL]];

describe('punycodeEncode', () => {
  it('matches the browser for real international names', () => {
    expect(punycodeEncode('bücher')).toBe('bcher-kva');
    expect(punycodeEncode('пример')).toBe('e1afmkfd');
    expect(punycodeEncode('рф')).toBe('p1ai');
    // A Cyrillic а in "apple": the look-alike gets a name nobody mistakes for apple.
    expect(punycodeEncode('аpple')).toBe('pple-43d');
  });
});

describe('asciiHost', () => {
  it('lowercases, folds full-width letters and dots, and Punycodes the rest', () => {
    expect(asciiHost('LIVIL-MUSIC.COM')).toBe('livil-music.com');
    expect(asciiHost('ｌivil-music．com')).toBe('livil-music.com');
    expect(asciiHost('аpple.com')).toBe('xn--pple-43d.com');
    expect(asciiHost('пример.рф')).toBe('xn--e1afmkfd.xn--p1ai');
  });

  it('refuses what is not a host to send anyone to', () => {
    expect(asciiHost('localhost')).toBeNull();
    expect(asciiHost('')).toBeNull();
    expect(asciiHost('[::1]')).toBeNull();
    expect(asciiHost('bad_host.com')).toBeNull();
    expect(asciiHost('a..b.com')).toBeNull();
  });
});

describe.each(PARSERS)('checkChatLink — %s parser', (_name, Parser) => {
  const check = (raw: string) => checkChatLink(raw, Parser);

  it('opens Livil posts and profiles without asking — and only over https, on the real host', () => {
    expect(check('https://livil-music.com/@riya')).toEqual({
      href: 'https://livil-music.com/@riya',
      host: 'livil-music.com',
      trust: 'livil',
    });
    expect(check('HTTPS://WWW.LIVIL-MUSIC.COM/p/0b0f5f2e-6a3c-4f4e-9d1a-2f8c1e7b9a10')?.trust).toBe('livil');
    // Over http, on another port, or as a subdomain of someone else: ask.
    expect(check('http://livil-music.com/@riya')?.trust).toBeNull();
    expect(check('https://livil-music.com:8443/@riya')?.trust).toBeNull();
    expect(check('https://livil-music.com.evil.com/p/x')).toEqual(
      expect.objectContaining({ host: 'livil-music.com.evil.com', trust: null }),
    );
  });

  it('asks before any other livil-music.com page — /confirm turns a token into a sign-in', () => {
    const confirm = check('https://livil-music.com/confirm?token_hash=abc&type=email');
    expect(confirm).toEqual(expect.objectContaining({ host: 'livil-music.com', trust: null }));
    expect(check('https://livil-music.com/studio')?.trust).toBeNull();
    expect(check('https://livil-music.com/p/not-a-uuid')?.trust).toBeNull();
  });

  it('opens open.spotify.com without asking, and nothing else of Spotify\'s', () => {
    expect(check('https://open.spotify.com/album/1ATL5GLyefJaxhQzSPVrLX')?.trust).toBe('spotify');
    expect(check('https://spotify.link/abc')?.trust).toBeNull();
  });

  it('asks before any other site, naming its host', () => {
    expect(check('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
      href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      host: 'www.youtube.com',
      trust: null,
    });
  });

  it('names a look-alike Unicode host by its Punycode, never as the site it imitates', () => {
    const link = check('https://аpple.com/login');
    expect(link).toEqual(expect.objectContaining({ host: 'xn--pple-43d.com', trust: null }));
    expect(link!.href).toBe('https://xn--pple-43d.com/login');
    // Full-width letters fold the way a browser folds them — still only "ask first".
    expect(check('https://ｌivil-music.com/@riya')?.host).toBe('livil-music.com');
  });

  it('refuses every scheme but http and https', () => {
    for (const raw of [
      'javascript:alert(1)',
      'JavaScript://%0Aalert(1)',
      'intent://scan/#Intent;scheme=zxing;end',
      'file:///etc/passwd',
      'livil://auth?code=x',
      'data:text/html,<script>alert(1)</script>',
      'tel:+911234567890',
      'ftp://example.com/a',
    ]) {
      expect(check(raw)).toBeNull();
    }
  });

  it('refuses user-info, including look-alike @ signs', () => {
    expect(check('https://livil-music.com@evil.com')).toBeNull();
    expect(check('https://livil-music.com＠evil.com')).toBeNull();
    expect(check('https://livil-music.com﹫evil.com/p/x')).toBeNull();
    expect(check('https://user:pass@example.com/')).toBeNull();
  });

  it('reads a backslash as the browser does: the host is what comes before it', () => {
    // A browser visits evil.com for both — so that is the host named, and it asks first.
    for (const raw of ['https://evil.com\\@livil-music.com', 'https://evil.com\\livil-music.com']) {
      expect(check(raw)).toEqual(expect.objectContaining({ host: 'evil.com', trust: null }));
    }
  });

  it('refuses what is not a well-formed link', () => {
    expect(check('https://')).toBeNull();
    expect(check('https://exa mple.com')).toBeNull();
    expect(check('https://localhost/x')).toBeNull();
    expect(check(`https://example.com/${'a'.repeat(2100)}`)).toBeNull();
  });
});

describe.each(PARSERS)('splitChatLinks — %s parser', (_name, Parser) => {
  const split = (text: string) => splitChatLinks(text, Parser);
  const joined = (text: string) => split(text).map(p => p.text).join('');

  it('finds links in a sentence and keeps every character of the text', () => {
    const text = 'try https://www.youtube.com/watch?v=x1 and livil-music.com — www.example.com/a.';
    const parts = split(text);
    expect(joined(text)).toBe(text);
    expect(parts.filter(p => p.link).map(p => p.text)).toEqual([
      'https://www.youtube.com/watch?v=x1',
      'www.example.com/a',
    ]);
    // A www. link is opened over https.
    expect(parts.find(p => p.text === 'www.example.com/a')!.link!.href).toBe('https://www.example.com/a');
  });

  it('leaves sentence punctuation and an unopened bracket outside the link', () => {
    const parts = split('(see https://en.wikipedia.org/wiki/Raga_(music)), ok?');
    expect(parts.filter(p => p.link).map(p => p.text)).toEqual(['https://en.wikipedia.org/wiki/Raga_(music)']);
  });

  it('draws no link for a refused one — it stays plain text', () => {
    const parts = split('click javascript:alert(1) or https://livil-music.com@evil.com now');
    expect(parts.every(p => p.link === null)).toBe(true);
  });

  it('ignores a scheme glued to a word or an address', () => {
    expect(split('xhttps://example.com').every(p => !p.link)).toBe(true);
    expect(split('mail me@www.example.com').every(p => !p.link)).toBe(true);
  });

  it('plain text is one plain part', () => {
    expect(split('kesariya on repeat')).toEqual([{ text: 'kesariya on repeat', link: null }]);
    expect(split('')).toEqual([]);
  });
});
