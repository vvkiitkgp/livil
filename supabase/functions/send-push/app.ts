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
//     So this function MUST NOT send a top-level `notification` block — that is
//     cross-platform, and Android would auto-display a second, unstyled card.
//     The `apns` block added in step 6 is NOT that: it is iOS-only and invisible to
//     Android tokens. iOS needs it because iOS has no equivalent of Android's headless
//     data-message wake-up — a data-only push there displays nothing at all.
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

// The kinds a client may emit. Anything else is rejected.
//
// 14 come from pushDispatch.ts on the mobile app. `badge_granted` is the first that comes
// from the OPS DASHBOARD instead: a badge is awarded by an operator on the web, not by
// anything happening on the recipient's device, so there is no phone in the loop to
// dispatch it the way every other kind is dispatched.
export const KINDS = new Set([
  'friend_request', 'friend_accepted', 'new_follower', 'new_fan', 'message',
  'reaction', 'jam_invite_dm', 'jam_started', 'jam_join', 'jam_ended',
  'activity_like', 'activity_comment', 'activity_repost', 'activity_milestone',
  'badge_granted',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// notifee channels the client actually created (ensureChannels in pushNotifications.ts):
// 'social', 'activity', 'messages', 'jam'.
export function channelFor(kind: string): string {
  if (kind === 'message' || kind === 'reaction') return 'messages';
  if (kind.startsWith('jam_')) return 'jam';
  // Explicit rather than a prefix match: badge_granted lands in the activity feed and
  // belongs on the same channel, but it does not carry the `activity_` prefix.
  if (kind.startsWith('activity_') || kind === 'badge_granted') return 'activity';
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
    // Deliberately generic. The dashboard sends its own title/body naming the badge; this
    // is only the floor if it ever stops doing so, and naming a badge we did not verify
    // here would be asserting something this function cannot check.
    case 'badge_granted': return 'You received a badge on Livil';
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

// ── Per-category preference. ALLOW BY DEFAULT. ─────────────────────────────
// Whether the recipient has switched this kind's category off in Livil's settings.
//
// Note the polarity is the opposite of authorize(): that one denies by default because
// it is a security perimeter, this one ALLOWS by default because it is a preference. An
// absent row, an unreadable table, or a null column all mean "no objection" — a user who
// has never touched the setting must keep receiving notifications, and a transient
// database error must not silently stop delivery. Only an explicit `false` suppresses.
//
// Selects all four columns and indexes in JS rather than interpolating the category into
// .select(). channelFor() only ever returns one of four literals so either is safe today,
// but a fixed select cannot become an injection point if that ever stops being true.
export async function isCategoryMuted(
  admin: SupabaseClient,
  recipient: string,
  kind: string,
): Promise<boolean> {
  const category = channelFor(kind);
  const { data, error } = await admin
    .from('notification_preferences')
    .select('social, activity, messages, jam')
    .eq('user_id', recipient)
    .maybeSingle();

  if (error || !data) return false;
  return (data as Record<string, unknown>)[category] === false;
}

/**
 * Who may announce a badge, and about whom.
 *
 * TWO CONDITIONS, BOTH REQUIRED — and they do different jobs:
 *
 *   1. THE AUTHORIZATION. The actor is in `ops_users`. Granting is ops-only at the
 *      database level (`grant_badge` raises `not_authorized` otherwise), so anyone else
 *      sending this is describing something they could not have done. This condition, and
 *      only this one, is what closes the spam vector.
 *   2. TRACEABILITY, not authorization — worth being precise, because the next reader will
 *      take this as a reason to look no further. The recipient must hold a live badge. An
 *      operator determined to lie controls both sides (grant, push, revoke), so this cannot
 *      stop them. What it buys is that a false announcement leaves a RECORD: awarded_by,
 *      revoked_by, a consumed slot on a capped badge, and an in-app notice written by
 *      notify_badge_granted. Worth keeping for that, not for the gate.
 *
 * `admin` is the service-role client, so both reads bypass RLS — which is the point:
 * `ops_users` and `profile_badges` are both deny-all, and neither is readable by the
 * operator's own session. This check IS the perimeter, not a convenience.
 *
 * FAILS CLOSED. A missing row yields count 0; an errored read yields null, and `?? 0`
 * turns that into a denial. That polarity is deliberate and is the opposite of
 * isCategoryMuted below, which allows by default — a preference that fails closed silences
 * someone with no error, whereas an authorization that fails open lets anyone in.
 *
 * DOES NOT CHECK WHICH BADGE. An ops caller who can grant `verified` outright gains nothing
 * by mislabelling it, so checking the specific badge would buy precision, not security. (It
 * would be safe to add — a `.eq('badge', …)` NARROWS the query, so a caller naming a badge
 * the recipient lacks is denied. It is simply not load-bearing.)
 */
async function authorizeBadgeGranted(
  admin: SupabaseClient,
  actor: string,
  recipient: string,
): Promise<boolean> {
  const [ops, badge] = await Promise.all([
    admin.from('ops_users').select('user_id', { count: 'exact', head: true }).eq('user_id', actor),
    admin
      .from('profile_badges')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', recipient)
      .is('revoked_at', null),
  ]);
  return (ops.count ?? 0) > 0 && (badge.count ?? 0) > 0;
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
  // CHECKED BEFORE THE SELF-TARGET SHORTCUT, deliberately, and it is the only kind that
  // is. `selfTargetAllowed` is a heuristic standing in for "we have no stronger check" —
  // for a badge we do: the actor must be an operator, and the recipient must really hold
  // the badge. Both are verifiable facts, and both are strictly stronger than the
  // heuristic. Letting the shortcut run first would mean an operator granting a badge to
  // THEMSELVES (which happens — the first account tested with is usually your own) fell
  // through to `selfTargetAllowed('badge_granted')`, and whichever way that answered would
  // be wrong: false breaks a legitimate grant, true lets ANY signed-in user push
  // themselves a fake badge notice.
  //
  // THE UNCONDITIONAL RETURN IS LOAD-BEARING. Change this to fall through on false —
  // `if (kind === 'badge_granted' && await authorizeBadgeGranted(...)) return true;` — and
  // a denied self-targeting call drops into the shortcut below, where selfTargetAllowed
  // answers instead. The whole argument above inverts.
  if (kind === 'badge_granted') {
    return await authorizeBadgeGranted(admin, actor, recipient);
  }

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

  // 3b. PREFERENCE — the recipient may have switched this category off. Checked after
  // authorization (so an unauthorized actor still learns nothing) and before the token
  // lookup and FCM call, which is the point of doing it server-side: a muted category
  // costs no send and never wakes the device. Android channels cannot do this — the OS
  // suppresses display only after delivery, and gives iOS nothing at all.
  if (await isCategoryMuted(admin, recipient, kind)) {
    return json(200, { ok: true, sent: 0, reason: 'category_muted' });
  }

  // 4. Look up the recipient's device tokens.
  const { data: tokenRows, error: tokErr } = await admin
    .from('device_tokens')
    .select('token, platform')
    .eq('user_id', recipient);
  if (tokErr) return json(500, { error: 'token_lookup_failed', detail: tokErr.message });
  const tokens = (tokenRows ?? []).map((r: { token: string }) => r.token).filter(Boolean);
  if (tokens.length === 0) return json(200, { ok: true, sent: 0, reason: 'no_tokens' });
  // `platform` is selected above and, until now, discarded. It earns its place here:
  // the badge count below is an extra database round-trip that ONLY iOS can use.
  const hasIosToken = (tokenRows ?? [])
    .some((r: { platform?: string | null }) => r.platform === 'ios');

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
  };
  // WITHHELD FOR badge_granted, and only for it. notify_badge_granted writes the in-app
  // notification with a NULL actor on purpose — a badge comes from Livil, and which staff
  // account granted it is ops-only (it lives in profile_badges.awarded_by). Shipping the
  // operator's uuid in the push payload would undo that at the transport: the client copies
  // every string key into tapData, and `profiles` is readable by any authenticated user, so
  // resolving it names an operator. `ops_users` is deny-all precisely so the roster is not
  // enumerable.
  //
  // Nothing consumes it for this kind: the chat-grouping fallback that reads actorUserId is
  // inside a CHAT_KINDS branch badge_granted never enters, and the APNs thread-id already
  // falls back to `kind`.
  if (kind !== 'badge_granted') { data.actorUserId = actor; }
  if (payload.data?.route) data.route = payload.data.route;
  for (const [k, v] of Object.entries(payload.data?.params ?? {})) {
    if (typeof v === 'string' && k !== 'route') data[k] = v;
  }

  // 5b. The iOS home-screen badge number.
  //
  // iOS cannot count for itself: the badge is whatever the payload says it is, and the
  // app is not running to work it out. So the SENDER has to know the recipient's unread
  // total, which only the database can answer -- see the `unread_badge_count_for` SQL
  // function (20260914000000_unread_badge_count.sql).
  //
  // Android needs nothing here: it has no badge-setting API and derives the number from
  // the notifications in the tray (src/services/appBadge.ts).
  //
  // Deliberately fail-safe, matching how this file already treats the preference read: a
  // missing badge is a cosmetic bug, a dropped notification is a real one. If the count
  // fails we send without it and iOS leaves the existing number alone.
  //
  // Skipped entirely when the recipient has no iOS device, which today is almost all of
  // them: three COUNT(*)s per notification is not a price to pay for a field nothing
  // will read.
  const badge = hasIosToken ? await unreadBadgeCount(admin, recipient) : null;

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
      body: JSON.stringify({
        message: {
          token,
          data,
          android: { priority: 'high' },
          // iOS-only; FCM drops it for Android tokens, so one payload serves both.
          // `thread-id` is the iOS analogue of the Android `groupId`/merged chat card:
          // it collapses a conversation's notifications into one stack instead of a
          // column of identical rows.
          apns: {
            headers: { 'apns-priority': '10' },
            payload: {
              aps: {
                alert: { title, body },
                sound: 'default',
                'thread-id': data.conversationId ?? kind,
                ...(badge === null ? {} : { badge }),
              },
            },
          },
        },
      }),
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

// ── The recipient's unread total, for the iOS badge. ────────────────────────────────
// service_role is the ONLY role granted EXECUTE on this function: it takes an arbitrary
// user id, so exposing it to clients would let anyone read anyone's unread counts. See
// the migration's grants.
//
// Never throws. A badge is cosmetic; the notification is not.
async function unreadBadgeCount(
  // deno-lint-ignore no-explicit-any
  admin: any,
  userId: string,
): Promise<number | null> {
  try {
    const { data, error } = await admin.rpc('unread_badge_count_for', { p_user_id: userId });
    if (error) return null;
    const n = Number(data);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  } catch {
    return null;
  }
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
