// Tests for the spotify edge function (ADR-0027). Run:
//   deno test --no-config supabase/functions/spotify/index.test.ts
//
// No network: every outbound call goes through a fake `fetch` that records what was asked.
// The properties under test, most important first:
//   - only signed-in users get anything;
//   - the function never fetches a URL the caller chose, and never returns Spotify's raw
//     response (it is not a general proxy);
//   - without credentials it degrades to "no search" and oEmbed metadata, never an error;
//   - the app and the server agree on what a Spotify track link is.

import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  type Deps,
  handle,
  normalizeApiTrack,
  normalizeOembed,
  parseShortLinkCode,
  parseSpotifyTrackId,
  pickImage,
  resetState,
  unverifiedSubject,
  MAX_SEARCH_RESULTS,
  UPSTREAM_CALLS_PER_USER_PER_MINUTE,
  UPSTREAM_CONCURRENCY,
  SHARED_PREFIX,
  type SharedCache,
  decodeSharedSearch,
  decodeSharedTrack,
  mapLimit,
  upstashCache,
  CACHED_SEARCH_COST,
  CACHE_TTL_MS,
  EMPTY_SEARCH_TTL_MS,
  MAX_BACKOFF_MS,
  isSpotifyImageUrl,
  normalizeQuery,
  searchKey,
} from './app.ts';
import * as client from '../../../src/utils/spotifyLinks.ts';

const ID = '0VjIjW4GlUZAMYd2vXMi3b';
const ID2 = '4uLU6hMCjMI75M1A2tKUQC';

// ── Link parsing ────────────────────────────────────────────────────────────

const LINK_CASES: Array<[string, string | null]> = [
  [ID, ID],
  [`  ${ID}  `, ID],
  [`https://open.spotify.com/track/${ID}`, ID],
  [`https://open.spotify.com/track/${ID}?si=abc123&context=x`, ID],
  [`https://open.spotify.com/intl-de/track/${ID}`, ID],
  [`https://open.spotify.com/intl-pt-BR/track/${ID}?si=1`, ID],
  [`open.spotify.com/track/${ID}`, ID],
  [`spotify:track:${ID}`, ID],
  [`https://open.spotify.com/album/${ID}`, null],
  [`https://open.spotify.com/playlist/${ID}`, null],
  [`https://open.spotify.com/track/short`, null],
  [`https://evil.example/open.spotify.com/track/${ID}`, null],
  [`https://open.spotify.com.evil.example/track/${ID}`, null],
  [`https://xopen.spotify.com/track/${ID}`, null],
  ['blinding lights', null],
  ['', null],
];

Deno.test('parseSpotifyTrackId accepts track links only', () => {
  for (const [input, expected] of LINK_CASES) {
    assertEquals(parseSpotifyTrackId(input), expected, input);
  }
});

Deno.test('the app and the server parse every link identically', () => {
  for (const [input] of LINK_CASES) {
    assertEquals(client.parseSpotifyTrackId(input), parseSpotifyTrackId(input), input);
  }
  assertEquals(client.SPOTIFY_ID_RE.source, /^[A-Za-z0-9]{22}$/.source);
});

Deno.test('parseShortLinkCode accepts only https://spotify.link/<code>', () => {
  assertEquals(parseShortLinkCode('https://spotify.link/AbCd1234'), 'AbCd1234');
  assertEquals(parseShortLinkCode('https://spotify.link/AbCd1234?x=1'), 'AbCd1234');
  assertEquals(parseShortLinkCode('http://spotify.link/AbCd1234'), null);
  assertEquals(parseShortLinkCode('https://spotify.link.evil/AbCd1234'), null);
  assertEquals(parseShortLinkCode('https://spotify.link/../../etc'), null);
});

// ── Normalisation ───────────────────────────────────────────────────────────

const API_TRACK = {
  id: ID,
  name: 'Blinding Lights',
  duration_ms: 200040,
  artists: [{ name: 'The Weeknd' }],
  album: {
    name: 'After Hours',
    images: [
      { url: 'https://i.scdn.co/image/640', width: 640 },
      { url: 'https://i.scdn.co/image/300', width: 300 },
      { url: 'https://i.scdn.co/image/64', width: 64 },
    ],
  },
  popularity: 90,
  available_markets: ['IN'],
  external_ids: { isrc: 'X' },
};

Deno.test('normalizeApiTrack keeps only the enumerated fields', () => {
  assertEquals(normalizeApiTrack(API_TRACK), {
    id: ID,
    title: 'Blinding Lights',
    artists: ['The Weeknd'],
    album: 'After Hours',
    imageUrl: 'https://i.scdn.co/image/300',
    durationMs: 200040,
  });
});

Deno.test('normalizeApiTrack rejects things that are not tracks', () => {
  assertEquals(normalizeApiTrack(null), null);
  assertEquals(normalizeApiTrack({ id: 'bad', name: 'x' }), null);
  assertEquals(normalizeApiTrack({ id: ID }), null);
});

Deno.test('pickImage prefers the smallest image that is still >= 300px, https only', () => {
  assertEquals(pickImage([{ url: 'https://a/64', width: 64 }, { url: 'https://a/640', width: 640 }]), 'https://a/640');
  assertEquals(pickImage([{ url: 'https://a/64', width: 64 }]), 'https://a/64');
  assertEquals(pickImage([{ url: 'http://insecure/640', width: 640 }]), null);
  assertEquals(pickImage(undefined), null);
});

Deno.test('normalizeOembed gives a title and artwork, no artist', () => {
  assertEquals(normalizeOembed(ID, { title: 'Blinding Lights', thumbnail_url: 'https://i.scdn.co/x' }), {
    id: ID, title: 'Blinding Lights', artists: [], album: null, imageUrl: 'https://i.scdn.co/x', durationMs: null,
  });
  assertEquals(normalizeOembed(ID, { html: '<iframe>' }), null);
});

// ── The handler ─────────────────────────────────────────────────────────────

type Call = { url: string; init?: RequestInit };

function makeDeps(opts: {
  creds?: boolean;
  respond?: (url: string, init?: RequestInit) => Response;
  user?: string | null;
} = {}): { deps: Deps; calls: Call[]; authCalls: () => number; setNow: (t: number) => void } {
  let authCount = 0;
  let clock = 1_000_000;
  resetState();
  const calls: Call[] = [];
  const respond = opts.respond ?? ((url: string) => {
    if (url.startsWith('https://accounts.spotify.com/api/token')) {
      return Response.json({ access_token: 'tok', expires_in: 3600 });
    }
    if (url.startsWith('https://api.spotify.com/v1/search')) {
      return Response.json({ tracks: { items: [API_TRACK, { id: 'junk' }] } });
    }
    if (url.startsWith('https://api.spotify.com/v1/tracks/')) return Response.json(API_TRACK);
    if (url.startsWith('https://open.spotify.com/oembed')) {
      return Response.json({ title: 'Blinding Lights', thumbnail_url: 'https://i.scdn.co/o' });
    }
    return new Response('not found', { status: 404 });
  });
  const deps: Deps = {
    env: {
      clientId: opts.creds === false ? null : 'id',
      clientSecret: opts.creds === false ? null : 'secret',
    },
    getUserId: (jwt: string) => {
      authCount++;
      const valid = jwt === 'good' || jwt === GOOD_JWT;
      return Promise.resolve(opts.user === undefined ? (valid ? 'user-1' : null) : opts.user);
    },
    fetch: ((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, init });
      return Promise.resolve(respond(url, init));
    }) as typeof fetch,
    now: () => clock,
  };
  return { deps, calls, authCalls: () => authCount, setNow: (t: number) => { clock = t; } };
}

/** A token-shaped string whose payload names user-1 (signature irrelevant: unverified use). */
const GOOD_JWT = `x.${btoa(JSON.stringify({ sub: 'user-1' })).replace(/=+$/, '')}.y`;

const post = (body: unknown, token = 'good') =>
  new Request('https://fn.local/spotify', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

Deno.test('no token → 401, and nothing is fetched', async () => {
  const { deps, calls } = makeDeps();
  const res = await handle(new Request('https://fn.local', { method: 'POST', body: '{}' }), deps);
  assertEquals(res.status, 401);
  assertEquals(calls.length, 0);
});

Deno.test('an invalid session → 401', async () => {
  const { deps } = makeDeps();
  assertEquals((await handle(post({ action: 'status' }, 'bad'), deps)).status, 401);
});

Deno.test('OPTIONS is answered for browsers', async () => {
  const { deps } = makeDeps();
  const res = await handle(new Request('https://fn.local', { method: 'OPTIONS' }), deps);
  assertEquals(res.status, 204);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
});

Deno.test('status reports only whether search is configured (the switch lives in the database)', async () => {
  const on = makeDeps({ creds: true });
  assertEquals(await (await handle(post({ action: 'status' }), on.deps)).json(), { search: true });
  const off = makeDeps({ creds: false });
  assertEquals(await (await handle(post({ action: 'status' }), off.deps)).json(), { search: false });
});

Deno.test('search returns only normalised tracks and caps the limit', async () => {
  const { deps, calls } = makeDeps();
  const res = await handle(post({ action: 'search', q: 'blinding lights', limit: 999 }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.enabled, true);
  assertEquals(body.tracks.length, 1); // the junk item is dropped
  assertEquals(Object.keys(body.tracks[0]).sort(), ['album', 'artists', 'durationMs', 'id', 'imageUrl', 'title']);
  const searchCall = calls.find(c => c.url.startsWith('https://api.spotify.com/v1/search'))!;
  assertEquals(new URL(searchCall.url).searchParams.get('limit'), String(MAX_SEARCH_RESULTS));
  assertEquals(new URL(searchCall.url).searchParams.get('type'), 'track');
});

Deno.test('search without credentials is "not enabled", not an error, and calls nothing', async () => {
  const { deps, calls } = makeDeps({ creds: false });
  const res = await handle(post({ action: 'search', q: 'x' }), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { enabled: false, tracks: [] });
  assertEquals(calls.length, 0);
});

Deno.test('search rejects an empty or oversized query', async () => {
  const { deps } = makeDeps();
  assertEquals((await handle(post({ action: 'search', q: '  ' }), deps)).status, 400);
  assertEquals((await handle(post({ action: 'search', q: 'x'.repeat(101) }), deps)).status, 400);
});

Deno.test('the app token is fetched once and reused', async () => {
  const { deps, calls } = makeDeps();
  await handle(post({ action: 'search', q: 'a' }), deps);
  await handle(post({ action: 'search', q: 'b' }), deps);
  assertEquals(calls.filter(c => c.url.includes('accounts.spotify.com')).length, 1);
});

Deno.test('a 401 from Spotify refreshes the token once and retries', async () => {
  let searches = 0;
  const { deps, calls } = makeDeps({
    respond: url => {
      if (url.includes('accounts.spotify.com')) return Response.json({ access_token: 't', expires_in: 3600 });
      searches++;
      return searches === 1 ? new Response('', { status: 401 }) : Response.json({ tracks: { items: [API_TRACK] } });
    },
  });
  const res = await handle(post({ action: 'search', q: 'a' }), deps);
  assertEquals(res.status, 200);
  assertEquals(calls.filter(c => c.url.includes('accounts.spotify.com')).length, 2);
});

Deno.test('Spotify being down is a 502 the app can hide, not a crash', async () => {
  const { deps } = makeDeps({
    respond: url => url.includes('accounts.spotify.com')
      ? Response.json({ access_token: 't', expires_in: 3600 })
      : new Response('', { status: 503 }),
  });
  assertEquals((await handle(post({ action: 'search', q: 'a' }), deps)).status, 502);
});

Deno.test('tracks validates every id before calling anything', async () => {
  const { deps, calls } = makeDeps();
  assertEquals((await handle(post({ action: 'tracks', ids: [ID, '../../me'] }), deps)).status, 400);
  assertEquals((await handle(post({ action: 'tracks', ids: [] }), deps)).status, 400);
  assertEquals((await handle(post({ action: 'tracks', ids: Array(21).fill(ID) }), deps)).status, 400);
  assertEquals(calls.length, 0);
});

Deno.test('tracks returns metadata keyed by id, deduplicated and cached', async () => {
  const { deps, calls } = makeDeps();
  const res = await handle(post({ action: 'tracks', ids: [ID, ID] }), deps);
  const body = await res.json();
  assertEquals(Object.keys(body.tracks), [ID]);
  assertEquals(body.tracks[ID].title, 'Blinding Lights');
  await handle(post({ action: 'tracks', ids: [ID] }), deps);
  assertEquals(calls.filter(c => c.url.startsWith('https://api.spotify.com/v1/tracks/')).length, 1);
});

Deno.test('without credentials, tracks falls back to oEmbed', async () => {
  const { deps, calls } = makeDeps({ creds: false });
  const body = await (await handle(post({ action: 'tracks', ids: [ID] }), deps)).json();
  assertEquals(body.tracks[ID], {
    id: ID, title: 'Blinding Lights', artists: [], album: null, imageUrl: 'https://i.scdn.co/o', durationMs: null,
  });
  assert(calls.every(c => c.url.startsWith('https://open.spotify.com/oembed?url=')));
});

Deno.test('a track Spotify does not know is null, not an error', async () => {
  const { deps } = makeDeps({
    respond: url => url.includes('accounts.spotify.com')
      ? Response.json({ access_token: 't', expires_in: 3600 })
      : new Response('', { status: 404 }),
  });
  const body = await (await handle(post({ action: 'tracks', ids: [ID2] }), deps)).json();
  assertEquals(body.tracks[ID2], null);
});

Deno.test('resolve parses direct links locally without fetching', async () => {
  const { deps, calls } = makeDeps();
  const body = await (await handle(post({ action: 'resolve', url: `https://open.spotify.com/track/${ID}?si=x` }), deps)).json();
  assertEquals(body, { id: ID });
  assertEquals(calls.length, 0);
});

Deno.test('resolve follows a spotify.link short link — built here, never the caller\'s URL', async () => {
  const { deps, calls } = makeDeps({
    respond: () => new Response(null, {
      status: 307,
      headers: { location: `https://open.spotify.com/track/${ID}?si=1` },
    }),
  });
  const body = await (await handle(post({ action: 'resolve', url: 'https://spotify.link/AbCd1234?evil=1' }), deps)).json();
  assertEquals(body, { id: ID });
  assertEquals(calls.map(c => c.url), ['https://spotify.link/AbCd1234']);
});

Deno.test('resolve does not guess from a page — a short link to a playlist is null', async () => {
  const { deps } = makeDeps({
    respond: () => new Response(`<a href="https://open.spotify.com/track/${ID}">first track</a>`, { status: 200 }),
  });
  const body = await (await handle(post({ action: 'resolve', url: 'https://spotify.link/PlayList1' }), deps)).json();
  assertEquals(body, { id: null });
});

Deno.test('resolve refuses to fetch any other host', async () => {
  const { deps, calls } = makeDeps();
  const body = await (await handle(post({ action: 'resolve', url: 'https://169.254.169.254/latest' }), deps)).json();
  assertEquals(body, { id: null });
  assertEquals(calls.length, 0);
});

Deno.test('unknown actions and non-POST methods are refused', async () => {
  const { deps } = makeDeps();
  assertEquals((await handle(post({ action: 'proxy', url: 'https://x' }), deps)).status, 400);
  assertEquals((await handle(new Request('https://fn.local', { method: 'GET' }), deps)).status, 405);
});

// ── Budget and back-off ─────────────────────────────────────────────────────

Deno.test('unverifiedSubject reads sub without trusting it', () => {
  assertEquals(unverifiedSubject(GOOD_JWT), 'user-1');
  assertEquals(unverifiedSubject('garbage'), null);
});

Deno.test('the budget is charged per uncached id, so a fan-out request cannot dodge it', async () => {
  const { deps } = makeDeps();
  const ids = Array.from({ length: 20 }, (_, i) => `${'A'.repeat(20)}${String(i).padStart(2, '0')}`);
  let lastStatus = 0;
  let requests = 0;
  // 120 upstream calls a minute at 20 per request → the 7th full request is refused.
  for (let batch = 0; batch < 7; batch++) {
    const fresh = ids.map(id => `${id.slice(0, 18)}${String(batch).padStart(2, '0')}${id.slice(20)}`);
    lastStatus = (await handle(post({ action: 'tracks', ids: fresh }), deps)).status;
    requests++;
    if (lastStatus === 429) break;
  }
  assertEquals(lastStatus, 429);
  assertEquals(requests, Math.floor(UPSTREAM_CALLS_PER_USER_PER_MINUTE / 20) + 1);
});

Deno.test('cached ids are free', async () => {
  const { deps } = makeDeps();
  for (let i = 0; i < 200; i++) {
    assertEquals((await handle(post({ action: 'tracks', ids: [ID] }), deps)).status, 200);
  }
});

Deno.test('over budget is refused before the auth round trip', async () => {
  const { deps, authCalls } = makeDeps();
  for (let i = 0; i < UPSTREAM_CALLS_PER_USER_PER_MINUTE; i++) {
    await handle(post({ action: 'search', q: `q${i}` }, GOOD_JWT), deps);
  }
  const before = authCalls();
  assertEquals((await handle(post({ action: 'search', q: 'one more' }, GOOD_JWT), deps)).status, 429);
  assertEquals(authCalls(), before);
});

Deno.test('a 429 from Spotify opens the breaker: no more Web API calls, cards fall back to oEmbed', async () => {
  const { deps, calls } = makeDeps({
    respond: url => {
      if (url.includes('accounts.spotify.com')) return Response.json({ access_token: 't', expires_in: 3600 });
      if (url.startsWith('https://api.spotify.com/')) {
        return new Response('', { status: 429, headers: { 'retry-after': '60' } });
      }
      return Response.json({ title: 'Blinding Lights', thumbnail_url: 'https://i.scdn.co/o' });
    },
  });
  const first = await (await handle(post({ action: 'tracks', ids: [ID] }), deps)).json();
  assertEquals(first.tracks[ID].title, 'Blinding Lights'); // served by oEmbed
  const apiCallsAfterFirst = calls.filter(c => c.url.startsWith('https://api.spotify.com/')).length;
  await handle(post({ action: 'tracks', ids: [ID2] }), deps);
  assertEquals((await handle(post({ action: 'search', q: 'x' }), deps)).status, 502);
  assertEquals(calls.filter(c => c.url.startsWith('https://api.spotify.com/')).length, apiCallsAfterFirst);
});

Deno.test('a transient failure is left out of the answer, so the app retries instead of caching it', async () => {
  const { deps } = makeDeps({
    creds: false,
    respond: () => new Response('', { status: 503 }),
  });
  const body = await (await handle(post({ action: 'tracks', ids: [ID] }), deps)).json();
  assertEquals(body, { tracks: {} });
});

Deno.test('a cold batch of 20 lookups asks for the app token once', async () => {
  const { deps, calls } = makeDeps();
  const ids = Array.from({ length: 20 }, (_, i) => `${'B'.repeat(20)}${String(i).padStart(2, '0')}`);
  await handle(post({ action: 'tracks', ids }), deps);
  assertEquals(calls.filter(c => c.url.includes('accounts.spotify.com')).length, 1);
});

// ── The shared cache (one memory for every isolate) ─────────────────────────
//
// makeDeps() resets the per-isolate state, so two makeDeps() calls sharing one cache are
// two isolates — what production has, many times over.

function memoryCache(): SharedCache & { store: Map<string, { value: string; ttlMs: number }>; commands: number } {
  const store = new Map<string, { value: string; ttlMs: number }>();
  const cache = {
    store,
    commands: 0,
    mget: (keys: string[]) => {
      cache.commands++;
      return Promise.resolve(keys.map(k => store.get(k)?.value ?? null));
    },
    mset: (entries: Array<{ key: string; value: string; ttlMs: number }>) => {
      cache.commands += entries.length;
      for (const e of entries) store.set(e.key, { value: e.value, ttlMs: e.ttlMs });
      return Promise.resolve();
    },
  };
  return cache;
}

const spotifyTrackCalls = (calls: Call[]) => calls.filter(c => c.url.startsWith('https://api.spotify.com/v1/tracks/')).length;

Deno.test('a song one isolate fetched is served to every other from the shared cache', async () => {
  const shared = memoryCache();
  const a = makeDeps();
  a.deps.shared = shared;
  await handle(post({ action: 'tracks', ids: [ID] }), a.deps);
  assertEquals(spotifyTrackCalls(a.calls), 1);

  const b = makeDeps(); // a cold isolate: its own cache is empty
  b.deps.shared = shared;
  const body = await (await handle(post({ action: 'tracks', ids: [ID] }), b.deps)).json();
  assertEquals(spotifyTrackCalls(b.calls), 0);
  assertEquals(body.tracks[ID].artists, ['The Weeknd']);
  assertEquals(shared.store.get(`${SHARED_PREFIX}track:${ID}`)?.ttlMs, CACHE_TTL_MS);
});

Deno.test('a 429 in one isolate makes every isolate back off', async () => {
  const shared = memoryCache();
  const limited = makeDeps({
    respond: url => {
      if (url.includes('accounts.spotify.com')) return Response.json({ access_token: 't', expires_in: 3600 });
      if (url.startsWith('https://api.spotify.com/')) return new Response('', { status: 429, headers: { 'retry-after': '120' } });
      return Response.json({ title: 'Blinding Lights', thumbnail_url: 'https://i.scdn.co/o' });
    },
  });
  limited.deps.shared = shared;
  await handle(post({ action: 'tracks', ids: [ID] }), limited.deps);
  const block = shared.store.get(`${SHARED_PREFIX}blocked-until`);
  assertEquals(block?.ttlMs, 120_000);

  const other = makeDeps(); // Spotify would answer this one — but it must not be asked
  other.deps.shared = shared;
  const body = await (await handle(post({ action: 'tracks', ids: [ID2] }), other.deps)).json();
  assertEquals(other.calls.filter(c => c.url.startsWith('https://api.spotify.com/')).length, 0);
  assertEquals(body.tracks[ID2].title, 'Blinding Lights'); // the oEmbed stand-in
});

Deno.test('an oEmbed stand-in in the shared cache is upgraded once the Web API is open', async () => {
  const shared = memoryCache();
  shared.store.set(`${SHARED_PREFIX}track:${ID}`, {
    value: JSON.stringify({ track: { id: ID, title: 'Blinding Lights', artists: [], album: null, imageUrl: null, durationMs: null }, full: false }),
    ttlMs: 300_000,
  });
  const { deps, calls } = makeDeps();
  deps.shared = shared;
  const body = await (await handle(post({ action: 'tracks', ids: [ID] }), deps)).json();
  assertEquals(spotifyTrackCalls(calls), 1);
  assertEquals(body.tracks[ID].artists, ['The Weeknd']);
});

Deno.test('misses go to Spotify a few at a time, never as one burst', async () => {
  const { deps } = makeDeps();
  let inFlight = 0;
  let peak = 0;
  deps.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('accounts.spotify.com')) return Response.json({ access_token: 't', expires_in: 3600 });
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise(r => setTimeout(r, 5));
    inFlight--;
    const id = url.split('/').pop()!;
    return Response.json({ ...API_TRACK, id });
  }) as typeof fetch;
  const ids = Array.from({ length: 20 }, (_, i) => `${'C'.repeat(20)}${String(i).padStart(2, '0')}`);
  const body = await (await handle(post({ action: 'tracks', ids }), deps)).json();
  assertEquals(Object.keys(body.tracks).length, 20);
  assertEquals(peak, UPSTREAM_CONCURRENCY);
});

Deno.test('a request answered entirely from this isolate costs the shared cache nothing', async () => {
  const shared = memoryCache();
  const { deps } = makeDeps();
  deps.shared = shared;
  await handle(post({ action: 'tracks', ids: [ID] }), deps);
  const after = shared.commands;
  await handle(post({ action: 'tracks', ids: [ID] }), deps);
  assertEquals(shared.commands, after);
});

Deno.test('search: the same words within the hour are answered from the shared cache', async () => {
  const shared = memoryCache();
  const a = makeDeps();
  a.deps.shared = shared;
  await handle(post({ action: 'search', q: 'Blinding  Lights' }), a.deps);
  const b = makeDeps();
  b.deps.shared = shared;
  const body = await (await handle(post({ action: 'search', q: 'blinding lights' }), b.deps)).json();
  assertEquals(b.calls.filter(c => c.url.startsWith('https://api.spotify.com/v1/search')).length, 0);
  assertEquals(body.tracks[0].id, ID);
});

Deno.test('a shared cache that answers nothing changes nothing', async () => {
  const { deps, calls } = makeDeps();
  deps.shared = { mget: keys => Promise.resolve(keys.map(() => null)), mset: () => Promise.resolve() };
  const body = await (await handle(post({ action: 'tracks', ids: [ID] }), deps)).json();
  assertEquals(body.tracks[ID].title, 'Blinding Lights');
  assertEquals(spotifyTrackCalls(calls), 1);
});

Deno.test('shared entries are input: a bad or tampered one is a miss', () => {
  const good = { id: ID, title: 'Blinding Lights', artists: ['The Weeknd'], album: null, imageUrl: 'https://i.scdn.co/x', durationMs: 1 };
  assertEquals(decodeSharedTrack(JSON.stringify({ track: good, full: true }), ID), { track: good, full: true });
  assertEquals(decodeSharedTrack(JSON.stringify({ track: null, full: true }), ID), { track: null, full: true });
  assertEquals(decodeSharedTrack(JSON.stringify({ track: good, full: true }), ID2), null); // another song's entry
  assertEquals(decodeSharedTrack(JSON.stringify({ track: { ...good, imageUrl: 'javascript:x' }, full: true }), ID), null);
  assertEquals(decodeSharedTrack(JSON.stringify({ track: good }), ID), null);
  assertEquals(decodeSharedTrack('not json', ID), null);
  assertEquals(decodeSharedTrack(null, ID), null);
  // Only the enumerated shape ever leaves the function, whatever the entry carried.
  assertEquals(Object.keys(decodeSharedSearch(JSON.stringify([{ ...good, raw: 'spotify response' }]))![0]).sort(),
    ['album', 'artists', 'durationMs', 'id', 'imageUrl', 'title']);
  assertEquals(decodeSharedSearch(JSON.stringify(Array(11).fill(good))), null);
});

Deno.test('mapLimit keeps order', async () => {
  assertEquals(await mapLimit([3, 1, 2], 2, async n => { await new Promise(r => setTimeout(r, n)); return n * 10; }), [30, 10, 20]);
  assertEquals(await mapLimit([], 4, async (n: number) => n), []);
});

Deno.test('upstashCache: one MGET to read, one pipeline of SET … PX to write', async () => {
  const seen: Array<{ url: string; body: unknown; auth: string | null; hasSignal: boolean; redirect?: RequestRedirect }> = [];
  const fake = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    seen.push({
      url,
      body: JSON.parse(String(init?.body)),
      auth: new Headers(init?.headers).get('Authorization'),
      hasSignal: init?.signal instanceof AbortSignal,
      redirect: init?.redirect,
    });
    return Promise.resolve(url.endsWith('/pipeline') ? Response.json([{ result: 'OK' }]) : Response.json({ result: ['a', null] }));
  }) as typeof fetch;
  const cache = upstashCache('https://eu1-x.upstash.io/', 'tok', fake);
  assertEquals(await cache.mget(['k1', 'k2']), ['a', null]);
  await cache.mset([{ key: 'k1', value: 'v', ttlMs: 3_600_000 }, { key: 'k2', value: 'v', ttlMs: 10 }]);
  assertEquals(seen[0], { url: 'https://eu1-x.upstash.io', body: ['MGET', 'k1', 'k2'], auth: 'Bearer tok', hasSignal: true, redirect: 'error' });
  // An entry about to expire is not worth a command.
  assertEquals(seen[1].url, 'https://eu1-x.upstash.io/pipeline');
  assertEquals(seen[1].body, [['SET', 'k1', 'v', 'PX', '3600000']]);
});

Deno.test('upstashCache never throws: a failure reads as all-missing and a write is dropped', async () => {
  const down = (() => Promise.reject(new Error('timeout'))) as typeof fetch;
  const cache = upstashCache('https://x.upstash.io', 'tok', down);
  assertEquals(await cache.mget(['a', 'b']), [null, null]);
  await cache.mset([{ key: 'a', value: 'v', ttlMs: 60_000 }]);
  const errorStatus = (() => Promise.resolve(new Response('', { status: 401 }))) as typeof fetch;
  assertEquals(await upstashCache('https://x.upstash.io', 'bad', errorStatus).mget(['a']), [null]);
});

// ── Hardening from the security review ──────────────────────────────────────

Deno.test('a shared back-off far in the future is capped: nobody is stopped for long', async () => {
  const shared = memoryCache();
  shared.store.set(`${SHARED_PREFIX}blocked-until`, { value: String(9e15), ttlMs: 60_000 });
  const { deps, calls, setNow } = makeDeps();
  deps.shared = shared;
  await handle(post({ action: 'tracks', ids: [ID] }), deps); // backs off: oEmbed only
  assertEquals(calls.filter(c => c.url.startsWith('https://api.spotify.com/')).length, 0);
  shared.store.clear();
  setNow(1_000_000 + MAX_BACKOFF_MS + 1);
  await handle(post({ action: 'tracks', ids: [ID2] }), deps);
  assert(calls.some(c => c.url.startsWith('https://api.spotify.com/v1/tracks/')));
});

Deno.test('artwork in a shared entry must come from Spotify\'s own image hosts', () => {
  assert(isSpotifyImageUrl('https://i.scdn.co/image/ab67616d0000b273'));
  assert(isSpotifyImageUrl('https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e02'));
  assert(!isSpotifyImageUrl('https://evil.example/i.scdn.co.png'));
  assert(!isSpotifyImageUrl('https://scdn.co.evil.example/x'));
  assert(!isSpotifyImageUrl('http://i.scdn.co/x'));
  const bad = { id: ID, title: 'x', artists: [], album: null, imageUrl: 'https://tracker.example/x.png', durationMs: null };
  assertEquals(decodeSharedTrack(JSON.stringify({ track: bad, full: true }), ID), null);
  const long = { ...bad, imageUrl: null, title: 'x'.repeat(301) };
  assertEquals(decodeSharedTrack(JSON.stringify({ track: long, full: true }), ID), null);
});

Deno.test('the search key never holds the words typed, and folds them like the query sent', async () => {
  const key = await searchKey(normalizeQuery('  Blinding\u00a0LIGHTS '), 10, 'secret');
  assert(!key.toLowerCase().includes('blinding'));
  assertEquals(key, await searchKey('blinding lights', 10, 'secret'));
  assert(key !== await searchKey('blinding lights', 5, 'secret'));
  assert(key !== await searchKey('blinding lights', 10, 'another secret'));
  const { deps, calls } = makeDeps();
  await handle(post({ action: 'search', q: 'Blinding\u00a0LIGHTS' }), deps);
  const sent = new URL(calls.find(c => c.url.startsWith('https://api.spotify.com/v1/search'))!.url);
  assertEquals(sent.searchParams.get('q'), 'blinding lights'); // the same text the key was made from
});

Deno.test('cached search answers still cost the caller something, so a loop cannot run forever', async () => {
  const { deps } = makeDeps();
  deps.shared = memoryCache();
  await handle(post({ action: 'search', q: 'same words' }, GOOD_JWT), deps);
  let refused = 0;
  const tries = Math.ceil(UPSTREAM_CALLS_PER_USER_PER_MINUTE / CACHED_SEARCH_COST) + 5;
  for (let i = 0; i < tries; i++) {
    if ((await handle(post({ action: 'search', q: 'same words' }, GOOD_JWT), deps)).status === 429) refused++;
  }
  assert(refused > 0);
});

Deno.test('an empty search answer is shared only briefly', async () => {
  const shared = memoryCache();
  const { deps } = makeDeps({
    respond: url => url.includes('accounts.spotify.com')
      ? Response.json({ access_token: 't', expires_in: 3600 })
      : Response.json({ tracks: { items: [] } }),
  });
  deps.shared = shared;
  await handle(post({ action: 'search', q: 'asdfqwer' }), deps);
  const entry = [...shared.store.entries()].find(([k]) => k.includes(':search:'))!;
  assertEquals(entry[1].ttlMs, EMPTY_SEARCH_TTL_MS);
});

Deno.test('on the edge runtime the answer goes out first and the cache write finishes after', async () => {
  const handed: Promise<unknown>[] = [];
  (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { handed.push(p); } };
  try {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const { deps } = makeDeps();
    deps.shared = { mget: keys => Promise.resolve(keys.map(() => null)), mset: () => gate };
    const res = await handle(post({ action: 'tracks', ids: [ID] }), deps); // the write has NOT finished
    assertEquals((await res.json()).tracks[ID].title, 'Blinding Lights');
    assertEquals(handed.length, 1);
    release();
    await handed[0];
  } finally {
    delete (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime;
  }
});
