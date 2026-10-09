// ============================================================================
// spotify — logic module. Spotify search + track metadata for Spotify reposts (ADR-0027).
// ============================================================================
//
// `index.ts` imports `handler` from here and calls Deno.serve on it; `index.test.ts`
// imports `handle` and the pure helpers without binding a port. Same shape as
// scan-upload and send-push.
//
// ── WHY THIS IS SERVER-SIDE ─────────────────────────────────────────────────
// Spotify's Web API needs an app credential (client id + secret, "client credentials"
// flow). Anything shipped inside the app is readable by anyone, so the secret lives here
// and nowhere else (ADR-0004: no API tier). The app never talks to api.spotify.com.
//
// ── WHAT IT DOES, AND DELIBERATELY DOES NOT ─────────────────────────────────
//   status  → is search available (are credentials configured)?
//   search  → up to 10 tracks for a text query
//   tracks  → title / artists / artwork for up to 20 track ids (the feed cards)
//   resolve → turn a pasted share link (incl. spotify.link short links) into a track id
//
// It holds NO database credential and writes nothing: the caller's token is used only to
// prove they are a signed-in Livil user. It returns an enumerated set of fields, never
// Spotify's raw response, so it cannot be used as a general Spotify proxy. It never
// fetches a URL the caller supplies — every outbound URL is built here from a validated id.
//
// ── SPOTIFY'S TERMS THAT SHAPE IT ───────────────────────────────────────────
// Only TEMPORARY caching of metadata is allowed, so the cache below is in-memory, per
// isolate, one hour. Nothing is written to the database except the bare id (by the app).
// Without credentials the `tracks` action falls back to Spotify's public oEmbed endpoint
// (title + artwork, no artist), so feed cards still render before search is configured.
//
// The feature SWITCH is not here. It lives in the database (app_switches /
// spotify_reposts_enabled(), migration 20261013000000), where it also refuses the insert —
// a switch the server only reports would hide a button, not enforce anything.
//
// SECRETS (custom):
//   SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET  — enable search and full metadata
// Platform-injected: SUPABASE_URL, SUPABASE_ANON_KEY.
// ============================================================================

/** Spotify's base-62 track id. Mirrors posts_spotify_track_id_format in the database. */
export const SPOTIFY_ID_RE = /^[A-Za-z0-9]{22}$/;

/** spotify:track:<id> */
const TRACK_URI_RE = /^spotify:track:([A-Za-z0-9]{22})$/;
/**
 * open.spotify.com/track/<id>, optionally with a locale segment (/intl-de/) and any query or
 * fragment (?si=…). A regex rather than `new URL()`, so the app and this function parse
 * identically — React Native's URL is a polyfill, Deno's is the WHATWG one.
 */
const TRACK_LINK_RE =
  /^(?:https?:\/\/)?open\.spotify\.com\/(?:intl-[A-Za-z-]+\/)?track\/([A-Za-z0-9]{22})(?:[/?#].*)?$/i;

/** Spotify's development-mode search cap is 10 (Feb 2026). We never ask for more. */
export const MAX_SEARCH_RESULTS = 10;
export const MAX_QUERY_LENGTH = 100;
export const MAX_IDS_PER_CALL = 20;
/** "Temporary caching" — Spotify's terms name no lifetime; an hour is comfortably short. */
export const CACHE_TTL_MS = 60 * 60 * 1000;
/**
 * Advisory per-user budget, in UPSTREAM calls per minute rather than requests: one `tracks`
 * request can cost up to 20 Spotify lookups, so it is charged per uncached id. In-memory,
 * so it does not survive across isolates — it stops a runaway client or a casual abuser
 * from spending the app-wide Spotify quota that every user's cards depend on. The durable
 * bound is the circuit breaker below, which honours Spotify's own 429s.
 */
export const UPSTREAM_CALLS_PER_USER_PER_MINUTE = 120;
/** How long to stop calling the Web API after a 429 with no Retry-After. */
export const DEFAULT_BACKOFF_MS = 30_000;
/** oEmbed answers lack the artist; when we HAVE credentials, keep them only briefly. */
export const OEMBED_CACHE_TTL_MS = 5 * 60 * 1000;

/** The only shape this function ever returns for a track. */
export type SpotifyTrack = {
  id: string;
  title: string;
  artists: string[];
  album: string | null;
  imageUrl: string | null;
  durationMs: number | null;
};

// ── Link parsing ────────────────────────────────────────────────────────────

/**
 * The track id in a pasted link, or null. Accepts:
 *   https://open.spotify.com/track/<id>?si=…
 *   https://open.spotify.com/intl-de/track/<id>
 *   spotify:track:<id>
 *   a bare 22-character id
 * Anything else — an album, a playlist, another site — is null, never a guess.
 *
 * Kept identical to src/utils/spotifyLinks.ts; index.test.ts asserts they agree.
 */
export function parseSpotifyTrackId(input: string): string | null {
  const text = input.trim();
  if (SPOTIFY_ID_RE.test(text)) return text;
  const match = TRACK_URI_RE.exec(text) ?? TRACK_LINK_RE.exec(text);
  return match?.[1] ?? null;
}

/** The code in a spotify.link short link, or null. Only that exact host, https only. */
export function parseShortLinkCode(input: string): string | null {
  const match = /^https:\/\/spotify\.link\/([A-Za-z0-9]{4,32})(?:[?#].*)?$/i.exec(input.trim());
  return match ? match[1] : null;
}

// ── Normalisation ───────────────────────────────────────────────────────────

type ApiImage = { url?: unknown; width?: unknown };
type ApiTrack = {
  id?: unknown;
  name?: unknown;
  duration_ms?: unknown;
  artists?: Array<{ name?: unknown }>;
  album?: { name?: unknown; images?: ApiImage[] };
};

/**
 * The artwork to show on a ~350pt square: the smallest image at least 300px wide, else the
 * largest available. Spotify lists 640 / 300 / 64.
 */
export function pickImage(images: ApiImage[] | undefined): string | null {
  const usable = (images ?? [])
    .filter(i => typeof i.url === 'string' && i.url.startsWith('https://'))
    .map(i => ({ url: i.url as string, width: typeof i.width === 'number' ? i.width : 0 }));
  if (usable.length === 0) return null;
  const bigEnough = usable.filter(i => i.width >= 300).sort((a, b) => a.width - b.width);
  if (bigEnough.length > 0) return bigEnough[0].url;
  return usable.sort((a, b) => b.width - a.width)[0].url;
}

/** Spotify's track object → our enumerated shape. Null when it is not a usable track. */
export function normalizeApiTrack(raw: unknown): SpotifyTrack | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as ApiTrack;
  if (typeof t.id !== 'string' || !SPOTIFY_ID_RE.test(t.id)) return null;
  if (typeof t.name !== 'string' || t.name.length === 0) return null;
  return {
    id: t.id,
    title: t.name,
    artists: (t.artists ?? [])
      .map(a => (typeof a?.name === 'string' ? a.name : ''))
      .filter(Boolean),
    album: typeof t.album?.name === 'string' ? t.album.name : null,
    imageUrl: pickImage(t.album?.images),
    durationMs: typeof t.duration_ms === 'number' ? t.duration_ms : null,
  };
}

/** oEmbed carries a title and a thumbnail, no artist. Used only without credentials. */
export function normalizeOembed(id: string, raw: unknown): SpotifyTrack | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { title?: unknown; thumbnail_url?: unknown };
  if (typeof o.title !== 'string' || o.title.length === 0) return null;
  const thumb = typeof o.thumbnail_url === 'string' && o.thumbnail_url.startsWith('https://')
    ? o.thumbnail_url
    : null;
  return { id, title: o.title, artists: [], album: null, imageUrl: thumb, durationMs: null };
}

// ── The handler ─────────────────────────────────────────────────────────────

export type Env = {
  clientId: string | null;
  clientSecret: string | null;
};

export type Deps = {
  env: Env;
  /** Resolves the caller from their access token; null when it is not a valid session. */
  getUserId: (jwt: string) => Promise<string | null>;
  fetch: typeof fetch;
  now: () => number;
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

/** Per-isolate state. Exported for tests to reset between cases. */
export const state = {
  token: null as { value: string; expiresAt: number } | null,
  cache: new Map<string, { track: SpotifyTrack | null; at: number; ttl: number }>(),
  spend: new Map<string, Array<{ at: number; cost: number }>>(),
  /** Circuit breaker: no Web API calls until this time (set by a 429). */
  backoffUntil: 0,
};

export function resetState(): void {
  state.token = null;
  tokenInFlight = null;
  state.cache.clear();
  state.spend.clear();
  state.backoffUntil = 0;
}

function hasCredentials(env: Env): boolean {
  return Boolean(env.clientId && env.clientSecret);
}

/** Spend `cost` from the caller's minute budget. False (and nothing spent) when over. */
function spend(key: string, cost: number, now: number): boolean {
  const windowStart = now - 60_000;
  const recent = (state.spend.get(key) ?? []).filter(e => e.at > windowStart);
  const used = recent.reduce((sum, e) => sum + e.cost, 0);
  if (used + cost > UPSTREAM_CALLS_PER_USER_PER_MINUTE) {
    state.spend.set(key, recent);
    return false;
  }
  recent.push({ at: now, cost });
  state.spend.set(key, recent);
  return true;
}

/**
 * The `sub` claim of an access token, WITHOUT verifying it — used only to key the budget
 * before the (network) verification, so a caller already over budget costs us nothing.
 * Never used for authorization: the verified id from getUserId is what decides access.
 */
export function unverifiedSubject(jwt: string): string | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const claims = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof claims.sub === 'string' ? claims.sub : null;
  } catch {
    return null;
  }
}

function overBudgetAlready(key: string, now: number): boolean {
  const windowStart = now - 60_000;
  const used = (state.spend.get(key) ?? [])
    .filter(e => e.at > windowStart)
    .reduce((sum, e) => sum + e.cost, 0);
  return used >= UPSTREAM_CALLS_PER_USER_PER_MINUTE;
}

function inBackoff(now: number): boolean {
  return now < state.backoffUntil;
}

/** Spotify said 429: stop calling the Web API for Retry-After seconds (or a default). */
function tripBreaker(res: Response, now: number): void {
  const retryAfter = Number(res.headers.get('retry-after'));
  const ms = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 600) * 1000 : DEFAULT_BACKOFF_MS;
  state.backoffUntil = Math.max(state.backoffUntil, now + ms);
}

/**
 * Log WHY Spotify refused — its status and its own error code/message, never our request
 * headers or credentials. Without this a misconfigured key and a Premium requirement look
 * identical from outside: both are just a 502 to the app.
 */
async function logUpstreamFailure(where: string, res: Response): Promise<void> {
  let detail = '';
  const text = await res.clone().text().catch(() => '');
  try {
    const body = JSON.parse(text) as {
      error?: string | { status?: number; message?: string };
      error_description?: string;
    };
    if (typeof body.error === 'string') {
      detail = `${body.error}${body.error_description ? `: ${body.error_description}` : ''}`;
    } else if (body.error && typeof body.error.message === 'string') {
      detail = body.error.message;
    }
  } catch {
    // Not JSON — fall through to the raw text below.
  }
  // Spotify's own words, whatever shape they came in. Bodies from Spotify carry no
  // credentials; collapsing whitespace keeps one log line per failure.
  if (!detail && text) detail = `body: ${text.replace(/\s+/g, ' ').trim()}`;
  if (!detail) detail = `(empty body; content-type ${res.headers.get('content-type') ?? 'none'})`;
  console.warn(`[spotify] ${where} failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`);
}

/**
 * The app token, fetched once and shared: a cold `tracks` call runs up to 20 lookups at
 * once, and without this each would ask accounts.spotify.com for its own token.
 */
let tokenInFlight: Promise<string | null> | null = null;

function appToken(deps: Deps, forceRefresh = false): Promise<string | null> {
  const now = deps.now();
  if (!forceRefresh && state.token && state.token.expiresAt > now) return Promise.resolve(state.token.value);
  if (forceRefresh) state.token = null;
  if (!tokenInFlight) {
    tokenInFlight = fetchAppToken(deps).finally(() => { tokenInFlight = null; });
  }
  return tokenInFlight;
}

async function fetchAppToken(deps: Deps): Promise<string | null> {
  const now = deps.now();
  const { clientId, clientSecret } = deps.env;
  if (!clientId || !clientSecret) return null;
  const res = await deps.fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    await logUpstreamFailure('token request', res);
    return null;
  }
  const body = await res.json().catch(() => null) as { access_token?: unknown; expires_in?: unknown } | null;
  if (!body || typeof body.access_token !== 'string') return null;
  const ttlSec = typeof body.expires_in === 'number' ? body.expires_in : 3600;
  // Refresh a minute early so a token never expires mid-request.
  state.token = { value: body.access_token, expiresAt: now + Math.max(ttlSec - 60, 60) * 1000 };
  return state.token.value;
}

/**
 * GET against the Web API with the app token; one retry on 401 with a fresh token. Null
 * when there is no token or the circuit breaker is open — callers treat that as "Spotify
 * is unavailable right now", never as an answer.
 */
async function apiGet(deps: Deps, url: string): Promise<Response | null> {
  if (inBackoff(deps.now())) return null;
  let token = await appToken(deps);
  if (!token) {
    console.warn('[spotify] no app token — check SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET');
    return null;
  }
  let res = await deps.fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    token = await appToken(deps, true);
    if (!token) return null;
    res = await deps.fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }
  if (res.status === 429) {
    tripBreaker(res, deps.now());
    console.warn('[spotify] Web API rate-limited us (429); backing off');
    return null;
  }
  if (!res.ok && res.status !== 404) await logUpstreamFailure('Web API call', res);
  return res;
}

/** A lookup either answers (a track, or null for "no such track") or is transient. */
type Lookup = { answered: true; track: SpotifyTrack | null } | { answered: false };

function isCached(id: string, now: number): boolean {
  const cached = state.cache.get(id);
  return !!cached && now - cached.at < cached.ttl;
}

async function lookupTrack(deps: Deps, id: string): Promise<Lookup> {
  const now = deps.now();
  const cached = state.cache.get(id);
  if (cached && now - cached.at < cached.ttl) return { answered: true, track: cached.track };

  if (hasCredentials(deps.env)) {
    const res = await apiGet(deps, `https://api.spotify.com/v1/tracks/${id}`);
    if (res?.ok) {
      const track = normalizeApiTrack(await res.json().catch(() => null));
      state.cache.set(id, { track, at: now, ttl: CACHE_TTL_MS });
      return { answered: true, track };
    }
    if (res && (res.status === 404 || res.status === 400)) {
      // The id does not name a track. A real answer: remember it.
      state.cache.set(id, { track: null, at: now, ttl: CACHE_TTL_MS });
      return { answered: true, track: null };
    }
    // No token, breaker open, or a server error: degrade to oEmbed below.
  }

  // oEmbed: keyless and a different service, so it keeps cards rendering while the Web API
  // is unavailable or before credentials exist — title and artwork, no artist.
  const target = encodeURIComponent(`https://open.spotify.com/track/${id}`);
  const res = await deps.fetch(`https://open.spotify.com/oembed?url=${target}`);
  if (res.ok) {
    const track = normalizeOembed(id, await res.json().catch(() => null));
    const ttl = hasCredentials(deps.env) ? OEMBED_CACHE_TTL_MS : CACHE_TTL_MS;
    state.cache.set(id, { track, at: now, ttl });
    return { answered: true, track };
  }
  if (res.status === 404) {
    state.cache.set(id, { track: null, at: now, ttl: CACHE_TTL_MS });
    return { answered: true, track: null };
  }
  // Transient: not cached here, and left OUT of the response so the app retries later
  // instead of remembering "unavailable" for the rest of the session.
  return { answered: false };
}

async function resolveShortLink(deps: Deps, code: string): Promise<string | null> {
  // The URL is built here from a validated code — the caller's string is never fetched.
  // Only the redirect target counts: scanning the page for "a track link" would turn a
  // short link to a playlist or album into some random track on it.
  const res = await deps.fetch(`https://spotify.link/${code}`, { redirect: 'manual' });
  const location = res.headers.get('location');
  return location ? parseSpotifyTrackId(location) : null;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

  // 1. AUTHENTICATION. Signed-in Livil users only; the identity comes from the token.
  const auth = req.headers.get('Authorization') ?? '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!jwt) return json(401, { error: 'missing bearer token' });
  // A caller already over budget is turned away BEFORE the verification round trip.
  const claimed = unverifiedSubject(jwt);
  if (claimed && overBudgetAlready(claimed, deps.now())) return json(429, { error: 'slow down' });
  const userId = await deps.getUserId(jwt).catch(() => null);
  if (!userId) return json(401, { error: 'not signed in' });

  // 2. INPUT.
  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: 'body must be a JSON object' });
  }

  switch (body.action) {
    case 'status':
      return json(200, { search: hasCredentials(deps.env) });

    case 'search': {
      const q = typeof body.q === 'string' ? body.q.trim() : '';
      if (q.length === 0 || q.length > MAX_QUERY_LENGTH) {
        return json(400, { error: `q must be 1–${MAX_QUERY_LENGTH} characters` });
      }
      const requested = typeof body.limit === 'number' ? Math.floor(body.limit) : 8;
      const limit = Math.min(Math.max(requested, 1), MAX_SEARCH_RESULTS);
      if (!hasCredentials(deps.env)) return json(200, { enabled: false, tracks: [] });
      if (!spend(userId, 1, deps.now())) return json(429, { error: 'slow down' });

      const params = new URLSearchParams({ q, type: 'track', limit: String(limit) });
      const res = await apiGet(deps, `https://api.spotify.com/v1/search?${params}`);
      if (!res || !res.ok) {
        return json(502, { error: 'spotify search is unavailable', status: res?.status ?? null });
      }
      const raw = await res.json().catch(() => null) as { tracks?: { items?: unknown[] } } | null;
      const tracks = (raw?.tracks?.items ?? [])
        .map(normalizeApiTrack)
        .filter((t): t is SpotifyTrack => t !== null)
        .slice(0, limit);
      const now = deps.now();
      for (const t of tracks) state.cache.set(t.id, { track: t, at: now, ttl: CACHE_TTL_MS });
      return json(200, { enabled: true, tracks });
    }

    case 'tracks': {
      const ids = Array.isArray(body.ids) ? body.ids : null;
      if (!ids || ids.length === 0 || ids.length > MAX_IDS_PER_CALL) {
        return json(400, { error: `ids must be 1–${MAX_IDS_PER_CALL} track ids` });
      }
      if (!ids.every(id => typeof id === 'string' && SPOTIFY_ID_RE.test(id))) {
        return json(400, { error: 'every id must be a Spotify track id' });
      }
      const unique = [...new Set(ids as string[])];
      // Charged per id that will actually reach Spotify; cached ids are free.
      const now = deps.now();
      const cost = unique.filter(id => !isCached(id, now)).length;
      if (cost > 0 && !spend(userId, cost, now)) return json(429, { error: 'slow down' });
      const found = await Promise.all(
        unique.map(id => lookupTrack(deps, id).catch((): Lookup => ({ answered: false }))),
      );
      // Only answered ids are returned: a missing key means "try again later".
      const tracks: Record<string, SpotifyTrack | null> = {};
      unique.forEach((id, i) => {
        const r = found[i];
        if (r.answered) tracks[id] = r.track;
      });
      return json(200, { tracks });
    }

    case 'resolve': {
      const url = typeof body.url === 'string' ? body.url : '';
      if (url.length === 0 || url.length > 500) return json(400, { error: 'url is required' });
      const direct = parseSpotifyTrackId(url);
      if (direct) return json(200, { id: direct });
      const code = parseShortLinkCode(url);
      if (!code) return json(200, { id: null });
      if (!spend(userId, 1, deps.now())) return json(429, { error: 'slow down' });
      const id = await resolveShortLink(deps, code).catch(() => null);
      return json(200, { id });
    }

    default:
      return json(400, { error: 'unknown action' });
  }
}

/** Production wiring. Imported by index.ts only, so tests never touch Deno.env. */
export function productionDeps(): Deps {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  return {
    env: {
      clientId: Deno.env.get('SPOTIFY_CLIENT_ID') || null,
      clientSecret: Deno.env.get('SPOTIFY_CLIENT_SECRET') || null,
    },
    // GoTrue's /user endpoint validates the access token. No database client is created:
    // this function reads and writes nothing in Livil.
    getUserId: async (jwt: string) => {
      const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${jwt}`, apikey: anonKey },
      });
      if (!res.ok) return null;
      const user = await res.json().catch(() => null) as { id?: unknown } | null;
      return typeof user?.id === 'string' ? user.id : null;
    },
    fetch,
    now: () => Date.now(),
  };
}

export async function handler(req: Request): Promise<Response> {
  return handle(req, productionDeps());
}
