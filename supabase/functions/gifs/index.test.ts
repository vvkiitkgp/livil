// Tests for the gifs edge function (ADR-0031). Run:
//   deno test --no-config supabase/functions/gifs/index.test.ts
//
// No network: every outbound call goes through a fake `fetch` that records what was asked.
// The properties under test, most important first:
//   - only signed-in users get anything;
//   - nothing rated above PG-13 is ever returned, from ANY action — lookup included, since
//     its ids come from comment rows anyone signed in can write;
//   - only media URLs on GIPHY's CDN are returned, exactly as GIPHY sent them, and never
//     GIPHY's raw response (it is not a general proxy);
//   - the key never appears in a log line;
//   - a failed GIPHY call is a failure (or "not answered"), never "no results".

import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  type Deps,
  type Gif,
  GIF_ID_RE,
  handle,
  MAX_IDS_PER_CALL,
  MAX_OFFSET,
  nextOffset,
  normalizeGif,
  PAGE_SIZE,
  parseCallsPerHour,
  resetState,
  CALLS_PER_USER_PER_HOUR,
  DEFAULT_CALLS_PER_HOUR,
} from './app.ts';
import * as client from '../../../src/utils/gifIds.ts';

const KEY = 'test-giphy-key';
const ID = '3o7TKSjRrfIPjeiVyM';
const ID2 = 'l0HlvtIPzPdt2usKs';

function apiGif(id: string, over: Record<string, unknown> = {}) {
  return {
    type: 'gif',
    id,
    title: 'Happy Dance GIF by Disney',
    rating: 'pg',
    url: `https://giphy.com/gifs/${id}`,
    username: 'disney',
    images: {
      fixed_width: {
        url: `https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/${id}/200w.gif?cid=790b7611&rid=200w.gif&ct=g`,
        width: '200',
        height: '150',
        mp4: `https://media2.giphy.com/media/${id}/200w.mp4`,
      },
      fixed_width_downsampled: {
        url: `https://media2.giphy.com/media/${id}/200w_d.gif?cid=790b7611&rid=200w_d.gif&ct=g`,
        width: '200',
        height: '150',
      },
      original: { url: `https://media2.giphy.com/media/${id}/giphy.gif`, width: '480', height: '360' },
    },
    analytics: { onload: { url: 'https://giphy-analytics.giphy.com/v2/pingback_simple?x' } },
    ...over,
  };
}

// ── Normalisation ───────────────────────────────────────────────────────────

Deno.test('normalizeGif keeps only the enumerated fields, URLs untouched', () => {
  const gif = normalizeGif(apiGif(ID));
  assertEquals(gif, {
    id: ID,
    provider: 'giphy',
    title: 'Happy Dance GIF by Disney',
    width: 200,
    height: 150,
    url: `https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/${ID}/200w.gif?cid=790b7611&rid=200w.gif&ct=g`,
    previewUrl: `https://media2.giphy.com/media/${ID}/200w_d.gif?cid=790b7611&rid=200w_d.gif&ct=g`,
  });
});

Deno.test('normalizeGif refuses anything rated above PG-13, or unrated', () => {
  for (const rating of ['g', 'pg', 'pg-13', 'PG-13']) {
    assert(normalizeGif(apiGif(ID, { rating })), rating);
  }
  for (const rating of ['r', 'R', 'nc-17', 'y', '', null, undefined, 3]) {
    assertEquals(normalizeGif(apiGif(ID, { rating })), null, String(rating));
  }
});

Deno.test('normalizeGif refuses media off GIPHY\'s CDN', () => {
  const bad = [
    'http://media2.giphy.com/media/x/200w.gif',
    'https://evil.example/media/x/200w.gif',
    'https://media2.giphy.com.evil.example/x.gif',
    'https://giphy.com/gifs/x',
    'javascript:alert(1)',
    'https://media2.giphy.com/media/x /200w.gif',
  ];
  for (const url of bad) {
    const raw = apiGif(ID);
    raw.images.fixed_width.url = url;
    assertEquals(normalizeGif(raw), null, url);
  }
  for (const host of ['media.giphy.com', 'media0.giphy.com', 'media4.giphy.com', 'i.giphy.com']) {
    const raw = apiGif(ID);
    raw.images.fixed_width.url = `https://${host}/media/${ID}/200w.gif`;
    assert(normalizeGif(raw), host);
  }
});

Deno.test('normalizeGif falls back to the main rendition for the preview', () => {
  const raw = apiGif(ID);
  raw.images.fixed_width_downsampled.url = 'https://evil.example/x.gif';
  assertEquals(normalizeGif(raw)?.previewUrl, raw.images.fixed_width.url);
});

Deno.test('normalizeGif refuses bad ids and unusable sizes', () => {
  assertEquals(normalizeGif(apiGif('has space')), null);
  assertEquals(normalizeGif(apiGif('../../etc')), null);
  assertEquals(normalizeGif(apiGif('x'.repeat(65))), null);
  for (const width of ['0', '-1', '4097', 'abc', '', null, '1.5']) {
    const raw = apiGif(ID);
    (raw.images.fixed_width as Record<string, unknown>).width = width;
    assertEquals(normalizeGif(raw), null, String(width));
  }
  assertEquals(normalizeGif(null), null);
  assertEquals(normalizeGif('gif'), null);
  assertEquals(normalizeGif({ ...apiGif(ID), images: undefined }), null);
});

Deno.test('normalizeGif bounds the title', () => {
  assertEquals(normalizeGif(apiGif(ID, { title: `  ${'a'.repeat(300)}  ` }))?.title.length, 140);
  assertEquals(normalizeGif(apiGif(ID, { title: 7 }))?.title, '');
});

Deno.test('the app, the function and the database agree on what a GIF id is', () => {
  // post_comments_gif_id_format in migration 20261030000000.
  assertEquals(GIF_ID_RE.source, /^[A-Za-z0-9]{1,64}$/.source);
  assertEquals(client.GIF_ID_RE.source, GIF_ID_RE.source);
});

Deno.test('nextOffset stops at the end, and at GIPHY\'s offset cap', () => {
  assertEquals(nextOffset(0, 18, 100), 18);
  assertEquals(nextOffset(90, 10, 100), null);
  assertEquals(nextOffset(0, 0, 100), null);
  assertEquals(nextOffset(MAX_OFFSET - 5, 18, 100_000), null);
  assertEquals(nextOffset(0, 18, undefined), 18);
});

// ── The handler ─────────────────────────────────────────────────────────────

type Call = { url: string };

function deps(opts: {
  apiKey?: string | null;
  callsPerHour?: number;
  userId?: string | null;
  respond?: (url: URL) => Response | Promise<Response>;
  now?: () => number;
} = {}): { deps: Deps; calls: Call[] } {
  const calls: Call[] = [];
  const respond = opts.respond ?? (() => Response.json({ data: [apiGif(ID), apiGif(ID2)], pagination: { total_count: 500 } }));
  return {
    calls,
    deps: {
      env: {
        apiKey: opts.apiKey === undefined ? KEY : opts.apiKey,
        callsPerHour: opts.callsPerHour ?? DEFAULT_CALLS_PER_HOUR,
      },
      getUserId: () => Promise.resolve(opts.userId === undefined ? 'user-1' : opts.userId),
      fetch: ((input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        calls.push({ url });
        return Promise.resolve(respond(new URL(url)));
      }) as typeof fetch,
      now: opts.now ?? (() => 1_000_000),
    },
  };
}

function token(sub: string): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256' })}.${b64({ sub })}.sig`;
}

function post(body: unknown, auth: string | null = `Bearer ${token('user-1')}`): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = auth;
  return new Request('http://localhost/gifs', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

Deno.test('signed-in users only', async () => {
  resetState();
  const { deps: d, calls } = deps({ userId: null });
  assertEquals((await handle(post({ action: 'status' }, null), d)).status, 401);
  assertEquals((await handle(post({ action: 'status' }, 'Basic x'), d)).status, 401);
  assertEquals((await handle(post({ action: 'search', q: 'hi' }), d)).status, 401);
  assertEquals(calls.length, 0);
});

Deno.test('rejects other methods and malformed bodies', async () => {
  resetState();
  const { deps: d } = deps();
  assertEquals((await handle(new Request('http://localhost/gifs', { method: 'GET' }), d)).status, 405);
  assertEquals((await handle(new Request('http://localhost/gifs', { method: 'OPTIONS' }), d)).status, 204);
  assertEquals((await handle(post('not json'), d)).status, 400);
  assertEquals((await handle(post([1, 2]), d)).status, 400);
  assertEquals((await handle(post({ action: 'proxy', url: 'https://x' }), d)).status, 400);
});

Deno.test('status says whether a key is configured', async () => {
  resetState();
  assertEquals(await (await handle(post({ action: 'status' }), deps().deps)).json(), { enabled: true });
  assertEquals(await (await handle(post({ action: 'status' }), deps({ apiKey: null }).deps)).json(), { enabled: false });
});

Deno.test('without a key nothing reaches GIPHY', async () => {
  resetState();
  const { deps: d, calls } = deps({ apiKey: null });
  assertEquals(await (await handle(post({ action: 'trending' }), d)).json(), { enabled: false, gifs: [], next: null });
  assertEquals(await (await handle(post({ action: 'search', q: 'yay' }), d)).json(), { enabled: false, gifs: [], next: null });
  assertEquals(await (await handle(post({ action: 'lookup', ids: [ID] }), d)).json(), { gifs: {} });
  assertEquals(calls.length, 0);
});

Deno.test('search asks GIPHY for one PG-13 page and returns only our shape', async () => {
  resetState();
  const { deps: d, calls } = deps({
    respond: () => Response.json({
      data: [apiGif(ID), apiGif('rated', { rating: 'r' }), apiGif(ID2)],
      pagination: { total_count: 500, count: 3, offset: 36 },
      meta: { status: 200 },
    }),
  });
  const res = await handle(post({ action: 'search', q: '  happy dance ', offset: 36 }), d);
  assertEquals(res.status, 200);
  const body = await res.json() as { enabled: boolean; gifs: Gif[]; next: number | null };
  assertEquals(body.enabled, true);
  assertEquals(body.gifs.map(g => g.id), [ID, ID2]);
  // Paged by what GIPHY returned (3), not by what survived the filter (2).
  assertEquals(body.next, 39);
  assertEquals(Object.keys(body).sort(), ['enabled', 'gifs', 'next']);
  assertEquals(calls.length, 1);
  const url = new URL(calls[0].url);
  assertEquals(url.origin + url.pathname, 'https://api.giphy.com/v1/gifs/search');
  assertEquals(url.searchParams.get('q'), 'happy dance');
  assertEquals(url.searchParams.get('rating'), 'pg-13');
  assertEquals(url.searchParams.get('limit'), String(PAGE_SIZE));
  assertEquals(url.searchParams.get('offset'), '36');
  assertEquals(url.searchParams.get('api_key'), KEY);
});

Deno.test('trending is the same, without a query', async () => {
  resetState();
  const { deps: d, calls } = deps();
  const body = await (await handle(post({ action: 'trending' }), d)).json() as { gifs: Gif[] };
  assertEquals(body.gifs.length, 2);
  const url = new URL(calls[0].url);
  assertEquals(url.pathname, '/v1/gifs/trending');
  assertEquals(url.searchParams.get('rating'), 'pg-13');
  assertEquals(url.searchParams.get('offset'), '0');
  assertEquals(url.searchParams.has('q'), false);
});

Deno.test('search validates its input before spending anything', async () => {
  resetState();
  const { deps: d, calls } = deps();
  for (const body of [
    { action: 'search' },
    { action: 'search', q: '   ' },
    { action: 'search', q: 'x'.repeat(51) },
    { action: 'search', q: 7 },
    { action: 'search', q: 'ok', offset: -1 },
    { action: 'search', q: 'ok', offset: 1.5 },
    { action: 'search', q: 'ok', offset: MAX_OFFSET + 1 },
    { action: 'trending', offset: '18' },
  ]) {
    assertEquals((await handle(post(body), d)).status, 400, JSON.stringify(body));
  }
  assertEquals(calls.length, 0);
});

Deno.test('a GIPHY failure is a 502, never an empty result', async () => {
  for (const respond of [
    () => new Response('{"message":"Invalid authentication credentials"}', { status: 401 }),
    () => new Response('oops', { status: 500 }),
    () => { throw new Error('network down'); },
  ]) {
    resetState();
    const res = await handle(post({ action: 'search', q: 'hi' }), deps({ respond }).deps);
    assertEquals(res.status, 502);
  }
});

Deno.test('a 429 trips the breaker: no more GIPHY calls until it passes', async () => {
  resetState();
  let now = 1_000_000;
  let limited = true;
  const { deps: d, calls } = deps({
    now: () => now,
    respond: () => limited
      ? new Response('{}', { status: 429, headers: { 'retry-after': '120' } })
      : Response.json({ data: [apiGif(ID)] }),
  });
  assertEquals((await handle(post({ action: 'trending' }), d)).status, 502);
  limited = false;
  now += 60_000;
  assertEquals((await handle(post({ action: 'trending' }), d)).status, 502);
  assertEquals(calls.length, 1);
  now += 61_000;
  assertEquals((await handle(post({ action: 'trending' }), d)).status, 200);
  assertEquals(calls.length, 2);
});

Deno.test('the key never reaches a log line', async () => {
  resetState();
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
  try {
    const respond = () => new Response(JSON.stringify({ meta: { msg: 'Forbidden', status: 403 } }), { status: 403 });
    await handle(post({ action: 'search', q: 'hi' }), deps({ respond }).deps);
  } finally {
    console.warn = original;
  }
  assert(warnings.length > 0);
  assert(warnings.every(w => !w.includes(KEY)), warnings.join('\n'));
  assert(warnings.some(w => w.includes('403') && w.includes('Forbidden')));
});

Deno.test('lookup answers every id GIPHY answered, null for removed or too-high rated', async () => {
  resetState();
  const { deps: d, calls } = deps({
    // ID2 comes back rated R: GIPHY answered, and the answer is "not for us".
    respond: () => Response.json({ data: [apiGif(ID), apiGif(ID2, { rating: 'r' })] }),
  });
  const res = await handle(post({ action: 'lookup', ids: [ID, ID2, 'gone123', ID] }), d);
  const body = await res.json() as { gifs: Record<string, Gif | null> };
  assertEquals(Object.keys(body.gifs).sort(), [ID, ID2, 'gone123'].sort());
  assertEquals(body.gifs[ID]?.id, ID);
  assertEquals(body.gifs[ID2], null);
  assertEquals(body.gifs.gone123, null);
  assertEquals(calls.length, 1);
  const url = new URL(calls[0].url);
  assertEquals(url.pathname, '/v1/gifs');
  assertEquals(url.searchParams.get('ids'), [ID, ID2, 'gone123'].join(','));
});

Deno.test('lookup ignores a GIF GIPHY returns that was not asked for', async () => {
  resetState();
  const respond = () => Response.json({ data: [apiGif(ID), apiGif('unasked1')] });
  const body = await (await handle(post({ action: 'lookup', ids: [ID] }), deps({ respond }).deps)).json() as {
    gifs: Record<string, Gif | null>;
  };
  assertEquals(Object.keys(body.gifs), [ID]);
});

Deno.test('a failed lookup answers nothing, so the app retries later', async () => {
  resetState();
  const respond = () => new Response('down', { status: 503 });
  const res = await handle(post({ action: 'lookup', ids: [ID] }), deps({ respond }).deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { gifs: {} });
});

Deno.test('lookup validates ids before spending anything', async () => {
  resetState();
  const { deps: d, calls } = deps();
  for (const ids of [undefined, [], 'abc', [ID, 'bad id'], [ID, 7], Array(MAX_IDS_PER_CALL + 1).fill(ID)]) {
    assertEquals((await handle(post({ action: 'lookup', ids }), d)).status, 400, JSON.stringify(ids));
  }
  assertEquals(calls.length, 0);
});

Deno.test('the per-user budget is hourly, and an over-budget caller is not even verified', async () => {
  resetState();
  let now = 1_000_000;
  let verified = 0;
  const { deps: base, calls } = deps({ now: () => now });
  const d: Deps = { ...base, getUserId: () => { verified += 1; return Promise.resolve('user-1'); } };
  for (let i = 0; i < CALLS_PER_USER_PER_HOUR; i++) {
    assertEquals((await handle(post({ action: 'trending' }), d)).status, 200);
    now += 60_000;  // one a minute — still one account's hour, not a burst
  }
  assertEquals((await handle(post({ action: 'trending' }), d)).status, 429);
  assertEquals(calls.length, CALLS_PER_USER_PER_HOUR);
  assertEquals(verified, CALLS_PER_USER_PER_HOUR);
  // Another person is unaffected.
  const other: Deps = { ...base, getUserId: () => Promise.resolve('user-2') };
  assertEquals((await handle(post({ action: 'trending' }, `Bearer ${token('user-2')}`), other)).status, 200);
  // An hour after the first call, the first one has aged out.
  now = 1_000_000 + 60 * 60 * 1000 + 1;
  assertEquals((await handle(post({ action: 'trending' }), d)).status, 200);
});

Deno.test('the app-wide hourly budget holds across many accounts', async () => {
  resetState();
  const { deps: base, calls } = deps({ callsPerHour: 5 });
  for (let i = 0; i < 7; i++) {
    const user = `user-${i}`;
    const d: Deps = { ...base, getUserId: () => Promise.resolve(user) };
    const status = (await handle(post({ action: 'trending' }, `Bearer ${token(user)}`), d)).status;
    assertEquals(status, i < 5 ? 200 : 429, user);
  }
  assertEquals(calls.length, 5);
});

Deno.test('a refused call spends nothing', async () => {
  resetState();
  const { deps: base, calls } = deps({ callsPerHour: 1 });
  const d1: Deps = { ...base, getUserId: () => Promise.resolve('user-1') };
  assertEquals((await handle(post({ action: 'trending' }), d1)).status, 200);
  for (let i = 0; i < 3; i++) {
    assertEquals((await handle(post({ action: 'trending' }), d1)).status, 429);
  }
  assertEquals(calls.length, 1);
});

Deno.test('GIFS_CALLS_PER_HOUR: a positive whole number, else the default', () => {
  assertEquals(parseCallsPerHour('2500'), 2500);
  for (const raw of [undefined, '', '0', '-5', '1.5', 'lots']) {
    assertEquals(parseCallsPerHour(raw), DEFAULT_CALLS_PER_HOUR, String(raw));
  }
});

Deno.test('a key echoed in an error body is redacted before logging', async () => {
  resetState();
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
  try {
    const respond = () => new Response(`<html>bad request to /v1/gifs?api_key=${KEY}</html>`, { status: 400 });
    await handle(post({ action: 'trending' }), deps({ respond }).deps);
  } finally {
    console.warn = original;
  }
  assert(warnings.some(w => w.includes('[key]')), warnings.join('\n'));
  assert(warnings.every(w => !w.includes(KEY)), warnings.join('\n'));
});
