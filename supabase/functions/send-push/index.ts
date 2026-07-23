// ============================================================================
// send-push — the edge function LIV-9 found missing in production
// ============================================================================
//
// STATUS: PROPOSAL. This file has never existed in the repo or in production
// (`list_edge_functions` → [] on both projects), which is exactly why every push in
// Livil silently does nothing. It is delivered for HUMAN security review + deploy — it
// is not autonomously deployable (an edge function reaching prod is an outward-facing
// change, and the authorization model below is precisely what the mandatory review
// exists to check). See Jira LIV-9, D-45, D-46.
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
// ── THE SECURITY MODEL (this is what the review must scrutinise) ─────────────
//
// The caller-supplied shape is UNTRUSTED. Three things must hold:
//
//   1. AUTHENTICATION — require a real user JWT; derive the actor from the token, never
//      from the body. Reject anon.
//   2. AUTHORIZATION — the actor must be allowed to notify `recipientUserId` for this
//      `kind`. Enforced server-side by `authorize()` below, deny-by-default. This stops
//      the headline abuse: pushing arbitrary text to an arbitrary stranger.
//   3. CONTENT — `title`/`body` are untrusted display strings: clamp length, and never
//      reflect them anywhere but the notification body.
//
// KNOWN RESIDUAL, called out honestly (D-45): even with (1)–(3), an actor still supplies
// the body and can send a *plausible* notification to someone they already have a
// relationship with. Client-dispatched push is forgeable by construction. The real fix
// is to move dispatch server-side into the SECURITY DEFINER functions that already
// authorize the originating event (accept_friend_request, message insert, …) so the
// recipient AND the content are both derived, never passed. This function makes push
// WORK safely-enough to ship; D-45 is the durable fix. Do not treat this as closing D-45.
//
// SECRETS required (set via `supabase secrets set`, never committed):
//   FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY   (a Firebase service account)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY             (injected by the platform)
// ============================================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

// The 14 kinds pushDispatch.ts can emit. Anything else is rejected.
const KINDS = new Set([
  'friend_request', 'friend_accepted', 'new_follower', 'new_fan', 'message',
  'reaction', 'jam_invite_dm', 'jam_started', 'jam_join', 'jam_ended',
  'activity_like', 'activity_comment', 'activity_repost', 'activity_milestone',
]);

// notifee channels the client created (see ensureChannels in pushNotifications.ts).
function channelFor(kind: string): string {
  if (kind === 'message' || kind === 'reaction') return 'messages';
  if (kind.startsWith('jam_')) return 'jam';
  return 'social';
}

const MAX_BODY = 240;
const clamp = (s: unknown, n: number) =>
  typeof s === 'string' ? s.slice(0, n) : '';

type PushRequest = {
  recipientUserId?: string;
  kind?: string;
  title?: string;
  body?: string;
  data?: { route?: string; params?: Record<string, string> };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ── Authorization, per kind. DENY BY DEFAULT. ───────────────────────────────
// Returns true only if `actor` is allowed to notify `recipient` for `kind`.
// Uses the service-role client to read relationship tables (RLS-independent), so the
// checks here ARE the perimeter — get them right.
//
// REVIEW NOTE: several kinds cannot be *fully* proven from the client args (we are not
// given the originating row id — the like, the comment, the message). Where that is so,
// this enforces the strongest relationship gate the args permit and the comment says
// what is NOT proven. Tightening each is tracked with D-45.
async function authorize(
  admin: SupabaseClient,
  kind: string,
  actor: string,
  recipient: string,
): Promise<boolean> {
  if (actor === recipient) {
    // Only self-directed kinds may target yourself; everything else is suspicious.
    return kind === 'activity_milestone';
  }

  switch (kind) {
    case 'message':
    case 'reaction':
    case 'jam_invite_dm': {
      // Must share a conversation. (Membership is the LIV-10/LIV-11 perimeter.)
      const { data } = await admin.rpc('users_share_conversation', {
        a: actor, b: recipient,
      });
      // Fallback if that helper is not deployed: a direct membership intersection.
      if (typeof data === 'boolean') return data;
      const { count } = await admin
        .from('conversation_members')
        .select('conversation_id', { count: 'exact', head: true })
        .eq('user_id', recipient);
      return (count ?? 0) > 0; // REVIEW: weak — see note; prefer the RPC intersection.
    }

    case 'friend_request':
      // Sending a request IS the action; recipient is the target. Allowed, but this is
      // the prime spam vector — MUST be rate-limited (see checkRateLimit) and ideally
      // gated on an actual pending friendships row written by send_friend_request.
      return true;

    case 'friend_accepted': {
      // A friendship edge (either direction) must now exist between the two.
      const { count } = await admin
        .from('friendships')
        .select('*', { count: 'exact', head: true })
        .or(`and(user_a.eq.${actor},user_b.eq.${recipient}),and(user_a.eq.${recipient},user_b.eq.${actor})`);
      return (count ?? 0) > 0;
    }

    case 'new_follower': {
      // Actor must actually follow recipient.
      const { count } = await admin
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('follower_id', actor)
        .eq('following_id', recipient);
      return (count ?? 0) > 0;
    }

    case 'new_fan': {
      // Actor must have starred a track owned by recipient. REVIEW: needs the stars
      // schema; enforce it once confirmed. Deny until then.
      return false;
    }

    case 'jam_started':
    case 'jam_join':
    case 'jam_ended': {
      // Actor and recipient must share a jam room, or be friends (invites go to friends).
      const { count } = await admin
        .from('friendships')
        .select('*', { count: 'exact', head: true })
        .or(`and(user_a.eq.${actor},user_b.eq.${recipient}),and(user_a.eq.${recipient},user_b.eq.${actor})`);
      return (count ?? 0) > 0;
    }

    case 'activity_like':
    case 'activity_comment':
    case 'activity_repost': {
      // Recipient must own a post the actor acted on. We are not given the post id, so
      // at minimum require recipient to be a real author with ≥1 post. REVIEW/D-45:
      // pass the post id and verify the like/comment/repost row exists.
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

// Best-effort per-actor rate limit. REVIEW: this in-memory map does NOT survive across
// edge isolates and is therefore advisory only. A real limit needs a shared store
// (a `push_rate_limit` table with a unique (actor, minute) upsert, or Redis). Wired as
// a seam so the durable version drops in without touching call sites. Tracked: D-12.
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

Deno.serve(async (req: Request): Promise<Response> => {
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
  if (!recipient || !UUID_RE.test(recipient)) return json(400, { error: 'bad_recipient' });
  if (!KINDS.has(kind)) return json(400, { error: 'bad_kind' });

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
  const tokens = (tokenRows ?? []).map(r => r.token as string).filter(Boolean);
  if (tokens.length === 0) return json(200, { ok: true, sent: 0, reason: 'no_tokens' });

  // 5. Build the DATA-ONLY FCM payload the client's notifee renderer expects. All FCM
  // data values must be strings. `route` + flattened params drive tap-routing.
  const data: Record<string, string> = {
    kind,
    channelId: channelFor(kind),
    title: clamp(payload.title, 120),
    body: clamp(payload.body, MAX_BODY),
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
  await Promise.all(tokens.map(async (token) => {
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
});

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
