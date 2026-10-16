// ============================================================================
// scan-upload — logic module. Ask a recognition provider whether an upload
// matches a known commercial recording.
// ============================================================================
//
// `index.ts` imports `handler` from here and calls Deno.serve on it. Logic lives in a
// separate module (not gated on import.meta.main, which the edge runtime may not set)
// so the deployed function ALWAYS serves while `index.test.ts` imports the pure helpers
// without binding a port. Same shape as send-push.
//
// ── WHY THIS IS SERVER-SIDE AND NOT IN THE APP ──────────────────────────────
//
// The provider credential. Both Livil clients ship to users -- the Play Store bundle
// and the Vercel web bundle are both readable by anyone who wants them -- so a key
// placed in either is a published key. This function exists because there is nowhere
// else in the stack a secret can live (ADR-0004: no API tier).
//
// It is deliberately THIN. It receives a track id, hands the provider a URL, and stores
// what came back. All the expensive work happens on the provider's infrastructure,
// which is why the edge runtime's CPU ceiling -- the limit that ruled out server-side
// waveform decoding in ADR-0003 -- does not bite here.
//
// ── WHY A URL AND NOT THE BYTES ─────────────────────────────────────────────
//
// Livil's media already sits at public object URLs, so the provider fetches it
// directly. This matters most for VIDEO. Livil has a hard rule against decoding video
// on the device, because pulling a whole file into phone memory gets the process killed
// by the OS with no JavaScript error (ADR-0003). THAT RULE IS ABOUT THE PHONE. A
// provider downloading a URL on its own servers shares none of that failure mode, and
// nothing here ever holds media bytes.
//
// Converting video to audio ourselves is not an option in any case: on-device is the
// OOM kill above, and the edge runtime has neither the CPU budget nor any media
// tooling. Handing over a URL is not merely the best route, it is the only one.
//
// ── WHAT A MATCH MEANS ──────────────────────────────────────────────────────
//
// It means the audio resembles a registered recording. It does NOT mean the uploader
// lacks the right to post it, and no provider on the market can answer that question --
// authorisation is a contract between an artist and a rights holder and is in nobody's
// database. A match is a reason to ask the uploader a question. The answer is stored
// alongside it and is the half with evidential value.
//
// Covers do not match, by design: fingerprinting identifies a specific master
// recording, and a cover is a different recording. Livil supports covers as
// first-class uploads, so this is the desired behaviour, not a gap.
//
// SECRETS (custom): AUDD_API_TOKEN, and optionally AUDD_ENTERPRISE_ENABLED (video) and
// AUDD_FULL_SONG_ENABLED (whole-song audio, for clients that ask for it).
// Platform-injected: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// ============================================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── The provider-agnostic seam ──────────────────────────────────────────────
//
// One interface, one implementation today. The interface exists because the vendor
// landscape is genuinely unsettled: the two vendors that return rights metadata are
// sales-gated with no published pricing, and the two that are self-serve return
// identification only. Swapping should cost a file, not a schema change -- which is why
// `matched_metadata` is opaque jsonb and `provider` is free text rather than an enum.

/** What every provider is normalised down to before it touches the database. */
export type ScanOutcome =
  | { status: 'complete'; matchFound: false }
  | {
      status: 'complete';
      matchFound: true;
      confidence: number | null;
      title: string | null;
      artist: string | null;
      isrc: string | null;
      raw: unknown;
    }
  | { status: 'failed'; reason: string }
  /** We did not ask. Never conflate with "we asked and found nothing". */
  | { status: 'skipped'; reason: string };

export type MediaKind = 'audio' | 'video';

export type ScanOptions = {
  /**
   * The client asked for the whole song rather than the provider's quick check. A REQUEST,
   * not a setting: only clients that know how long a whole-song answer takes send it, so
   * an app already in the stores (which gives up after 20 s) keeps the quick check.
   */
  fullSong?: boolean;
};

export interface CopyrightDetectionProvider {
  readonly name: string;
  scan(mediaUrl: string, kind: MediaKind, opts?: ScanOptions): Promise<ScanOutcome>;
}

// ── AudD ────────────────────────────────────────────────────────────────────
//
// Chosen first for one reason that matters to a small team: it is the only vendor on
// the shortlist whose pricing is published and whose signup is self-serve, so the cost
// of finding out whether this works at all is a free tier rather than a sales call.
//
// Its standard endpoint caps at 10 MB, which an audio file clears and a video will not.
// Long files belong on the enterprise endpoint, which chunks server-side. Whether that
// endpoint accepts a video container and extracts the audio itself is NOT CONFIRMED by
// the public documentation -- their docs list "short-form videos" among supported
// content but never say it outright. Until that is confirmed with the vendor, video
// returns `skipped`, with the reason recorded. It must never return a clean `complete`
// on a request we did not actually make.

const AUDD_STANDARD = 'https://api.audd.io/';
const AUDD_ENTERPRISE = 'https://enterprise.audd.io/';

// ── Whole-song audio ──
//
// The standard endpoint identifies ONE short excerpt and refuses long or large files (a
// 10 MB WAV came back "audio is too large ... use the enterprise endpoint"), so a song
// whose commercial recording starts after its intro, or that is simply a big file, was
// never really checked. The enterprise endpoint walks the file in 12-second chunks on the
// provider's servers; `skip=0` + `every=1` asks for every chunk, so a 2-minute song is 10
// chunks and 10 billed requests.
//
// Two gates, both required: the client asks (`fullSong`, see ScanOptions) and the switch
// is on (`AUDD_FULL_SONG_ENABLED`). The switch is the spend lever — unset, every scan is
// the quick one again, with no app release.

/** Spend ceiling per scan: 100 chunks is 20 minutes of audio, $0.20 at $2 / 1,000. */
export const FULL_SONG_CHUNK_LIMIT = 100;

/**
 * How long we wait for a whole-song answer before recording `failed`. Under the 60 s an
 * iPhone waits for a silent HTTP response, so the app always hears the verdict this
 * function records instead of timing out first. The provider's own example — an hour-long
 * mix, 63 chunks — took 38 s; a 4-minute song is 20.
 */
export const FULL_SONG_PROVIDER_TIMEOUT_MS = 50_000;

export function createAuddProvider(
  token: string,
  opts: { enterpriseEnabled?: boolean; fullSongEnabled?: boolean; fetchImpl?: typeof fetch } = {},
): CopyrightDetectionProvider {
  const doFetch = opts.fetchImpl ?? fetch;

  return {
    name: 'audd',
    async scan(mediaUrl, kind, scanOpts = {}) {
      if (kind === 'video' && !opts.enterpriseEnabled) {
        return {
          status: 'skipped',
          reason:
            'video scanning is not enabled: the enterprise endpoint accepts long files, '
            + 'but its handling of video containers is unconfirmed with the vendor',
        };
      }

      const fullSong = kind === 'audio' && scanOpts.fullSong === true && opts.fullSongEnabled === true;
      if (fullSong) {
        // The enterprise response carries `isrc` on each song itself (no `return` param).
        return send(
          AUDD_ENTERPRISE,
          new URLSearchParams({
            api_token: token,
            url: mediaUrl,
            skip: '0',
            every: '1',
            limit: String(FULL_SONG_CHUNK_LIMIT),
          }),
          FULL_SONG_PROVIDER_TIMEOUT_MS,
        );
      }

      const endpoint = kind === 'video' ? AUDD_ENTERPRISE : AUDD_STANDARD;
      const body = new URLSearchParams({
        api_token: token,
        url: mediaUrl,
        // ISRC and label come from the linked music services rather than the base
        // response. The ISRC is the one identifier worth having: it names the exact
        // recording, which is what a rights holder will ask about.
        return: 'apple_music,spotify',
      });
      if (kind === 'video') {
        // Sample rather than traverse. Billing on the enterprise endpoint is per 12
        // seconds of audio, so scanning a four-minute video end to end costs ~20
        // requests to answer a question three samples answer.
        body.set('every', '3');
      }

      return send(endpoint, body);
    },
  };

  async function send(endpoint: string, body: URLSearchParams, timeoutMs?: number): Promise<ScanOutcome> {
    let res: Response;
    try {
      res = await doFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'TimeoutError') {
        return { status: 'failed', reason: `provider took longer than ${timeoutMs! / 1000} s` };
      }
      return { status: 'failed', reason: `network error: ${errText(e)}` };
    }

    if (!res.ok) {
      return { status: 'failed', reason: `provider returned HTTP ${res.status}` };
    }

    let payload: AuddResponse;
    try {
      payload = (await res.json()) as AuddResponse;
    } catch (e) {
      return { status: 'failed', reason: `unparseable provider response: ${errText(e)}` };
    }

    return normalizeAudd(payload);
  }
}

type AuddResult = {
  artist?: string | null;
  title?: string | null;
  album?: string | null;
  label?: string | null;
  release_date?: string | null;
  song_link?: string | null;
  /** Enterprise only: how sure it is, 0–100. */
  score?: number | null;
  /** Enterprise only, on the song itself (standard puts it under the linked services). */
  isrc?: string | null;
  apple_music?: { isrc?: string | null } | null;
  spotify?: { external_ids?: { isrc?: string | null } | null } | null;
};

type AuddResponse = {
  status?: string;
  error?: { error_code?: number; error_message?: string } | null;
  // Absent or null means "no match" on a successful call. The enterprise endpoint
  // returns an array of per-segment results instead of a single object.
  result?: AuddResult | Array<{ songs?: AuddResult[] }> | null;
};

/**
 * AudD → ScanOutcome.
 *
 * Exported for tests. The mapping that matters is the bottom one: a successful call
 * with no result is `matchFound: false`, while anything that went wrong is `failed`.
 * Those must not collapse -- a provider outage that reported "no match" would silently
 * clear every upload made during it.
 */
export function normalizeAudd(payload: AuddResponse): ScanOutcome {
  if (payload.status !== 'success') {
    const msg = payload.error?.error_message ?? 'provider reported an error';
    return { status: 'failed', reason: msg.slice(0, 300) };
  }

  const first = firstResult(payload.result);
  if (!first) {
    return { status: 'complete', matchFound: false };
  }

  return {
    status: 'complete',
    matchFound: true,
    // The standard endpoint returns no score, so there it stays null: inventing 1.0 would
    // put a number in front of an operator that nothing produced. The enterprise one
    // scores 0–100; the column holds 0–1.
    confidence: scoreToConfidence(first.score),
    title: first.title ?? null,
    artist: first.artist ?? null,
    isrc: first.isrc ?? first.apple_music?.isrc ?? first.spotify?.external_ids?.isrc ?? null,
    raw: first,
  };
}

/** Standard endpoint returns one object; enterprise returns segments of songs. */
function firstResult(result: AuddResponse['result']): AuddResult | null {
  if (!result) return null;
  if (Array.isArray(result)) {
    for (const segment of result) {
      const song = segment?.songs?.[0];
      if (song) return song;
    }
    return null;
  }
  return result.title || result.artist ? result : null;
}

function scoreToConfidence(score: unknown): number | null {
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) return null;
  return score / 100;
}

function errText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e ?? '')).slice(0, 200);
}

// ── The handler ─────────────────────────────────────────────────────────────

/**
 * Is this URL a public object in THIS uploader's own folder of the media bucket?
 *
 * Untrusted input meets a third party here (Constitution P19). `tracks.audio_url` is
 * plain text, and although section 0 of the migration now freezes it, defence in depth
 * is cheap and this boundary is the one that decides what somebody else's servers fetch
 * on our account. Without it an uploader could point the provider at any URL on the
 * internet and have it fetched, repeatedly, billed to Livil.
 *
 * Pinning to `{uploaderId}/` also bounds the file to the bucket's own size ceiling.
 */
export function isOwnPublicMedia(url: string, supabaseUrl: string, uploaderId: string): boolean {
  const prefix = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/tracks-media/${uploaderId}/`;
  return url.startsWith(prefix);
}

/**
 * How many scans one account may run per day.
 *
 * There is no per-user upload quota anywhere in Livil and no rate limit in front of this
 * function, so before this cap the only bound on provider spend was the provider's own
 * plan. This is the first Livil surface where an unbounded request costs MONEY rather
 * than rows, which is why a cap ships with it rather than after it.
 */
export const SCANS_PER_USER_PER_DAY = 50;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

// The web dashboard calls this from a browser, so the preflight must be answered or
// the POST is never sent at all -- the failure mode migration 20260914 (CORS preflight)
// already cost this project once.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export type Deps = {
  /** Used to prove a media URL points at our own storage — see `isOwnPublicMedia`. */
  supabaseUrl: string;
  /** Reads as the CALLER, so row level security decides what they can see. */
  userClient: (jwt: string) => SupabaseClient;
  /** Writes the verdict. Privileged, because no client may write one. */
  adminClient: () => SupabaseClient;
  provider: CopyrightDetectionProvider;
};

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

  // 1. AUTHENTICATION. The actor comes from the token, never from the body.
  const auth = req.headers.get('Authorization') ?? '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!jwt) return json(401, { error: 'missing bearer token' });

  const asUser = deps.userClient(jwt);
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  const user = userData?.user;
  if (userErr || !user) return json(401, { error: 'not signed in' });

  // 2. INPUT.
  let trackId = '';
  let fullSong = false;
  try {
    const body = await req.json();
    trackId = typeof body?.trackId === 'string' ? body.trackId : '';
    fullSong = body?.fullSong === true;
  } catch {
    return json(400, { error: 'body must be JSON' });
  }
  if (!UUID_RE.test(trackId)) return json(400, { error: 'trackId must be a uuid' });

  // 3. AUTHORIZATION, by construction rather than by a hand-written check.
  //
  // The read runs AS THE CALLER, so `tracks_select_authenticated` applies. But that
  // policy lets any signed-in user read any track, so it authenticates without
  // authorizing -- exactly the error ADR-0008 caught the board making. The explicit
  // uploader_id comparison below is the actual authorization, and it must stay even
  // though the read already succeeded.
  const { data: track, error: trackErr } = await asUser
    .from('tracks')
    .select('id, uploader_id, media_kind, audio_url, video_url')
    .eq('id', trackId)
    .maybeSingle();

  if (trackErr) return json(500, { error: 'could not read the track' });
  if (!track) return json(404, { error: 'track not found' });
  if (track.uploader_id !== user.id) return json(403, { error: 'not your track' });

  const kind: MediaKind = track.media_kind === 'video' ? 'video' : 'audio';
  const mediaUrl = kind === 'video' ? track.video_url : track.audio_url;
  if (!mediaUrl || mediaUrl.startsWith('pending://')) {
    return json(409, { error: 'the upload has not finished' });
  }
  if (!isOwnPublicMedia(mediaUrl, deps.supabaseUrl, track.uploader_id)) {
    return json(422, { error: 'that track does not point at an uploaded file' });
  }

  const admin = deps.adminClient();

  // 4. QUOTA, before the billable call rather than after it.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  //
  // Counted on the scan row's OWN `track_uploader_id`, with no join.
  //
  // This used to embed `tracks!inner(uploader_id)`. PostgREST resolves an embed from
  // foreign-key metadata, so when 20260923070000 dropped the FK — deliberately, so a
  // rights declaration outlives its track — the embed stopped resolving with PGRST200
  // and every scan returned 503. The scan is fail-safe by design, so nothing broke
  // loudly: uploads simply published with no copyright check at all.
  //
  // The snapshot column added by that same migration is the better key anyway. It is on
  // the row, filled by a trigger, and survives the track being deleted — so the quota
  // cannot be reset by deleting tracks, which the join-based version allowed.
  const { count, error: countErr } = await admin
    .from('track_copyright_scans')
    .select('id', { count: 'exact', head: true })
    .eq('track_uploader_id', user.id)
    .gte('created_at', since);
  // A failed count must not become a free pass: if we cannot tell, we do not spend.
  if (countErr) return json(503, { error: 'could not check the scan quota' });
  if ((count ?? 0) >= SCANS_PER_USER_PER_DAY) {
    return json(429, { error: 'daily scan limit reached' });
  }

  // 5. ASK.
  const outcome = await deps.provider.scan(mediaUrl, kind, { fullSong });

  // 6. RECORD. Upsert on (track_id, provider) so a retry or a duplicate delivery
  //    updates the one row rather than adding a second verdict for the same track.
  const row = rowFor(trackId, deps.provider.name, mediaUrl, outcome);
  const { error: writeErr } = await admin
    .from('track_copyright_scans')
    .upsert(row, { onConflict: 'track_id,provider' });

  if (writeErr) {
    // The scan happened; only the bookkeeping failed. Say so rather than reporting a
    // clean result the database does not have.
    return json(500, { error: 'scan completed but could not be recorded' });
  }

  return json(200, publicShape(outcome));
}

/**
 * The shape written to `track_copyright_scans`.
 *
 * Every optional field is spelled out rather than letting each branch of `rowFor`
 * infer its own object: a union of differently-shaped literals makes the upsert call
 * unassignable and hides which columns a branch forgets. `match_found` is explicitly
 * `boolean | null` because null is a MEANINGFUL value here, not an absent one.
 */
export type ScanRow = {
  track_id: string;
  provider: string;
  scanned_media_url: string;
  completed_at: string;
  status: 'complete' | 'failed' | 'skipped';
  match_found: boolean | null;
  confidence: number | null;
  matched_title: string | null;
  matched_artist: string | null;
  matched_isrc: string | null;
  matched_metadata: Record<string, unknown> | null;
};

/**
 * Database row for an outcome. Keeps the status/match_found split honest.
 *
 * EVERY column is written on every branch, never omitted. This upserts on
 * (track_id, provider), and PostgREST builds its update list from the keys PRESENT in
 * the payload — so an omitted column is RETAINED from the previous row. A re-scan that
 * failed after an earlier match would otherwise store
 * `status='failed', match_found=null, matched_title='Kesariya'`: a row whose own fields
 * contradict each other, in a table that exists to be a reliable record.
 */
export function rowFor(
  trackId: string,
  provider: string,
  scannedUrl: string,
  o: ScanOutcome,
): ScanRow {
  const base = {
    track_id: trackId,
    provider,
    scanned_media_url: scannedUrl,
    completed_at: new Date().toISOString(),
    confidence: null,
    matched_title: null,
    matched_artist: null,
    matched_isrc: null,
    matched_metadata: null,
  };
  if (o.status === 'failed' || o.status === 'skipped') {
    return {
      ...base,
      status: o.status,
      match_found: null,
      matched_metadata: { reason: o.reason },
    };
  }
  if (!o.matchFound) {
    return { ...base, status: 'complete', match_found: false };
  }
  return {
    ...base,
    status: 'complete',
    match_found: true,
    confidence: o.confidence,
    matched_title: o.title,
    matched_artist: o.artist,
    matched_isrc: o.isrc,
    matched_metadata: o.raw as Record<string, unknown>,
  };
}

/** What the client is told. Deliberately not the raw provider payload. */
export function publicShape(o: ScanOutcome) {
  if (o.status === 'failed' || o.status === 'skipped') {
    return { status: o.status, matchFound: null as boolean | null };
  }
  if (!o.matchFound) return { status: 'complete', matchFound: false };
  return {
    status: 'complete',
    matchFound: true,
    title: o.title,
    artist: o.artist,
    isrc: o.isrc,
  };
}

export const handler = async (req: Request): Promise<Response> => {
  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const token = Deno.env.get('AUDD_API_TOKEN') ?? '';

  if (!token) {
    // Never fabricate a verdict when the provider was never reachable.
    return json(503, { error: 'scanning is not configured' });
  }

  return handle(req, {
    supabaseUrl: url,
    userClient: jwt =>
      createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false },
      }),
    adminClient: () => createClient(url, serviceKey, { auth: { persistSession: false } }),
    provider: createAuddProvider(token, {
      enterpriseEnabled: Deno.env.get('AUDD_ENTERPRISE_ENABLED') === 'true',
      fullSongEnabled: Deno.env.get('AUDD_FULL_SONG_ENABLED') === 'true',
    }),
  });
};
