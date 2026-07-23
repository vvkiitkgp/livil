// ============================================================================
// send-push — logic module (the edge function LIV-9 found missing in production)
// ============================================================================
//
// The entrypoint `index.ts` imports `handler` from here and calls Deno.serve on it.
// Keeping the logic in a separate module (not gated on import.meta.main) means the
// deployed function ALWAYS serves, while `index.test.ts` can import the pure helpers
// and `handler`/`authorize` without binding a port.
//
// WHAT THE REST OF THE SYSTEM ALREADY EXPECTS (verified in-repo):
//   • `src/services/pushDispatch.ts` calls `functions.invoke('send-push', { body })`
//     with { recipientUserId, kind, title?, body?, data?: { route, params } }.
//   • Tokens live in `public.device_tokens (user_id, token, device_id, platform, …)`.
//   • The client renders DATA-ONLY FCM messages itself via notifee
//     (`displayPushNotification`), and routes taps on `data.route` + remaining keys.
//     So this function MUST send `message.data` only — never a `notification` block —
//     or Android will auto-display a second, unstyled card.
//
// ── THE SECURITY MODEL ──────────────────────────────────────────────────────
// The caller-supplied shape is UNTRUSTED. Three things must hold:
//   1. AUTHENTICATION — require a real user JWT; derive the actor from the token, never
//      from the body. Reject anon.
//   2. AUTHORIZATION — the actor must be allowed to notify `recipientUserId` for this
//      `kind`. Enforced server-side by `authorize()`, deny-by-default. This stops the
//      headline abuse: pushing arbitrary text to an arbitrary stranger.
//   3. CONTENT — `title`/`body` are untrusted display strings: clamp length.
//
// KNOWN RESIDUAL (D-45): even with (1)–(3), an actor supplies the body and can send a
// plausible notification to someone they already have a relationship with. Client-
// dispatched push is forgeable by construction; the durable fix is server-side dispatch
// from inside the SECURITY DEFINER functions. Do not treat this as closing D-45.
//
// SECRETS (custom): FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY.
// Platform-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
// ============================================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

// The 14 kinds pushDispatch.ts can emit. Anything else is rejected.
const KINDS = new Set([
  'friend_request', 'friend_accepted', 'new_follower', 'new_fan', 'message',
  'reaction', 'jam_invite_dm', 'jam_started', 'jam_join', 'jam_ended',
  'activity_like', 'activity_comment', 'activity_repost', 'activity_milestone',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// notifee channels the client actually created (ensureChannels in pushNotifications.ts):
// 'social', 'activity', 'messages', 'jam'.
export function channelFor(kind: string): string {
  if (kind === 'message' || kind === 'reaction') return 'messages';
  if (kind.startsWith('jam_')) return 'jam';
  if (kind.startsWith('activity_')) return 'activity';
  return 'social'; // friend_request, friend_accepted, new_follower, new_fan
}

const MAX_BODY = 240;
export const clamp = (s: unknown, n: number) =>
  typeof s === 'string' ? s.slice(0, n) : '';

// Server-side copy for the kinds the client dispatches WITHOUT title/body (the
// relationship/jam kinds). The notification title is set to the actor's display name
// separately, so these read as "<Actor> <body>". message/reaction/activity_*/milestone
// carry their own client text and never reach here.
export function defaultBody(kind: string): string {
  switch (kind) {
    case 'friend_request': return 'sent you a friend request';
    case 'friend_accepted': return 'accepted your friend request';
    case 'new_follower':
    case 'new_fan': return 'started following you';
    case 'jam_invite_dm': return 'invited you to a Jam';
    case 'jam_started': return 'started a Jam';
    case 'jam_join': return 'joined your Jam';
    case 'jam_ended': return 'ended the Jam';
    default: return 'sent you a notification';
  }
}

export const isValidKind = (k: string): boolean => KINDS.has(k);
export const isValidRecipient = (r: unknown): r is string =>
  typeof r === 'string' && UUID_RE.test(r);
// Only self-directed kinds may target the caller; everything else targeting yourself
// is suspicious and denied.
export const selfTargetAllowed = (kind: string): boolean => kind === 'activity_milestone';

type PushRequest = {
  recipientUserId?: string;
  kind?: string;
  title?: string;
  body?: string;
  data?: { route?: string; params?: Record<string, string> };
};

function json(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ── Authorization, per kind. DENY BY DEFAULT. ───────────────────────────────
// Returns true only if `actor` is allowed to notify `recipient` for `kind`. Uses the
// service-role client to read relationship tables (RLS-independent), so the checks here
// ARE the perimeter. `actor` (from the JWT) and `recipient` (UUID-validated in handler)
// are both strict UUIDs before interpolation into the PostgREST `.or()` filter.
export async function authorize(
  admin: SupabaseClient,
  kind: string,
  actor: string,
  recipient: string,
): Promise<boolean> {
  if (actor === recipient) return selfTargetAllowed(kind);

  switch (kind) {
    case 'message':
    case 'reaction':
    case 'jam_invite_dm': {
      // Must share a conversation — a REAL intersection: some conversation_id that both
      // actor and recipient are members of. (Membership is the LIV-10/LIV-11 perimeter.)
      const [a, b] = await Promise.all([
        admin.from('conversation_members').select('conversation_id').eq('user_id', actor),
        admin.from('conversation_members').select('conversation_id').eq('user_id', recipient),
      ]);
      const mine = new Set((a.data ?? []).map((r: { conversation_id: string }) => r.conversation_id));
      return (b.data ?? []).some((r: { conversation_id: string }) => mine.has(r.conversation_id));
    }

    case 'friend_request': {
      // A PENDING request from actor -> recipient must exist (written by
      // send_friend_request). Without this, any authenticated user could push
      // "X sent you a friend request" to anyone — the prime spam vector. friendships is
      // canonically ordered by _friendship_pair, so the OR covers both column orderings;
      // requested_by pins the direction to the actor.
      const { count } = await admin
        .from('friendships')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
        .eq('requested_by', actor)
        .or(`and(user_a_id.eq.${actor},user_b_id.eq.${recipient}),and(user_a_id.eq.${recipient},user_b_id.eq.${actor})`);
      return (count ?? 0) > 0;
    }

    case 'friend_accepted':
    case 'jam_started':
    case 'jam_join':
    case 'jam_ended': {
      // An ACCEPTED friendship must exist between the two (either direction). Columns are
      // user_a_id / user_b_id (verified against the schema), status = 'accepted'.
      const { count } = await admin
        .from('friendships')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'accepted')
        .or(`and(user_a_id.eq.${actor},user_b_id.eq.${recipient}),and(user_a_id.eq.${recipient},user_b_id.eq.${actor})`);
      return (count ?? 0) > 0;
    }

    case 'new_follower':
    case 'new_fan': {
      // A star edge actor -> recipient must exist. `follows.kind` is always 'star' on this
      // project (there is no plain follow), so new_follower and new_fan are the same edge.
      const { count } = await admin
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('follower_id', actor)
        .eq('following_id', recipient);
      return (count ?? 0) > 0;
    }

    case 'activity_like':
    case 'activity_comment':
    case 'activity_repost': {
      // SECONDARY, coarse gate. The legitimate dispatch already passed activity_notify_post
      // (a SECURITY DEFINER RPC that derives the recipient and authorizes the action), and
      // the client args carry no post id (routing param is just 'ActivityCenter'), so this
      // function cannot re-prove the specific like/comment/repost. It requires only that the
      // recipient is a real author. The durable fix is D-45. Accepted for launch 2026-07-23.
      const { count } = await admin
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('author_id', recipient);
      return (count ?? 0) > 0;
    }

    default:
      return false; // deny-by-default, incl. unknown kinds
  }
}

// Best-effort per-actor rate limit. This in-memory map does NOT survive across edge
// isolates and is therefore advisory only. A durable limit needs a shared store
// (a `push_rate_limit` table with a unique (actor, minute) upsert). Tracked: D-12.
const recentByActor = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
function checkRateLimit(actor: string): boolean {
  const now = Date.now();
  const hits = (recentByActor.get(actor) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) return false;
  hits.push(now);
  recentByActor.set(actor, hits);
  return true;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // 1. AUTHENTICATION — resolve the actor from the JWT, not the body.
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'missing_bearer' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // A user-scoped client just to resolve the caller identity from their JWT.
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? serviceKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: authErr } = await asUser.auth.getUser();
  const actor = userData?.user?.id;
  if (authErr || !actor) return json(401, { error: 'invalid_token' });

  // 2. Parse + validate input.
  let payload: PushRequest;
  try { payload = await req.json(); } catch { return json(400, { error: 'bad_json' }); }

  const recipient = payload.recipientUserId;
  const kind = payload.kind ?? '';
  if (!isValidRecipient(recipient)) return json(400, { error: 'bad_recipient' });
  if (!isValidKind(kind)) return json(400, { error: 'bad_kind' });

  if (!checkRateLimit(actor)) return json(429, { error: 'rate_limited' });

  // 3. AUTHORIZATION — service-role client; these reads ARE the perimeter.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const allowed = await authorize(admin, kind, actor, recipient);
  if (!allowed) return json(403, { error: 'not_authorized' });

  // 4. Look up the recipient's device tokens.
  const { data: tokenRows, error: tokErr } = await admin
    .from('device_tokens')
    .select('token, platform')
    .eq('user_id', recipient);
  if (tokErr) return json(500, { error: 'token_lookup_failed', detail: tokErr.message });
  const tokens = (tokenRows ?? []).map((r: { token: string }) => r.token).filter(Boolean);
  if (tokens.length === 0) return json(200, { ok: true, sent: 0, reason: 'no_tokens' });

  // 5. Build the DATA-ONLY FCM payload the client's notifee renderer expects. All FCM
  // data values must be strings. `route` + flattened params drive tap-routing.
  // Copy. message/reaction/activity_*/milestone carry client-supplied text; the
  // relationship + jam kinds send none and expect the server to fill it from the
  // actor's name (else the notification arrives blank — LIV-9 device test, 2026-07-23).
  let title = clamp(payload.title, 120);
  let body = clamp(payload.body, MAX_BODY);
  if (!title || !body) {
    const { data: prof } = await admin
      .from('profiles').select('display_name, username').eq('id', actor).maybeSingle();
    const actorName = ((prof?.display_name as string) || (prof?.username as string) || 'Someone');
    if (!title) title = actorName;
    if (!body) body = defaultBody(kind);
  }

  const data: Record<string, string> = {
    kind,
    channelId: channelFor(kind),
    title,
    body,
    actorUserId: actor,
  };
  if (payload.data?.route) data.route = payload.data.route;
  for (const [k, v] of Object.entries(payload.data?.params ?? {})) {
    if (typeof v === 'string' && k !== 'route') data[k] = v;
  }

  // 6. Send via FCM HTTP v1, and prune dead tokens.
  const accessToken = await getFcmAccessToken();
  const projectId = Deno.env.get('FCM_PROJECT_ID')!;
  const endpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  let sent = 0;
  const deadTokens: string[] = [];
  await Promise.all(tokens.map(async (token: string) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message: { token, data, android: { priority: 'high' } } }),
    });
    if (res.ok) { sent++; return; }
    // 404 UNREGISTERED / 400 INVALID_ARGUMENT on a token → prune it.
    if (res.status === 404 || res.status === 400) deadTokens.push(token);
  }));

  if (deadTokens.length > 0) {
    await admin.from('device_tokens').delete().in('token', deadTokens);
  }

  return json(200, { ok: true, sent, pruned: deadTokens.length });
}

// ── FCM HTTP v1 auth: mint an access token from the service account (RS256 JWT). ──
// The legacy `key=` server-key API was decommissioned (2024), so v1 + OAuth2 is required.
async function getFcmAccessToken(): Promise<string> {
  const clientEmail = Deno.env.get('FCM_CLIENT_EMAIL')!;
  const privateKeyPem = (Deno.env.get('FCM_PRIVATE_KEY') ?? '').replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(claim)}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sig}`,
    }),
  });
  if (!res.ok) throw new Error(`fcm_token_failed: ${res.status}`);
  const tok = await res.json();
  return tok.access_token as string;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
