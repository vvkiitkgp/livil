// Unit tests for the pure logic in welcome-email.
//
//     cd supabase/functions/welcome-email && deno test --no-config
//
// `--no-config` because Deno otherwise picks up the repo's root tsconfig.json, whose
// `"jsx": "react-native"` it does not understand. Same for send-push.
//
// SCOPE: `greetingParts` and `composeWelcome` — the two places a wrong change is silently
// wrong rather than loudly broken. Everything else in this function is a straight line
// through JWT verification, one RPC and one fetch, all of which need a deployed function
// (or a mocked network) to exercise meaningfully.
//
// The name and the handle are the ONLY caller-influenced values in the message, so most
// of these tests are about what `greetingParts` refuses.

import { assertEquals, assertMatch, assertStringIncludes } from 'jsr:@std/assert@1';
import { composeWelcome, corsHeaders, greetingParts, handler } from './app.ts';

// ── CORS ────────────────────────────────────────────────────────────────────
//
// These exist because the function shipped WITHOUT them and did nothing on web for its
// first hours in production. `functions.invoke` sends an Authorization header, so every
// browser preflights with OPTIONS; the original handler answered 405 with no
// `Access-Control-Allow-Origin`, the browser therefore never sent the POST, and
// `nudgeWelcomeEmail` swallowed the error by design. A signup produced no email, no
// ledger row and no trace. The preflight test below is the one that would have caught it.
const preflight = (origin = 'https://livil-music.com') =>
  new Request('https://x.functions.supabase.co/welcome-email', {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
  });

Deno.test('OPTIONS preflight is answered 2xx, not 405', async () => {
  const res = await handler(preflight());
  assertEquals(res.ok, true);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://livil-music.com');
});

Deno.test('preflight allows the header that forces it to exist', () => {
  // `authorization` is exactly why the request is non-simple. Drop it from this list and
  // the browser blocks the POST again.
  const headers = corsHeaders(preflight());
  assertStringIncludes(headers['Access-Control-Allow-Headers'], 'authorization');
  assertStringIncludes(headers['Access-Control-Allow-Methods'], 'POST');
});

Deno.test('corsHeaders echoes an allowed origin and refuses to echo a foreign one', () => {
  assertEquals(
    corsHeaders(preflight('https://livil-music.com'))['Access-Control-Allow-Origin'],
    'https://livil-music.com',
  );
  assertEquals(
    corsHeaders(preflight('http://localhost:5173'))['Access-Control-Allow-Origin'],
    'http://localhost:5173',
  );
  // An unrecognised origin gets prod echoed back rather than its own — so the browser
  // blocks it, and we never reflect an arbitrary caller's origin.
  assertEquals(
    corsHeaders(preflight('https://evil.example'))['Access-Control-Allow-Origin'],
    'https://livil-music.com',
  );
});

Deno.test('every response carries CORS headers, including rejections', async () => {
  const res = await handler(
    new Request('https://x.functions.supabase.co/welcome-email', {
      method: 'POST',
      headers: { Origin: 'https://livil-music.com' },
    }),
  );
  // No bearer → 401, but the browser must still be able to READ that 401.
  assertEquals(res.status, 401);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://livil-music.com');
});

// ── greetingParts: the name ─────────────────────────────────────────────────
Deno.test('greetingParts takes the name from display_name only', () => {
  assertEquals(greetingParts('Vamsi', 'vvk').name, 'Vamsi');
  // NOT the username: the handle has its own line, and "Hey vvk, you're @vvk" reads
  // like a bug.
  assertEquals(greetingParts(null, 'vvk').name, null);
  assertEquals(greetingParts('', 'vvk').name, null);
  assertEquals(greetingParts('   ', 'vvk').name, null);
});

Deno.test('greetingParts trims surrounding whitespace from the name', () => {
  assertEquals(greetingParts('  Vamsi  ', null).name, 'Vamsi');
});

// The load-bearing one: display_name is user-supplied and lands in an HTML document.
Deno.test('greetingParts refuses a name that could open a tag or an entity', () => {
  assertEquals(greetingParts('<script>alert(1)</script>', null).name, null);
  assertEquals(greetingParts('a"onmouseover="x', null).name, null);
  assertEquals(greetingParts("O'Brien", null).name, null);
  assertEquals(greetingParts('Tom & Jerry', null).name, null);
  // A newline in a subject line is header injection, not just ugly.
  assertEquals(greetingParts('Vamsi\r\nBcc: someone@example.com', null).name, null);
});

Deno.test('greetingParts rejects a name too long for a subject line', () => {
  assertEquals(greetingParts('V'.repeat(41), null).name, null);
  assertEquals(greetingParts('V'.repeat(40), null).name, 'V'.repeat(40));
});

// ── greetingParts: the handle ───────────────────────────────────────────────
Deno.test('greetingParts accepts a handle matching the claim_username rule', () => {
  assertEquals(greetingParts(null, 'vvk').handle, 'vvk');
  assertEquals(greetingParts(null, 'vvk_iitkgp').handle, 'vvk_iitkgp');
  assertEquals(greetingParts(null, 'a'.repeat(30)).handle, 'a'.repeat(30));
});

Deno.test('greetingParts tolerates a leading @ and surrounding space', () => {
  assertEquals(greetingParts(null, ' @vvk ').handle, 'vvk');
});

Deno.test('greetingParts drops a handle the username rule would never have allowed', () => {
  // `claim_username` enforces ^[a-z0-9_]{3,30}$ — anything else is legacy or junk.
  assertEquals(greetingParts(null, 'ab').handle, null);
  assertEquals(greetingParts(null, 'a'.repeat(31)).handle, null);
  assertEquals(greetingParts(null, 'Vamsi').handle, null); // uppercase: never stored
  assertEquals(greetingParts(null, 'vv k').handle, null);
  assertEquals(greetingParts(null, '<b>vvk</b>').handle, null);
  assertEquals(greetingParts(null, 'vvk\r\nBcc: x@y.z').handle, null);
  assertEquals(greetingParts(null, 42).handle, null);
});

Deno.test('greetingParts skips the unclaimed OAuth placeholder handle', () => {
  assertEquals(greetingParts(null, 'user_a1b2c3d4').handle, null);
  assertEquals(greetingParts('user_a1b2c3d4', null).name, null);
  // A real handle that merely starts with "user" is fine.
  assertEquals(greetingParts(null, 'usernamehero').handle, 'usernamehero');
});

Deno.test('greetingParts resolves name and handle independently', () => {
  assertEquals(greetingParts('<b>', 'vvk'), { name: null, handle: 'vvk' });
  assertEquals(greetingParts('Vamsi', 'NOPE'), { name: 'Vamsi', handle: null });
  assertEquals(greetingParts(null, null), { name: null, handle: null });
});

// ── composeWelcome ──────────────────────────────────────────────────────────
Deno.test('composeWelcome thanks the reader for signing up', () => {
  const { text, html } = composeWelcome('Vamsi', 'vvk');
  assertStringIncludes(text, 'Thank you for signing up');
  assertStringIncludes(html, 'Thanks for signing up');
});

Deno.test('composeWelcome greets by name and states the handle', () => {
  const { subject, text, html } = composeWelcome('Vamsi', 'vvk');
  assertEquals(subject, 'Welcome to Livil, Vamsi');
  assertStringIncludes(text, 'Hey Vamsi,');
  assertStringIncludes(text, "You're @vvk on Livil");
  assertStringIncludes(html, 'Hey Vamsi,');
  assertStringIncludes(html, '@vvk');
});

// The shell is shared with the Supabase Auth templates (Confirm your Livil account). If
// one drifts the two stop looking like the same product, and nothing else would catch it.
Deno.test('composeWelcome renders the dark backstage shell', () => {
  const { html } = composeWelcome('Vamsi', 'vvk');
  assertStringIncludes(html, '<!doctype html>');
  assertStringIncludes(html, 'color-scheme');
  assertStringIncludes(html, 'bgcolor="#0A0A0F"'); // page, per the auth templates
  assertStringIncludes(html, 'bgcolor="#12121C"'); // card
  assertStringIncludes(html, '#252545'); // card border
  assertStringIncludes(html, 'letter-spacing:3px'); // LIVIL wordmark
  // Outlook.com inverts dark-mode colours unless the override hangs off these attributes.
  assertStringIncludes(html, '[data-ogsc]');
  assertStringIncludes(html, '[data-ogsb]');
  // Tables, not divs — Outlook's Word renderer ignores div backgrounds.
  assertEquals(html.includes('<table'), true);
});

// The design system's hardest rule: purple outlines and letters, it never fills. A solid
// #8B3DFF block is the thing this email must never grow.
Deno.test('composeWelcome never paints a solid purple fill', () => {
  const { html } = composeWelcome('Vamsi', 'vvk');
  assertEquals(/background:\s*#8B3DFF/i.test(html), false);
  assertEquals(/bgcolor="#8B3DFF"/i.test(html), false);
});

Deno.test('composeWelcome falls back to the handle in the subject when there is no name', () => {
  assertEquals(composeWelcome(null, 'vvk').subject, 'Welcome to Livil, @vvk');
  assertEquals(composeWelcome(null, null).subject, 'Welcome to Livil');
});

Deno.test('composeWelcome omits the handle sentence entirely when there is no handle', () => {
  const { text, html } = composeWelcome('Vamsi', null);
  assertEquals(text.includes('@'), false);
  // Not a bare '@' check on the HTML, and not a loose regex either: the shell's `@media`
  // rule contains an '@' followed by letters, which an earlier version of this test
  // matched. A RENDERED handle is always the first thing inside its span, so `>@` is the
  // precise signature; the framing sentence is checked alongside it.
  assertEquals(html.includes('>@'), false);
  assertEquals(html.includes('on Livil. That handle'), false);
  // and still greets by name
  assertStringIncludes(text, 'Hey Vamsi,');
});

Deno.test('composeWelcome degrades to a generic greeting with neither', () => {
  const { text, html } = composeWelcome(null, null);
  assertStringIncludes(text, 'Hey there,');
  assertStringIncludes(html, 'Hey there,');
});

Deno.test('composeWelcome explains what the product actually is', () => {
  const { text, html } = composeWelcome('Vamsi', 'vvk');
  for (const part of [text, html]) {
    assertStringIncludes(part, 'social music platform');
    assertStringIncludes(part, 'Jam');
  }
  // The tagline is punctuated for prose in the text part and with entities in the shell,
  // matching how the auth templates write it.
  assertStringIncludes(text, 'Live, Vibe, Link');
  assertStringIncludes(html, 'Live &middot; Vibe &middot; Link');
});

// Every listener is a potential uploader, so the email says so — but only claims things
// that actually ship today: upload from either client, and credits the collaborator must
// accept before they appear.
Deno.test('composeWelcome pitches the creator side in both parts', () => {
  const { text, html } = composeWelcome('Vamsi', 'vvk');
  for (const part of [text, html]) {
    assertStringIncludes(part, 'if you ever want to make music');
    assertStringIncludes(part, 'accept or decline');
    assertStringIncludes(part, 'No label, no gatekeeping');
  }
});

// The requirement is "no links", so it is asserted rather than left to review. This fails
// on a bare URL as well as on an anchor, in either part of the message.
Deno.test('composeWelcome contains NO links, in either part, in every variant', () => {
  const variants: Array<[string | null, string | null]> = [
    ['Vamsi', 'vvk'],
    ['Vamsi', null],
    [null, 'vvk'],
    [null, null],
  ];
  for (const [name, handle] of variants) {
    const { text, html } = composeWelcome(name, handle);
    for (const part of [text, html]) {
      assertEquals(/<a\b/i.test(part), false, 'anchor tag found');
      assertEquals(/href\s*=/i.test(part), false, 'href found');
      assertEquals(/https?:\/\//i.test(part), false, 'bare URL found');
      assertEquals(/\bwww\./i.test(part), false, 'www. found');
      assertEquals(/livil-music\.com/i.test(part), false, 'domain found');
    }
  }
});

Deno.test('composeWelcome produces a text part that is not HTML', () => {
  const { text } = composeWelcome('Vamsi', 'vvk');
  assertEquals(text.includes('<'), false);
  assertMatch(text, /Vamsi — Livil$/);
});
