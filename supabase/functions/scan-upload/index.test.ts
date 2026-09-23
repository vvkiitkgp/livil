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
  isOwnPublicMedia,
  normalizeAudd,
  publicShape,
  rowFor,
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
