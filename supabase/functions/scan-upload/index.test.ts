// Unit tests for the pure logic in scan-upload. Run: `deno test` in this directory.
//
// SCOPE: the normalisation and row-shaping — the parts where a wrong change fails
// SILENTLY and in the dangerous direction. Nothing here needs a network or a database.
//
// The property under test throughout is the one the migration header calls load-bearing:
// a scan that did not run must never be representable as a scan that found nothing.

import { assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import {
  createAuddProvider,
  type Deps,
  FULL_SONG_CHUNK_LIMIT,
  handle,
  isOwnPublicMedia,
  normalizeAudd,
  publicShape,
  rowFor,
  type ScanOptions,
  type ScanOutcome,
} from './app.ts';

const TRACK = '11111111-2222-3333-4444-555555555555';
const URL_ = 'https://p.supabase.co/storage/v1/object/public/tracks-media/u1/t1/audio.mp3';

// ── normalizeAudd ───────────────────────────────────────────────────────────

Deno.test('a successful call with no result is a real negative', () => {
  assertEquals(normalizeAudd({ status: 'success', result: null }), {
    status: 'complete',
    matchFound: false,
  });
});

Deno.test('a provider error is NOT a negative', () => {
  const out = normalizeAudd({
    status: 'error',
    error: { error_code: 901, error_message: 'no api_token passed' },
  });
  assertEquals(out.status, 'failed');
  // The regression this guards: an outage silently clearing every upload made during it.
  assertNotEquals(out.status, 'complete');
});

Deno.test('a match carries title, artist and isrc', () => {
  const out = normalizeAudd({
    status: 'success',
    result: {
      artist: 'Arijit Singh',
      title: 'Kesariya',
      album: 'Brahmastra',
      apple_music: { isrc: 'INS182200001' },
    },
  });
  assertEquals(out, {
    status: 'complete',
    matchFound: true,
    // AudD returns no score; recording null beats inventing one.
    confidence: null,
    title: 'Kesariya',
    artist: 'Arijit Singh',
    isrc: 'INS182200001',
    raw: {
      artist: 'Arijit Singh',
      title: 'Kesariya',
      album: 'Brahmastra',
      apple_music: { isrc: 'INS182200001' },
    },
  });
});

Deno.test('isrc falls back to spotify when apple music has none', () => {
  const out = normalizeAudd({
    status: 'success',
    result: { title: 'x', artist: 'y', spotify: { external_ids: { isrc: 'GBAYE0000123' } } },
  });
  assertEquals(out.status === 'complete' && out.matchFound && out.isrc, 'GBAYE0000123');
});

Deno.test('enterprise segment shape is unwrapped to the first song', () => {
  const out = normalizeAudd({
    status: 'success',
    result: [{ songs: [] }, { songs: [{ title: 'Kesariya', artist: 'Arijit Singh' }] }],
  });
  assertEquals(out.status === 'complete' && out.matchFound && out.title, 'Kesariya');
});

Deno.test('an empty result object is a negative, not a match with null fields', () => {
  assertEquals(normalizeAudd({ status: 'success', result: {} }), {
    status: 'complete',
    matchFound: false,
  });
});

// ── rowFor ──────────────────────────────────────────────────────────────────

Deno.test('a failed scan writes a null verdict, never false', () => {
  const row = rowFor(TRACK, 'audd', URL_, { status: 'failed', reason: 'HTTP 502' });
  assertEquals(row.status, 'failed');
  assertEquals(row.match_found, null);
});

Deno.test('a skipped scan writes a null verdict and keeps the reason', () => {
  const row = rowFor(TRACK, 'audd', URL_, { status: 'skipped', reason: 'video not enabled' });
  assertEquals(row.status, 'skipped');
  assertEquals(row.match_found, null);
  assertEquals((row.matched_metadata as { reason: string }).reason, 'video not enabled');
});

Deno.test('a clean scan writes complete + false, which the check constraint requires', () => {
  const row = rowFor(TRACK, 'audd', URL_, { status: 'complete', matchFound: false });
  assertEquals(row.status, 'complete');
  assertEquals(row.match_found, false);
});

// ── the provider ────────────────────────────────────────────────────────────

Deno.test('video is skipped, not silently cleared, when enterprise is off', async () => {
  const p = createAuddProvider('tok', {
    enterpriseEnabled: false,
    fetchImpl: () => {
      throw new Error('must not call the provider');
    },
  });
  const out = await p.scan('https://example.test/a.mp4', 'video');
  assertEquals(out.status, 'skipped');
});

Deno.test('audio is sent to the standard endpoint with the url, never the bytes', async () => {
  let seenUrl = '';
  let seenBody = '';
  const p = createAuddProvider('tok', {
    fetchImpl: (input, init) => {
      seenUrl = String(input);
      seenBody = String(init?.body ?? '');
      return Promise.resolve(
        new Response(JSON.stringify({ status: 'success', result: null }), { status: 200 }),
      );
    },
  });
  const out = await p.scan('https://example.test/a.mp3', 'audio');
  assertEquals(seenUrl, 'https://api.audd.io/');
  assertEquals(seenBody.includes('url=https%3A%2F%2Fexample.test%2Fa.mp3'), true);
  assertEquals(out, { status: 'complete', matchFound: false });
});

Deno.test('a non-200 from the provider is failed, not a negative', async () => {
  const p = createAuddProvider('tok', {
    fetchImpl: () => Promise.resolve(new Response('nope', { status: 502 })),
  });
  assertEquals((await p.scan('https://example.test/a.mp3', 'audio')).status, 'failed');
});

Deno.test('a network throw is failed, not a negative', async () => {
  const p = createAuddProvider('tok', {
    fetchImpl: () => Promise.reject(new Error('ECONNRESET')),
  });
  assertEquals((await p.scan('https://example.test/a.mp3', 'audio')).status, 'failed');
});

// ── whole-song audio ────────────────────────────────────────────────────────

/** Records what the provider was sent; answers "no match". */
function recordingFetch() {
  const seen = { url: '', body: new URLSearchParams(), signal: null as AbortSignal | null };
  const fetchImpl: typeof fetch = (input, init) => {
    seen.url = String(input);
    seen.body = new URLSearchParams(String(init?.body ?? ''));
    seen.signal = init?.signal ?? null;
    return Promise.resolve(
      new Response(JSON.stringify({ status: 'success', result: [] }), { status: 200 }),
    );
  };
  return { seen, fetchImpl };
}

Deno.test('a whole-song request checks every chunk on the enterprise endpoint', async () => {
  const { seen, fetchImpl } = recordingFetch();
  const p = createAuddProvider('tok', { fullSongEnabled: true, fetchImpl });
  const out = await p.scan('https://example.test/a.wav', 'audio', { fullSong: true });
  assertEquals(seen.url, 'https://enterprise.audd.io/');
  assertEquals(seen.body.get('url'), 'https://example.test/a.wav');
  // Every 12-second chunk, none skipped — the whole point of the request.
  assertEquals(seen.body.get('skip'), '0');
  assertEquals(seen.body.get('every'), '1');
  // The spend ceiling travels with the request; the provider stops there.
  assertEquals(seen.body.get('limit'), String(FULL_SONG_CHUNK_LIMIT));
  // Bounded, so a slow provider becomes a recorded `failed`, not a client-side timeout.
  assertEquals(seen.signal instanceof AbortSignal, true);
  // An empty segment list is a real negative.
  assertEquals(out, { status: 'complete', matchFound: false });
});

Deno.test('a whole-song request with the switch off gets the quick check', async () => {
  const { seen, fetchImpl } = recordingFetch();
  const p = createAuddProvider('tok', { fullSongEnabled: false, fetchImpl });
  await p.scan('https://example.test/a.mp3', 'audio', { fullSong: true });
  assertEquals(seen.url, 'https://api.audd.io/');
  assertEquals(seen.body.get('skip'), null);
});

Deno.test('a client that does not ask gets the quick check even with the switch on', async () => {
  // The app already in the stores: it never sends `fullSong`, and gives up after 20 s.
  const { seen, fetchImpl } = recordingFetch();
  const p = createAuddProvider('tok', { fullSongEnabled: true, fetchImpl });
  await p.scan('https://example.test/a.mp3', 'audio');
  assertEquals(seen.url, 'https://api.audd.io/');
});

Deno.test('a whole-song request checks every chunk of a video too', async () => {
  const { seen, fetchImpl } = recordingFetch();
  const p = createAuddProvider('tok', { fullSongEnabled: true, enterpriseEnabled: false, fetchImpl });
  const out = await p.scan('https://example.test/a.mov', 'video', { fullSong: true });
  // The video's own URL: the provider pulls the sound out on its servers.
  assertEquals(seen.url, 'https://enterprise.audd.io/');
  assertEquals(seen.body.get('url'), 'https://example.test/a.mov');
  assertEquals(seen.body.get('skip'), '0');
  assertEquals(seen.body.get('every'), '1');
  assertEquals(seen.body.get('limit'), String(FULL_SONG_CHUNK_LIMIT));
  assertEquals(out, { status: 'complete', matchFound: false });
});

Deno.test('a video nobody asked about stays skipped, even with the switch on', async () => {
  // The app already in the stores never asks, and gives up after 20 s: its videos keep
  // today's behaviour rather than a slow check it cannot wait for.
  const p = createAuddProvider('tok', {
    fullSongEnabled: true,
    enterpriseEnabled: false,
    fetchImpl: () => {
      throw new Error('must not call the provider');
    },
  });
  assertEquals((await p.scan('https://example.test/a.mp4', 'video')).status, 'skipped');
});

Deno.test('a whole-song video request with the switch off stays skipped', async () => {
  const p = createAuddProvider('tok', {
    fullSongEnabled: false,
    enterpriseEnabled: false,
    fetchImpl: () => {
      throw new Error('must not call the provider');
    },
  });
  assertEquals((await p.scan('https://example.test/a.mp4', 'video', { fullSong: true })).status, 'skipped');
});

Deno.test('a whole-song request that runs out of time is failed, not a negative', async () => {
  const p = createAuddProvider('tok', {
    fullSongEnabled: true,
    fetchImpl: () => Promise.reject(new DOMException('signal timed out', 'TimeoutError')),
  });
  const out = await p.scan('https://example.test/a.wav', 'audio', { fullSong: true });
  assertEquals(out.status, 'failed');
  assertEquals(out.status === 'failed' && out.reason.includes('longer than'), true);
});

Deno.test('an enterprise match reads the isrc and score off the song itself', () => {
  const out = normalizeAudd({
    status: 'success',
    result: [
      { songs: [] },
      { songs: [{ title: 'Kesariya', artist: 'Arijit Singh', isrc: 'INS182200001', score: 97 }] },
    ],
  });
  assertEquals(out.status === 'complete' && out.matchFound && out.isrc, 'INS182200001');
  // 0–100 from the provider, 0–1 in the column (its check constraint).
  assertEquals(out.status === 'complete' && out.matchFound && out.confidence, 0.97);
});

Deno.test('a score outside 0–100 is recorded as no score, not clamped', () => {
  const out = normalizeAudd({
    status: 'success',
    result: [{ songs: [{ title: 'x', artist: 'y', score: 140 }] }],
  });
  assertEquals(out.status === 'complete' && out.matchFound && out.confidence, null);
});

// ── the handler passes the request on ───────────────────────────────────────

const OWNER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SUPA = 'https://p.supabase.co';

/** Just enough of the two clients for `handle` to reach the provider and record. */
function handlerDeps(seenOpts: Array<ScanOptions | undefined>): Deps {
  const track = {
    id: TRACK,
    uploader_id: OWNER,
    media_kind: 'audio',
    audio_url: `${SUPA}/storage/v1/object/public/tracks-media/${OWNER}/${TRACK}/audio.wav`,
    video_url: null,
  };
  const userClient = {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: OWNER } }, error: null }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: track, error: null }) }) }),
    }),
  };
  const adminClient = {
    from: () => ({
      select: () => ({ eq: () => ({ gte: () => Promise.resolve({ count: 0, error: null }) }) }),
      upsert: () => Promise.resolve({ error: null }),
    }),
  };
  return {
    supabaseUrl: SUPA,
    userClient: () => userClient as unknown as ReturnType<Deps['userClient']>,
    adminClient: () => adminClient as unknown as ReturnType<Deps['adminClient']>,
    provider: {
      name: 'fake',
      scan: (_url, _kind, opts) => {
        seenOpts.push(opts);
        return Promise.resolve({ status: 'complete', matchFound: false });
      },
    },
  };
}

function post(body: unknown): Request {
  return new Request('https://fn.test/scan-upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

Deno.test('the handler asks for the whole song only when the client says exactly true', async () => {
  const seen: Array<ScanOptions | undefined> = [];
  const deps = handlerDeps(seen);
  assertEquals((await handle(post({ trackId: TRACK, fullSong: true }), deps)).status, 200);
  // Today's apps send only the id.
  assertEquals((await handle(post({ trackId: TRACK }), deps)).status, 200);
  // Not a boolean: treated as not asked.
  assertEquals((await handle(post({ trackId: TRACK, fullSong: 'yes' }), deps)).status, 200);
  assertEquals(seen.map(o => o?.fullSong), [true, false, false]);
});

// ── publicShape ─────────────────────────────────────────────────────────────

Deno.test('the client is never handed the raw provider payload', () => {
  const o: ScanOutcome = {
    status: 'complete',
    matchFound: true,
    confidence: null,
    title: 't',
    artist: 'a',
    isrc: 'i',
    raw: { secret: 'vendor internals' },
  };
  assertEquals(JSON.stringify(publicShape(o)).includes('vendor internals'), false);
});

Deno.test('failed and skipped both report a null verdict to the client', () => {
  assertEquals(publicShape({ status: 'failed', reason: 'x' }).matchFound, null);
  assertEquals(publicShape({ status: 'skipped', reason: 'x' }).matchFound, null);
});

// ── the origin check ────────────────────────────────────────────────────────
//
// The security review that killed the first draft found that the uploader chooses WHAT
// gets scanned. The database now freezes a track's media; this is the second line, and
// it is also what stops the provider being pointed at arbitrary URLs on Livil's bill.

Deno.test('a real object in the uploader own folder is accepted', () => {
  assertEquals(isOwnPublicMedia(URL_, 'https://p.supabase.co', 'u1'), true);
});

Deno.test('a trailing slash on the project url does not break the check', () => {
  assertEquals(isOwnPublicMedia(URL_, 'https://p.supabase.co/', 'u1'), true);
});

Deno.test('another user folder is refused', () => {
  assertEquals(isOwnPublicMedia(URL_, 'https://p.supabase.co', 'u2'), false);
});

Deno.test('an arbitrary external url is refused', () => {
  assertEquals(
    isOwnPublicMedia('https://evil.test/huge.wav', 'https://p.supabase.co', 'u1'),
    false,
  );
});

Deno.test('a lookalike host is refused', () => {
  assertEquals(
    isOwnPublicMedia(
      'https://p.supabase.co.evil.test/storage/v1/object/public/tracks-media/u1/t/a.mp3',
      'https://p.supabase.co',
      'u1',
    ),
    false,
  );
});

Deno.test('another bucket is refused', () => {
  assertEquals(
    isOwnPublicMedia(
      'https://p.supabase.co/storage/v1/object/public/avatars/u1/a.mp3',
      'https://p.supabase.co',
      'u1',
    ),
    false,
  );
});

Deno.test('a user-id prefix collision is refused', () => {
  // 'u1' must not match a folder named 'u12'. The trailing slash in the prefix is what
  // makes this hold; without it the check would be a prefix match on the id itself.
  assertEquals(
    isOwnPublicMedia(
      'https://p.supabase.co/storage/v1/object/public/tracks-media/u12/t/a.mp3',
      'https://p.supabase.co',
      'u1',
    ),
    false,
  );
});

Deno.test('every column is written on every branch, so an upsert cannot retain stale metadata', () => {
  const failed = rowFor(TRACK, 'audd', URL_, { status: 'failed', reason: 'x' });
  // The regression: a re-scan that fails after a match leaving matched_title behind.
  assertEquals(failed.matched_title, null);
  assertEquals(failed.matched_artist, null);
  assertEquals(failed.matched_isrc, null);
  assertEquals(failed.confidence, null);
  assertEquals(failed.scanned_media_url, URL_);
});

// ── The quota must not depend on a foreign key ──────────────────────────────
//
// A source-level contract test, deliberately, because the failure it guards is not
// reachable from the pure functions above and not visible without a live PostgREST.
//
// What happened: the quota counted scans with `tracks!inner(uploader_id)`. PostgREST
// resolves an embed from foreign-key METADATA, so when the FK was dropped — on purpose,
// so a rights declaration outlives its track — the embed stopped resolving with PGRST200
// and every scan returned 503. Because the scan is fail-safe by design, nothing failed
// loudly: uploads simply published with no copyright check at all, in production, for
// hours, and the only visible sign was a red row in the browser's network tab.
//
// The lesson is narrow and worth pinning: this table has no foreign keys and must never
// be queried as though it does.
Deno.test('the scan quota is counted without a relational embed', async () => {
  const src = await Deno.readTextFile(new URL('./app.ts', import.meta.url));
  // Comment lines are stripped first. The explanation above this very block names the
  // broken form in prose, and a test that cannot tell code from a comment about code
  // would fail on its own documentation.
  const quota = src
    .slice(src.indexOf('4. QUOTA'), src.indexOf('could not check the scan quota'))
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n');

  assertEquals(
    quota.includes('!inner'),
    false,
    'the quota query uses a PostgREST embed; track_copyright_scans has no foreign keys, '
      + 'so the embed cannot resolve and every scan will 503 into a silent free pass',
  );
  assertEquals(
    quota.includes('track_uploader_id'),
    true,
    'the quota must count on the scan row own track_uploader_id snapshot',
  );
});
