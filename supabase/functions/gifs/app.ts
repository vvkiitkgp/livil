// ============================================================================
// gifs — GIF search and lookup for GIFs in comments. Reasoning: ADR-0031.
// ============================================================================
//
// `index.ts` serves `handler`; `index.test.ts` imports `handle` and the helpers (as spotify).
//
// Server-side so the key never ships and a provider switch is a deploy, not an app update.
// Signed-in callers only; no database credential; never fetches a caller-supplied URL;
// returns only the `Gif` shape below. Every GIF returned, from every action, is rated
// G/PG/PG-13 (normalizeGif) — `lookup` ids come from comment rows anyone can write.
// GIPHY's terms: media URLs pass through untouched and are never cached or stored.
//
// SECRETS: GIPHY_API_KEY (required); GIFS_CALLS_PER_HOUR (optional app-wide budget).
// ============================================================================

/** GIPHY's base-62 GIF id. Mirrors post_comments_gif_id_format in the database. */
export const GIF_ID_RE = /^[A-Za-z0-9]{1,64}$/;

/**
 * The only media URLs this function hands out: https on GIPHY's own CDN hosts
 * (media.giphy.com, media0–media4.giphy.com, i.giphy.com).
 */
const GIPHY_MEDIA_RE = /^https:\/\/(?:media\d?|i)\.giphy\.com\/\S+$/;

/** G, PG and PG-13. Anything else, or no rating at all, is never returned. */
export const ALLOWED_RATINGS: ReadonlySet<string> = new Set(['g', 'pg', 'pg-13']);

export const PAGE_SIZE = 18;
export const MAX_QUERY_LENGTH = 50;
/** GIPHY refuses offsets past 4999. */
export const MAX_OFFSET = 4999;
export const MAX_IDS_PER_CALL = 50;
/** Neither side of a GIF we return may be larger; matches post_comments_gif_size. */
export const MAX_SIDE = 4096;
/**
 * HOURLY budgets, because GIPHY's beta key allows 100 calls an hour app-wide: a per-minute
 * budget would let one account spend that hour in minutes. Per isolate, so advisory; GIPHY's
 * 429 and the breaker are the durable bound (ADR-0031).
 */
export const CALLS_PER_USER_PER_HOUR = 30;
export const DEFAULT_CALLS_PER_HOUR = 90;
const HOUR_MS = 60 * 60 * 1000;
/** How long to stop calling GIPHY after a 429 with no Retry-After. */
export const DEFAULT_BACKOFF_MS = 60_000;

/** The only shape this function ever returns for a GIF. */
export type Gif = {
  id: string;
  provider: 'giphy';
  /** For screen readers; may be empty. */
  title: string;
  /** Of `url`, in px. */
  width: number;
  height: number;
  /** What a comment shows: ~200 px wide, animated. */
  url: string;
  /** What the picker grid shows: the same GIF with fewer frames, so a grid loads fast. */
  previewUrl: string;
};

// ── Normalisation ───────────────────────────────────────────────────────────

type ApiRendition = { url?: unknown; width?: unknown; height?: unknown };
type ApiGif = {
  id?: unknown;
  title?: unknown;
  rating?: unknown;
  images?: { fixed_width?: ApiRendition; fixed_width_downsampled?: ApiRendition };
};

function mediaUrl(value: unknown): string | null {
  return typeof value === 'string' && GIPHY_MEDIA_RE.test(value) ? value : null;
}

/** GIPHY sends sizes as strings ("200"). */
function side(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= MAX_SIDE ? n : null;
}

/**
 * GIPHY's GIF object → our enumerated shape, or null when it is not one we may show: a bad
 * id, a rating above PG-13 (or none), or no usable fixed-width rendition on GIPHY's CDN.
 */
export function normalizeGif(raw: unknown): Gif | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as ApiGif;
  if (typeof g.id !== 'string' || !GIF_ID_RE.test(g.id)) return null;
  const rating = typeof g.rating === 'string' ? g.rating.toLowerCase() : '';
  if (!ALLOWED_RATINGS.has(rating)) return null;
  const main = g.images?.fixed_width;
  const url = mediaUrl(main?.url);
  const width = side(main?.width);
  const height = side(main?.height);
  if (!url || !width || !height) return null;
  const title = typeof g.title === 'string' ? g.title.trim().slice(0, 140) : '';
  return {
    id: g.id,
    provider: 'giphy',
    title,
    width,
    height,
    url,
    previewUrl: mediaUrl(g.images?.fixed_width_downsampled?.url) ?? url,
  };
}

/** The offset of the next page, or null when this was the last one we may ask for. */
export function nextOffset(offset: number, count: number, total: unknown): number | null {
  if (count === 0) return null;
  const next = offset + count;
  if (next > MAX_OFFSET) return null;
  if (typeof total === 'number' && next >= total) return null;
  return next;
}

// ── The handler ─────────────────────────────────────────────────────────────

export type Env = {
  apiKey: string | null;
  /** The app-wide hourly budget (GIFS_CALLS_PER_HOUR). */
  callsPerHour: number;
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
  /** Upstream calls per user in the last hour (timestamps). */
  spend: new Map<string, number[]>(),
  /** Upstream calls by everyone in the last hour, in this isolate. */
  all: [] as number[],
  /** Circuit breaker: no GIPHY calls until this time (set by a 429). */
  backoffUntil: 0,
};

export function resetState(): void {
  state.spend.clear();
  state.all = [];
  state.backoffUntil = 0;
}

function inLastHour(times: number[] | undefined, now: number): number[] {
  return (times ?? []).filter(at => at > now - HOUR_MS);
}

/** Read-only: is this caller already out of budget? Used BEFORE the token is verified. */
function overUserBudget(key: string, now: number): boolean {
  return inLastHour(state.spend.get(key), now).length >= CALLS_PER_USER_PER_HOUR;
}

/**
 * Spend one upstream call from the caller's hourly budget and the app-wide one. False (and
 * nothing spent) when either is used up.
 */
function spend(key: string, env: Env, now: number): boolean {
  const mine = inLastHour(state.spend.get(key), now);
  state.all = inLastHour(state.all, now);
  if (mine.length >= CALLS_PER_USER_PER_HOUR || state.all.length >= env.callsPerHour) {
    state.spend.set(key, mine);
    return false;
  }
  mine.push(now);
  state.all.push(now);
  state.spend.set(key, mine);
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

/**
 * Log WHY GIPHY refused — its status and its own message, never the request URL (the key
 * is in its query string).
 */
async function logUpstreamFailure(res: Response, apiKey: string | null): Promise<void> {
  const text = await res.clone().text().catch(() => '');
  let detail = '';
  try {
    const body = JSON.parse(text) as { meta?: { msg?: unknown }; message?: unknown };
    if (typeof body.meta?.msg === 'string') detail = body.meta.msg;
    else if (typeof body.message === 'string') detail = body.message;
  } catch {
    detail = text.replace(/\s+/g, ' ').trim();
  }
  // GIPHY's error bodies are not known to echo the request, but the key would be in it if
  // one did — so it is replaced before anything is logged.
  if (apiKey) detail = detail.split(apiKey).join('[key]');
  console.warn(`[gifs] GIPHY call failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`);
}

/**
 * GET a GIPHY endpoint with the key. Null when GIPHY is unavailable right now (breaker
 * open, network error, 429, any non-2xx) — callers answer that as a failure, never as
 * "no results".
 */
async function giphyGet(
  deps: Deps,
  path: 'gifs/trending' | 'gifs/search' | 'gifs',
  params: Record<string, string>,
): Promise<{ data?: unknown[]; pagination?: { total_count?: unknown } } | null> {
  if (deps.now() < state.backoffUntil) return null;
  const query = new URLSearchParams({ api_key: deps.env.apiKey ?? '', ...params });
  let res: Response;
  try {
    res = await deps.fetch(`https://api.giphy.com/v1/${path}?${query}`);
  } catch {
    console.warn('[gifs] GIPHY unreachable');
    return null;
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after'));
    const ms = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter, 3600) * 1000
      : DEFAULT_BACKOFF_MS;
    state.backoffUntil = Math.max(state.backoffUntil, deps.now() + ms);
    console.warn('[gifs] GIPHY rate-limited us (429); backing off');
    return null;
  }
  if (!res.ok) {
    await logUpstreamFailure(res, deps.env.apiKey);
    return null;
  }
  const body = await res.json().catch(() => null);
  return body && typeof body === 'object' ? body as { data?: unknown[] } : null;
}

function readOffset(value: unknown): number | null {
  if (value === undefined) return 0;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_OFFSET
    ? value
    : null;
}

async function page(
  deps: Deps,
  path: 'gifs/trending' | 'gifs/search',
  params: Record<string, string>,
  offset: number,
): Promise<Response> {
  const body = await giphyGet(deps, path, {
    ...params,
    limit: String(PAGE_SIZE),
    offset: String(offset),
    rating: 'pg-13',
  });
  if (!body) return json(502, { error: 'GIF search is unavailable' });
  const raw = Array.isArray(body.data) ? body.data : [];
  const gifs = raw.map(normalizeGif).filter((g): g is Gif => g !== null);
  // Paged by what GIPHY returned, not by what survived the filter, so a page whose GIFs
  // were all dropped still moves on to the next one.
  return json(200, {
    enabled: true,
    gifs,
    next: nextOffset(offset, raw.length, body.pagination?.total_count),
  });
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
  if (claimed && overUserBudget(claimed, deps.now())) return json(429, { error: 'slow down' });
  const userId = await deps.getUserId(jwt).catch(() => null);
  if (!userId) return json(401, { error: 'not signed in' });

  // 2. INPUT.
  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: 'body must be a JSON object' });
  }

  const enabled = Boolean(deps.env.apiKey);

  switch (body.action) {
    case 'status':
      return json(200, { enabled });

    case 'trending': {
      const offset = readOffset(body.offset);
      if (offset === null) return json(400, { error: `offset must be an integer 0–${MAX_OFFSET}` });
      if (!enabled) return json(200, { enabled: false, gifs: [], next: null });
      if (!spend(userId, deps.env, deps.now())) return json(429, { error: 'slow down' });
      return page(deps, 'gifs/trending', {}, offset);
    }

    case 'search': {
      const q = typeof body.q === 'string' ? body.q.trim() : '';
      if (q.length === 0 || q.length > MAX_QUERY_LENGTH) {
        return json(400, { error: `q must be 1–${MAX_QUERY_LENGTH} characters` });
      }
      const offset = readOffset(body.offset);
      if (offset === null) return json(400, { error: `offset must be an integer 0–${MAX_OFFSET}` });
      if (!enabled) return json(200, { enabled: false, gifs: [], next: null });
      if (!spend(userId, deps.env, deps.now())) return json(429, { error: 'slow down' });
      return page(deps, 'gifs/search', { q }, offset);
    }

    case 'lookup': {
      const ids = Array.isArray(body.ids) ? body.ids : null;
      if (!ids || ids.length === 0 || ids.length > MAX_IDS_PER_CALL) {
        return json(400, { error: `ids must be 1–${MAX_IDS_PER_CALL} GIF ids` });
      }
      if (!ids.every(id => typeof id === 'string' && GIF_ID_RE.test(id))) {
        return json(400, { error: 'every id must be a GIF id' });
      }
      // Not enabled → nothing answered, so the app keeps the box and retries later.
      if (!enabled) return json(200, { gifs: {} });
      if (!spend(userId, deps.env, deps.now())) return json(429, { error: 'slow down' });
      const unique = [...new Set(ids as string[])];
      const res = await giphyGet(deps, 'gifs', { ids: unique.join(','), rating: 'pg-13' });
      // A failed call answers nothing: every id is left out, so the app tries again later
      // instead of remembering "unavailable" for the rest of the session.
      if (!res) return json(200, { gifs: {} });
      const found = new Map<string, Gif>();
      for (const raw of Array.isArray(res.data) ? res.data : []) {
        const gif = normalizeGif(raw);
        if (gif) found.set(gif.id, gif);
      }
      // GIPHY answered: an id it did not return (removed, or rated above PG-13 and so
      // dropped by normalizeGif) is a real "not available", and null says so.
      const gifs: Record<string, Gif | null> = {};
      for (const id of unique) gifs[id] = found.get(id) ?? null;
      return json(200, { gifs });
    }

    default:
      return json(400, { error: 'unknown action' });
  }
}

/** GIFS_CALLS_PER_HOUR → a positive whole number, else the default. */
export function parseCallsPerHour(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_CALLS_PER_HOUR;
}

/** Production wiring. Imported by index.ts only, so tests never touch Deno.env. */
export function productionDeps(): Deps {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  return {
    env: {
      apiKey: Deno.env.get('GIPHY_API_KEY') || null,
      callsPerHour: parseCallsPerHour(Deno.env.get('GIFS_CALLS_PER_HOUR')),
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
