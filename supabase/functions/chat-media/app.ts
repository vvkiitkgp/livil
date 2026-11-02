// ============================================================================
// chat-media — the link to a disappearing (20-minute) chat photo or video, and the sweep that deletes it.
// Design: PROP-0011 (kb/debt/proposals/0011-disappearing-media-in-chat.md).
// ============================================================================
//
// `index.ts` serves `handler`; `index.test.ts` imports `handle` and the helpers (as gifs).
//
// The file lives in the PRIVATE `chat-media` bucket, which clients may upload into but never
// read. This function is the only way to the bytes:
//
//   link   — for a member of the chat (proved by reading the message AS THE CALLER, so the
//            messages RLS decides, not a hand copy of it), while the message is under 20
//            minutes old (server-stamped created_at). The signed URL's lifetime is the time
//            LEFT, so no link outlives the window even before the sweep runs.
//   sweep  — deletes every object older than 20 minutes. Called by pg_cron through
//            chat_media_sweep_dispatch() (20261118000000) with the public anon key; it can
//            only remove files that should already be gone, so it needs no user.
//   status — whether the app should offer sending (CHAT_MEDIA_ENABLED). A missing function
//            or an error reads as "off", so a new app on an unapplied backend hides the button.
//
// SECRETS: CHAT_MEDIA_ENABLED=true (optional; off by default). The platform provides
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.
// ============================================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/** How long a sent photo or video exists, from the message's created_at. */
export const LIFETIME_MS = 20 * 60 * 1000;
export const BUCKET = 'chat-media';
/** Batches the sweep deletes per call (Storage removes at most 1000 per request). */
export const SWEEP_BATCH = 500;
export const SWEEP_MAX_BATCHES = 4;
/** One isolate sweeps at most this often, however often it is asked. */
export const SWEEP_MIN_INTERVAL_MS = 20_000;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const UUID_RE = new RegExp(`^${UUID}$`);
/**
 * `<conversation_id>/<uuid>.<ext>` — mirrors chat_media_can_upload() in the database. `[.]`
 * rather than an escaped dot: the MCP deploy has mangled backslash escapes in transit.
 */
export const OBJECT_RE = new RegExp(`^(${UUID})/${UUID}[.](jpg|mp4|mov)$`);

/** What `link` needs of a message, read as the caller. */
export type MessageRow = {
  id: string;
  conversation_id: string;
  created_at: string;
  deleted_at: string | null;
  metadata: unknown;
};

export type Deps = {
  env: { enabled: boolean };
  /** Resolves the caller from their access token; null when it is not a valid session. */
  getUserId: (jwt: string) => Promise<string | null>;
  /** The message AS THE CALLER — null when RLS hides it (not a member) or it does not exist. */
  readMessage: (jwt: string, messageId: string) => Promise<MessageRow | null>;
  /** A signed GET URL for the object, valid `ttlSeconds`; null on failure. */
  signUrl: (object: string, ttlSeconds: number) => Promise<string | null>;
  /** Names of objects older than LIFETIME_MS, oldest first, at most `limit`. */
  expiredObjects: (limit: number) => Promise<string[]>;
  /** Deletes the named objects; false on failure. */
  removeObjects: (names: string[]) => Promise<boolean>;
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
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

// ── Pure rules ──────────────────────────────────────────────────────────────

/** The storage object a message's metadata names, or null when it carries no media. */
export function mediaObject(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const media = (metadata as { media?: unknown }).media;
  if (!media || typeof media !== 'object') return null;
  const object = (media as { object?: unknown }).object;
  return typeof object === 'string' ? object : null;
}

export type LinkPlan =
  | { ok: true; object: string; ttlSeconds: number; expiresAt: number }
  | { ok: false; status: number; error: string };

/**
 * Whether this message's file may be handed out now, and for how long. The object must sit
 * in the message's OWN conversation folder: metadata is written by the sender, so without
 * this a member could point a message at another chat's file and read it back.
 */
export function planLink(row: MessageRow, now: number): LinkPlan {
  if (row.deleted_at) return { ok: false, status: 410, error: 'deleted' };
  const object = mediaObject(row.metadata);
  const match = object ? OBJECT_RE.exec(object) : null;
  if (!object || !match) return { ok: false, status: 400, error: 'no media' };
  if (match[1] !== row.conversation_id) return { ok: false, status: 400, error: 'no media' };
  const sentAt = Date.parse(row.created_at);
  if (!Number.isFinite(sentAt)) return { ok: false, status: 400, error: 'no media' };
  const expiresAt = sentAt + LIFETIME_MS;
  const leftMs = expiresAt - now;
  // Floor, so the link dies no later than the window; under a second left is "expired".
  const ttlSeconds = Math.floor(leftMs / 1000);
  if (ttlSeconds < 1) return { ok: false, status: 410, error: 'expired' };
  return { ok: true, object, ttlSeconds, expiresAt };
}

// ── Handler ─────────────────────────────────────────────────────────────────

const state = { lastSweepAt: -Infinity };
/** For tests: forget the last sweep. */
export function resetState(): void {
  state.lastSweepAt = -Infinity;
}

async function sweep(deps: Deps): Promise<Response> {
  const now = deps.now();
  if (now - state.lastSweepAt < SWEEP_MIN_INTERVAL_MS) return json(200, { deleted: 0, throttled: true });
  state.lastSweepAt = now;
  let deleted = 0;
  for (let i = 0; i < SWEEP_MAX_BATCHES; i++) {
    const names = await deps.expiredObjects(SWEEP_BATCH).catch(() => null);
    if (names === null) return json(502, { error: 'could not list', deleted });
    if (names.length === 0) break;
    const ok = await deps.removeObjects(names).catch(() => false);
    if (!ok) return json(502, { error: 'could not delete', deleted });
    deleted += names.length;
    if (names.length < SWEEP_BATCH) break;
  }
  if (deleted > 0) console.log(`[chat-media] swept ${deleted} expired file(s)`);
  return json(200, { deleted });
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: 'body must be a JSON object' });
  }

  // The sweep needs no user: it can only delete files that are already past their 20 minutes.
  if (body.action === 'sweep') return sweep(deps);

  // Everything else: signed-in Livil users only; the identity comes from the token.
  const auth = req.headers.get('Authorization') ?? '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!jwt) return json(401, { error: 'missing bearer token' });
  const userId = await deps.getUserId(jwt).catch(() => null);
  if (!userId) return json(401, { error: 'not signed in' });

  switch (body.action) {
    case 'status':
      return json(200, { enabled: deps.env.enabled });

    case 'link': {
      const messageId = typeof body.message_id === 'string' ? body.message_id : '';
      if (!UUID_RE.test(messageId)) return json(400, { error: 'message_id must be a uuid' });
      const row = await deps.readMessage(jwt, messageId).catch(() => null);
      // Not a member and "no such message" look the same on purpose.
      if (!row) return json(404, { error: 'not found' });
      const plan = planLink(row, deps.now());
      if (!plan.ok) return json(plan.status, { error: plan.error });
      const url = await deps.signUrl(plan.object, plan.ttlSeconds).catch(() => null);
      if (!url) return json(502, { error: 'could not sign' });
      // `now` lets the app correct its countdown for a phone clock that is off.
      return json(200, {
        url,
        expires_at: new Date(plan.expiresAt).toISOString(),
        now: new Date(deps.now()).toISOString(),
      });
    }

    default:
      return json(400, { error: 'unknown action' });
  }
}

/** Production wiring. Imported by index.ts only, so tests never touch Deno.env. */
export function productionDeps(): Deps {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  let admin: SupabaseClient | null = null;
  const adminClient = () => (admin ??= createClient(url, serviceKey, { auth: { persistSession: false } }));
  return {
    env: { enabled: Deno.env.get('CHAT_MEDIA_ENABLED') === 'true' },
    // GoTrue's /user endpoint validates the access token.
    getUserId: async (jwt: string) => {
      const res = await fetch(`${url}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${jwt}`, apikey: anonKey },
      });
      if (!res.ok) return null;
      const user = await res.json().catch(() => null) as { id?: unknown } | null;
      return typeof user?.id === 'string' ? user.id : null;
    },
    readMessage: async (jwt: string, messageId: string) => {
      const asCaller = createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false },
      });
      const { data, error } = await asCaller
        .from('messages')
        .select('id, conversation_id, created_at, deleted_at, metadata')
        .eq('id', messageId)
        .maybeSingle();
      if (error) throw error;
      return (data as MessageRow | null) ?? null;
    },
    signUrl: async (object: string, ttlSeconds: number) => {
      const { data, error } = await adminClient().storage.from(BUCKET).createSignedUrl(object, ttlSeconds);
      if (error) {
        console.warn('[chat-media] sign failed:', error.message);
        return null;
      }
      return data?.signedUrl ?? null;
    },
    expiredObjects: async (limit: number) => {
      const { data, error } = await adminClient().rpc('chat_media_expired_objects', { p_limit: limit });
      if (error) throw error;
      // A `setof text` function comes back as an array of strings.
      return (Array.isArray(data) ? data : []).filter((n): n is string => typeof n === 'string');
    },
    removeObjects: async (names: string[]) => {
      const { error } = await adminClient().storage.from(BUCKET).remove(names);
      if (error) console.warn('[chat-media] remove failed:', error.message);
      return !error;
    },
    now: () => Date.now(),
  };
}

export async function handler(req: Request): Promise<Response> {
  return handle(req, productionDeps());
}
