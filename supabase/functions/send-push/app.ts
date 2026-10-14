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
// The caller-supplied shape is UNTRUSTED. Four things must hold:
//   1. AUTHENTICATION — require a real user JWT; derive the actor from the token, never
//      from the body. Reject anon.
//   2. AUTHORIZATION — the actor must be allowed to notify `recipientUserId` for this
//      `kind`. Enforced server-side by `authorize()`, deny-by-default. Where the event
//      leaves a row behind (activity_*, a conversation, a jam room), authorize() finds
//      that row and returns it as a `Grant`; the relationship alone is not enough.
//   3. CONTENT IS SERVER-DERIVED — the caller names WHO and WHAT KIND. What the
//      notification SAYS, and WHERE a tap opens, are built here from the Grant and the
//      actor's profile (`buildPush`). Caller `title` is ignored for every kind; caller
//      `body` is read for exactly two: a chat `message` preview (the one kind whose text IS
//      the caller's, bounded by conversation membership and attributed to the actor) and
//      the emoji of a `reaction` (parsed and validated, never copied). `data.params` are
//      CLAIMS to verify (conversationId, jamRoomId), never keys to copy, so no caller
//      string can overwrite `kind`/`channelId`/`title`/`body`/`route` or add `actor*`.
//   4. BLOCKS — a block stops every person-to-person push in both directions, group
//      conversations included, and does so silently: the response is identical to a
//      delivered one, because telling the blocked person would hand a harasser the signal
//      blocked_users hides from them.
//
// KNOWN RESIDUAL (D-45): a conversation member can still push a `message` preview that
// was never sent as a message, to people they share that conversation with. It is titled
// with their own name (or the group's) and prefixed with their handle in a group. Unlike a
// real message it reaches only the recipient and leaves no record in the conversation.
// Blocks apply here too, so it cannot reach someone who blocked the actor. The durable fix
// is dispatch from inside the message insert (or requiring the actor's messages row as
// evidence); do not treat this as closing D-45.
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

const MAX_TITLE = 120;
const MAX_BODY = 240;
/**
 * The first `n` UTF-16 units of `s`, minus a trailing high surrogate the cut would strand:
 * a lone half of an emoji is not valid Unicode and reaches the phone as a broken glyph.
 */
export function sliceWhole(s: string, n: number): string {
  const cut = s.slice(0, n);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

export const clamp = (s: unknown, n: number) =>
  typeof s === 'string' ? sliceWhole(s, n) : '';

/**
 * How far back authorize() looks for the row an event left behind. The legitimate push is
 * sent the moment the RPC that wrote the row returns, so seconds would do; ten minutes
 * absorbs a slow network and clock skew between the edge and the database. Inside the
 * window the same evidence can be presented more than once — a repeat says the same
 * server-written, true thing, and is bounded only by the advisory rate limit (D-12).
 */
const EVIDENCE_WINDOW_MS = 10 * 60_000;

// Server-side copy for the relationship/jam kinds, which no client has ever sent text
// for. The notification title is the actor's display name, so these read as
// "<Actor> <body>".
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
    // The floor when the holder's newest live badge cannot be read or is one this file has
    // no label for (see BADGE_LABELS). Generic on purpose: naming a badge we did not read
    // would be asserting something this function has not checked.
    case 'badge_granted': return 'You received a badge on Livil';
    default: return 'sent you a notification';
  }
}

export const isValidKind = (k: string): boolean => KINDS.has(k);
export const isValidRecipient = (r: unknown): r is string =>
  typeof r === 'string' && UUID_RE.test(r);
const isUuid = isValidRecipient;

/**
 * The kinds that are one person contacting another — the kinds a block stops. The two left
 * out are notices FROM Livil: the listener whose play crossed a milestone is not talking
 * to the author, and a badge is announced by staff, not by a person on either side of a
 * block.
 *
 * Group conversations are included. The database still lets a blocked pair post in a group
 * they share (dm_blocked_for_sender bars only the DM, so a block never degrades the group
 * for everyone else), but a push reaches one person only: the blocker no longer gets buzzed
 * by the person they blocked, and that person cannot send them a group "message" preview
 * that never appears in the group (D-45). The message itself still lands in the group.
 */
export const isPersonToPerson = (kind: string): boolean =>
  kind !== 'activity_milestone' && kind !== 'badge_granted';

/** The request body. Every field is a claim; nothing here is copied into a notification. */
export type PushRequest = {
  recipientUserId?: unknown;
  kind?: unknown;
  title?: unknown;
  body?: unknown;
  data?: { route?: unknown; params?: Record<string, unknown> | null } | null;
};

/**
 * What authorize() proved, beyond "this actor may notify this recipient for this kind".
 * Only these facts, never the caller's strings, decide what the notification says and
 * where a tap opens.
 */
export type Grant = {
  /** The one conversation BOTH people are members of (message / reaction / jam_invite_dm). */
  conversation?: { id: string; kind: 'dm' | 'group'; name: string | null };
  /** A jam room that belongs to that conversation (jam_invite_dm). */
  jamRoomId?: string;
  /**
   * The row activity_notify_post wrote for this like / comment / repost. `postId` is that
   * row's post — the recipient's own — and is what `post` is looked up from.
   */
  activity?: { aggCount: number; commentText: string | null; postId?: string | null };
  /**
   * What the push names: the liked post's song, looked up after authorization from
   * `activity.postId` (see describePost). Absent → the copy says "your post", as before.
   */
  post?: PostSubject;
  /** The threshold activity_record_play recorded (activity_milestone). */
  milestone?: number;
  /** The holder's newest live badge key, or null when it could not be read (badge_granted). */
  badge?: string | null;
};

/** The parts of the request authorize() verifies rather than trusts. */
export type Claims = { conversationId?: unknown; jamRoomId?: unknown };

/** The two ids in `data.params` that are read at all — as claims, never as content. */
export function claimsFrom(payload: PushRequest): Claims {
  const params = payload.data?.params;
  return params && typeof params === 'object'
    ? { conversationId: params.conversationId, jamRoomId: params.jamRoomId }
    : {};
}

/**
 * CORS, needed only because a BROWSER now calls this.
 *
 * Every caller until badge_granted was React Native, which issues no preflight — so the
 * function never handled OPTIONS and nobody noticed. The ops dashboard is a browser: it
 * sends `OPTIONS` first, got `405 method_not_allowed`, and never sent the POST at all.
 * Observed in production as two 405s exactly matching two badge grants, with no error
 * anywhere on the client because a failed preflight is not an application error.
 *
 * `*` is correct here rather than lax: the function authenticates from the Authorization
 * header on every request and authorizes per kind, so the origin is not part of the
 * perimeter. Allowing one origin would only mean re-deploying whenever the dashboard moves
 * between localhost, a Vercel preview and production — three origins that are all the same
 * caller. Note this endpoint is not cookie-authenticated, so `*` carries none of the
 * credentialed-request risk it would on a session-cookie API.
 */
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
};

function json(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
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
// Returns the Grant (what it proved) only if `actor` is allowed to notify `recipient` for
// `kind`, else null. Uses the service-role client to read relationship tables
// (RLS-independent), so the checks here ARE the perimeter. `actor` (from the JWT) and
// `recipient` (UUID-validated in handler) are both strict UUIDs before interpolation into
// the PostgREST `.or()` filter; claimed ids are UUID-checked and only ever passed to
// `.eq()` / `.in()`, never interpolated.
//
// Every read fails CLOSED: an errored PostgREST call resolves to `{ data: null }` /
// `{ count: null }` rather than throwing, and each branch treats that as "no evidence".
export async function authorize(
  admin: SupabaseClient,
  kind: string,
  actor: string,
  recipient: string,
  claims: Claims = {},
): Promise<Grant | null> {
  // CHECKED BEFORE THE SELF-TARGET REFUSAL, deliberately, and it is the only kind that is.
  // An operator granting a badge to THEMSELVES happens routinely (the first account tested
  // with is usually your own), and for a badge there is a stronger check than "is this
  // self-targeted": the actor must be an operator, and the recipient must really hold the
  // badge. Letting the refusal below run first would break that legitimate grant.
  //
  // THE UNCONDITIONAL RETURN IS LOAD-BEARING. Change this to fall through on a denial and a
  // denied badge_granted call drops into the switch below — today that ends in the default
  // deny, but only by accident of the switch having no badge case.
  if (kind === 'badge_granted') {
    if (!(await authorizeBadgeGranted(admin, actor, recipient))) return null;
    return { badge: await newestLiveBadge(admin, recipient) };
  }

  // No other kind is ever legitimately sent to yourself. activity_milestone looked like
  // one, but activity_record_play only raises a milestone when the LISTENER is not the
  // author (`v_author <> v_actor`), so the push always crosses between two people.
  if (actor.toLowerCase() === recipient.toLowerCase()) return null;

  switch (kind) {
    case 'message':
    case 'reaction':
    case 'jam_invite_dm': {
      // Both people must be members of THE conversation the push names — not merely of
      // some conversation in common. Every shipped build sends conversationId for these
      // three kinds (verified back to the first push build, 46a687c). The id then drives
      // the tap target and the iOS thread, so it must be one the recipient can open.
      // (Membership is the LIV-10/LIV-11 perimeter.)
      const conversation = await sharedConversation(admin, claims.conversationId, actor, recipient);
      if (!conversation) return null;
      if (kind !== 'jam_invite_dm') return { conversation };

      // The invite opens a jam room, so the room must be one that conversation started.
      if (!isUuid(claims.jamRoomId)) return null;
      const jamRoomId = claims.jamRoomId.toLowerCase();
      const { count } = await admin
        .from('jam_rooms')
        .select('id', { count: 'exact', head: true })
        .eq('id', jamRoomId)
        .eq('conversation_id', conversation.id);
      return (count ?? 0) > 0 ? { conversation, jamRoomId } : null;
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
      return (count ?? 0) > 0 ? {} : null;
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
      return (count ?? 0) > 0 ? {} : null;
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
      return (count ?? 0) > 0 ? {} : null;
    }

    case 'activity_like':
      return await authorizeLike(admin, actor, recipient);

    case 'activity_comment':
    case 'activity_repost':
      return await authorizeCommentOrRepost(
        admin,
        kind === 'activity_comment' ? 'comment' : 'repost',
        actor,
        recipient,
      );

    case 'activity_milestone':
      return await authorizeMilestone(admin, actor, recipient);

    default:
      return null; // deny-by-default, incl. unknown kinds
  }
}

/** How close the actor's play must be to the milestone row it crossed. See authorizeMilestone. */
const MILESTONE_PLAY_SKEW_MS = 1_000;

const evidenceSince = (): string => new Date(Date.now() - EVIDENCE_WINDOW_MS).toISOString();

/**
 * The conversation `conversationId` names, if BOTH people are members of it.
 *
 * One query for the two membership rows (the primary key is (conversation_id, user_id),
 * so it is an index lookup) and one for the conversation's kind and name, which become the
 * notification's title. A missing conversation row is a denial, not a default: a title we
 * cannot read is a conversation we cannot vouch for.
 */
async function sharedConversation(
  admin: SupabaseClient,
  conversationId: unknown,
  actor: string,
  recipient: string,
): Promise<Grant['conversation'] | null> {
  if (!isUuid(conversationId)) return null;
  // Lowercased so the id echoed into the tap target and the iOS thread matches the
  // database's own spelling. Postgres compares uuids case-insensitively; this file's
  // string comparisons do not.
  const id = conversationId.toLowerCase();
  const [members, conv] = await Promise.all([
    admin
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', id)
      .in('user_id', [actor, recipient]),
    admin.from('conversations').select('kind, name').eq('id', id).maybeSingle(),
  ]);
  const ids = new Set((members.data ?? []).map((r: { user_id: string }) => r.user_id));
  if (!ids.has(actor) || !ids.has(recipient)) return null;

  const row = conv.data as { kind?: unknown; name?: unknown } | null;
  if (!row || (row.kind !== 'dm' && row.kind !== 'group')) return null;
  return {
    id,
    kind: row.kind,
    name: typeof row.name === 'string' && row.name.trim() ? row.name : null,
  };
}

/**
 * activity_like — the aggregated row activity_notify_post upserts for the liked post.
 *
 * That RPC is the real authorization: it refuses unless a post_likes row by the caller
 * exists, and it decides whether the owner should be pushed at all (once per person per
 * post, recipient_should_push). This re-finds its row. The post id is not in the request
 * (every shipped build routes to ActivityCenter with no params), so the match is
 * recipient + recent + this actor.
 *
 * "This actor" is either the row's actor_id or a member of payload.notified. actor_id
 * alone would refuse a legitimate push that loses a race: Sam liking the same post a
 * moment after Riya re-points actor_id at Sam before Riya's push arrives. notified is
 * appended in the same statement that sets actor_id, and only when a push is due.
 *
 * But notified is never pruned — an unlike leaves the name in it, and the 20260929010000
 * backfill seeded it with every liker of that day — so a match through notified alone
 * also requires the actor's like to still stand in post_likes. (A match through actor_id
 * needs no such check: activity_like_removed re-points actor_id away from an unliker.)
 *
 * agg_count <= 0 means every like on the post has since been taken back
 * (activity_like_removed), so there is nothing left to announce.
 */
async function authorizeLike(
  admin: SupabaseClient,
  actor: string,
  recipient: string,
): Promise<Grant | null> {
  const { data } = await admin
    .from('activity_notifications')
    .select('actor_id, post_id, agg_count, payload')
    .eq('recipient_id', recipient)
    .eq('type', 'like')
    .gte('updated_at', evidenceSince())
    .order('updated_at', { ascending: false })
    .limit(25);
  type LikeRow = { actor_id: unknown; post_id: unknown; agg_count: unknown; payload: unknown };
  const row = ((data ?? []) as LikeRow[])
    .find(r => r.actor_id === actor || notifiedIncludes(r.payload, actor));
  const aggCount = Number(row?.agg_count);
  if (!row || !Number.isFinite(aggCount) || aggCount <= 0) return null;

  if (row.actor_id !== actor) {
    if (!isUuid(row.post_id)) return null;
    const { count } = await admin
      .from('post_likes')
      .select('post_id', { count: 'exact', head: true })
      .eq('post_id', row.post_id)
      .eq('user_id', actor);
    if ((count ?? 0) <= 0) return null;
  }
  return {
    activity: {
      aggCount: Math.floor(aggCount),
      commentText: null,
      postId: isUuid(row.post_id) ? row.post_id : null,
    },
  };
}

function notifiedIncludes(payload: unknown, actor: string): boolean {
  const notified = (payload as { notified?: unknown } | null)?.notified;
  return Array.isArray(notified) && notified.includes(actor);
}

/**
 * activity_comment / activity_repost — activity_notify_post inserts a fresh row per event,
 * after checking the caller really wrote a comment on, or reposted, the recipient's post.
 * The comment snippet comes from that row's payload, which the RPC read from the stored
 * comment rather than from its parameter — so it is text the actor really posted.
 */
async function authorizeCommentOrRepost(
  admin: SupabaseClient,
  type: 'comment' | 'repost',
  actor: string,
  recipient: string,
): Promise<Grant | null> {
  const { data } = await admin
    .from('activity_notifications')
    .select('payload, post_id')
    .eq('recipient_id', recipient)
    .eq('type', type)
    .eq('actor_id', actor)
    .gte('created_at', evidenceSince())
    .order('created_at', { ascending: false })
    .limit(1);
  const row = ((data ?? []) as Array<{ payload: unknown; post_id: unknown }>)[0];
  if (!row) return null;
  const text = (row.payload as { comment_text?: unknown } | null)?.comment_text;
  return {
    activity: {
      aggCount: 1,
      commentText: type === 'comment' && typeof text === 'string' && text.trim() ? text : null,
      postId: isUuid(row.post_id) ? row.post_id : null,
    },
  };
}

/**
 * activity_milestone — activity_record_play inserts a 'play_milestone' row (actor_id NULL,
 * payload.threshold) the moment a LISTENER's play crosses a threshold, and returns the
 * author for the client to push. Two facts are required: the milestone row exists and is
 * recent, and the actor's OWN play is the one that crossed it. The RPC inserts the
 * post_views row and the milestone row in one transaction, so both carry the same now();
 * a play of the actor's within a second of the milestone's created_at is that play. (A
 * second rather than exact equality, so timestamp formatting can never refuse a real
 * one.) Any recent play would not do: one account can add a play per second, so a
 * stranger could otherwise re-announce someone's milestone for the whole window.
 *
 * This kind was refused outright before: authorize() only allowed it self-targeted, which
 * that RPC never produces, so no milestone push had ever been delivered.
 */
async function authorizeMilestone(
  admin: SupabaseClient,
  actor: string,
  recipient: string,
): Promise<Grant | null> {
  const since = evidenceSince();
  const { data } = await admin
    .from('activity_notifications')
    .select('post_id, payload, created_at')
    .eq('recipient_id', recipient)
    .eq('type', 'play_milestone')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10);
  type Milestone = { postId: string; threshold: number; at: number };
  const milestones = ((data ?? []) as Array<{ post_id: unknown; payload: unknown; created_at: unknown }>)
    .map(r => ({
      postId: r.post_id,
      threshold: (r.payload as { threshold?: unknown } | null)?.threshold,
      at: typeof r.created_at === 'string' ? Date.parse(r.created_at) : NaN,
    }))
    .filter((m): m is Milestone =>
      isUuid(m.postId) && Number.isInteger(m.threshold) && (m.threshold as number) > 0 &&
      Number.isFinite(m.at));
  if (milestones.length === 0) return null;

  const { data: plays } = await admin
    .from('post_views')
    .select('post_id, played_at')
    .eq('user_id', actor)
    .in('post_id', milestones.map(m => m.postId))
    .gte('played_at', since)
    .limit(50);
  const myPlays = ((plays ?? []) as Array<{ post_id: unknown; played_at: unknown }>)
    .map(p => ({ postId: p.post_id, at: typeof p.played_at === 'string' ? Date.parse(p.played_at) : NaN }));
  const hit = milestones.find(m =>
    myPlays.some(p => p.postId === m.postId && Math.abs(p.at - m.at) <= MILESTONE_PLAY_SKEW_MS));
  return hit ? { milestone: hit.threshold } : null;
}

/**
 * The badge a badge_granted push announces: the holder's most recently awarded live one.
 * Read only AFTER authorizeBadgeGranted has passed, and only for the copy — a null (read
 * failed) falls back to defaultBody's generic line rather than refusing a grant that has
 * already been authorized.
 */
async function newestLiveBadge(admin: SupabaseClient, recipient: string): Promise<string | null> {
  const { data } = await admin
    .from('profile_badges')
    .select('badge')
    .eq('user_id', recipient)
    .is('revoked_at', null)
    .order('awarded_at', { ascending: false })
    .limit(1);
  const badge = ((data ?? []) as Array<{ badge?: unknown }>)[0]?.badge;
  return typeof badge === 'string' ? badge : null;
}

/**
 * Whether either person has blocked the other. Direction-agnostic, like the database's own
 * is_blocked_between(): a block severs contact whoever initiates it. Read with the
 * service-role client because blocked_users admits only the BLOCKER, so the blocked
 * caller's own session could never see the row that matters.
 *
 * Fails CLOSED (a read error counts as blocked): this is part of the perimeter, and the
 * cost of being wrong that way is one undelivered notification.
 */
export async function isBlockedBetween(
  admin: SupabaseClient,
  a: string,
  b: string,
): Promise<boolean> {
  const { count, error } = await admin
    .from('blocked_users')
    .select('blocker_id', { count: 'exact', head: true })
    .or(`and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`);
  if (error || typeof count !== 'number') {
    // Logged apart from a real block: if this read ever fails wholesale (a grant or a
    // column change), every person-to-person push stops, and "outcome: blocked" in the log
    // must not be the only trace of it.
    console.warn('[send-push] block check failed; push dropped', error?.message ?? 'no count');
    return true;
  }
  return count > 0;
}

// ── What the notification says, and where it opens. PURE. ───────────────────
// Everything below is built from the Grant and the actor's profile. The request is read in
// exactly two places — a message preview and a reaction's emoji — and both are bounded.

export type ActorProfile = {
  displayName: string | null;
  username: string | null;
  /**
   * The actor's photo for the Android notification's picture, ONLY when isAllowedAvatarUrl
   * accepted it — the recipient's phone fetches it unprompted. Null → no picture.
   */
  avatarUrl?: string | null;
};

/** The liked / commented / reposted post, as far as the push names it. */
export type PostSubject = {
  /** 'repost' covers Livil and Spotify reposts alike; an upload is the person's own track. */
  kind: 'upload' | 'repost';
  /** The song's title, or null when it could not be read (then the copy says "your post"). */
  title: string | null;
};

/** The kinds whose Android notification shows the actor's photo. */
const PHOTO_KINDS = new Set(['activity_like', 'activity_comment', 'activity_repost']);

/**
 * Whether a profile photo URL may ride in a push. Android's notification fetches it
 * without the recipient doing anything, so an arbitrary URL would let anyone who can set
 * their own avatar_url make every recipient's phone call a server of their choosing. Only
 * the two hosts production photos come from: this project's public `avatars` bucket, and
 * Google's account photos (Google sign-in). The same rule as the share page's images.
 */
export function isAllowedAvatarUrl(url: unknown, supabaseUrl: string): url is string {
  if (typeof url !== 'string' || url.length > 2048) return false;
  // A prefix check is not enough: `avatars/../../auth/v1/verify?redirect_to=…` starts with
  // the bucket's prefix, and the phone's HTTP client normalizes it to another endpoint on
  // our host — one that may redirect off it. Refuse dot-segments, backslashes and their
  // percent-encodings outright, and refuse any URL the parser had to rewrite.
  if (/%2e|%2f|%5c|\\/i.test(url)) return false;
  let u: URL;
  let own: URL;
  try {
    u = new URL(url);
    own = new URL(supabaseUrl);
  } catch {
    return false;
  }
  if (u.href !== url) return false;
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  if (u.host === own.host) return u.pathname.startsWith('/storage/v1/object/public/avatars/');
  return u.host === 'lh3.googleusercontent.com';
}

const SONG_TITLE_MAX = 60;

/**
 * How the push refers to the post: "your repost of “Blinding Lights”", "your track
 * “Monsoon Letters”", or — when the song is unknown — "your post", today's wording.
 */
export function postPhrase(post: PostSubject | undefined): string {
  if (!post?.title) return 'your post';
  const title = `“${truncateInline(post.title, SONG_TITLE_MAX)}”`;
  return post.kind === 'repost' ? `your repost of ${title}` : `your track ${title}`;
}

/**
 * Badge keys this file can name. Mirrors OPS_BADGES in web/src/data/profileBadges.ts; a
 * badge missing here still announces, with defaultBody's generic line.
 */
const BADGE_LABELS: Record<string, string> = {
  first_100: 'First 100',
  verified: 'Verified Artist',
};

/**
 * The routes each kind may open, default first. A requested route outside the list is
 * replaced by the default, never passed through: the client hands `data.route` straight to
 * navigateWhenReady.
 *
 * UserProfile is still accepted for friend_accepted / new_fan because the first push
 * builds (46a687c, June 2026) sent it; every build since sends ActivityCenter.
 */
const KIND_ROUTES: Record<string, readonly string[]> = {
  friend_request: ['FriendRequests'],
  friend_accepted: ['ActivityCenter', 'UserProfile'],
  new_follower: ['ActivityCenter', 'UserProfile'],
  new_fan: ['ActivityCenter', 'UserProfile'],
  message: ['Conversation'],
  reaction: ['Conversation'],
  jam_invite_dm: ['JamRoom'],
  jam_started: ['Inbox'],
  jam_join: ['Inbox'],
  jam_ended: ['Inbox'],
  activity_like: ['ActivityCenter'],
  activity_comment: ['ActivityCenter'],
  activity_repost: ['ActivityCenter'],
  activity_milestone: ['ActivityCenter'],
  badge_granted: ['ActivityCenter'],
};

/**
 * The tap target. Params are filled ONLY from verified facts: the conversation and jam
 * room authorize() checked, or the actor's own id. Nothing in the request's params is
 * copied, which is what makes overwriting `kind`/`title`/`body` or injecting
 * `actorAvatarUrl` impossible rather than merely filtered.
 */
export function routeFor(
  kind: string,
  requestedRoute: unknown,
  grant: Grant,
  actor: string,
): { route: string; params: Record<string, string> } {
  const allowed = KIND_ROUTES[kind] ?? ['ActivityCenter'];
  const route = typeof requestedRoute === 'string' && allowed.includes(requestedRoute)
    ? requestedRoute
    : allowed[0];
  const conversationId = grant.conversation?.id;
  switch (route) {
    case 'Conversation':
      return conversationId ? { route, params: { conversationId } } : { route: 'Inbox', params: {} };
    case 'JamRoom':
      return conversationId && grant.jamRoomId
        ? { route, params: { jamRoomId: grant.jamRoomId, conversationId } }
        : { route: 'Inbox', params: {} };
    case 'UserProfile':
      return { route, params: { userId: actor } };
    default:
      return { route, params: {} };
  }
}

/** "Riya" — display name, else username, else a placeholder. Titles of person-to-person pushes. */
const personName = (p: ActorProfile): string =>
  p.displayName?.trim() || p.username?.trim() || 'Someone';

/**
 * "@riya" when there is no display name — the same name activity_notify_post returns
 * (`coalesce(display_name, '@' || username)`), so the push and the Activity row agree.
 */
const activityName = (p: ActorProfile): string =>
  p.displayName?.trim() || (p.username?.trim() ? `@${p.username.trim()}` : 'Someone');

const COMMENT_INLINE_MAX = 80;
/** Same as truncateInline in src/services/activity.ts, so the push matches the Activity row. */
function truncateInline(s: string, max: number): string {
  const trimmed = s.replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? `${sliceWhole(trimmed, max - 1)}…` : trimmed;
}

/** "1K", "5K", "100" — same formatting as recordPlay in src/services/posts.ts. */
export function milestoneLabel(t: number): string {
  if (t < 1000) return String(t);
  const k = t / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
}

const REACTION_RE = /^reacted (.+) to your message$/su;
// Characters an emoji may be built from: pictographs, skin-tone modifiers, regional
// indicators (flags), the zero-width joiner, variation selectors, tag characters, and the
// keycap pieces. Letters (outside tags), spaces and punctuation other than # and * are
// excluded, so the slot cannot carry a sentence.
const EMOJI_CHARS_RE =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[\u200D\uFE0E\uFE0F\u20E3#*0-9]|[\u{E0020}-\u{E007F}])+$/u;
const EMOJI_ANCHOR_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;

/**
 * The emoji out of a shipped client's reaction body (`reacted ${emoji} to your message`),
 * or null when the slot holds anything that is not a short emoji sequence.
 */
export function reactionEmoji(body: unknown): string | null {
  if (typeof body !== 'string') return null;
  const m = REACTION_RE.exec(body);
  const emoji = m?.[1];
  if (!emoji || emoji.length > 32) return null;
  return EMOJI_CHARS_RE.test(emoji) && EMOJI_ANCHOR_RE.test(emoji) ? emoji : null;
}

/**
 * The title and body. Caller `title` is never read. Caller `body` is read for two kinds:
 *
 *   • message  — the preview IS the sender's text. It may only reach people who share the
 *     named conversation with them (authorize), is titled with their name or the group's,
 *     and in a group is prefixed with THEIR handle, so "@bob: …" typed by Alice arrives as
 *     "@alice: @bob: …". A shipped client already sends "@alice: hi"; the prefix is
 *     recognised and not doubled.
 *   • reaction — only the emoji is taken, via reactionEmoji().
 *
 * In a conversation the title is also the Conversation screen's header: the client passes
 * every data key to the route as a param, so `title` must be what that screen shows — the
 * other person for a DM, the group's name for a group. That is what shipped clients sent
 * as params.title for messages. (Reactions sent an empty one, which is why a reaction push
 * on Android had no title and opened a chat with a blank header.)
 */
export function composeContent(
  kind: string,
  grant: Grant,
  actor: ActorProfile,
  request: PushRequest,
): { title: string; body: string } {
  const out = (title: string, body: string) => ({
    title: clamp(title, MAX_TITLE),
    body: clamp(body, MAX_BODY),
  });

  switch (kind) {
    case 'message':
    case 'reaction': {
      const conv = grant.conversation;
      const isGroup = conv?.kind === 'group';
      const title = isGroup ? (conv?.name ?? 'Group chat') : personName(actor);
      const handle = actor.username?.trim() ? `@${actor.username.trim()}` : personName(actor);

      if (kind === 'reaction') {
        const emoji = reactionEmoji(request.body);
        const text = emoji ? `reacted ${emoji} to your message` : 'reacted to your message';
        return out(title, isGroup ? `${handle} ${text}` : text);
      }

      const raw = typeof request.body === 'string' ? request.body : '';
      if (!isGroup) return out(title, raw.trim() ? raw : 'sent you a message');
      const prefix = `${handle}: `;
      const text = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
      return out(title, prefix + (text.trim() ? text : 'sent a message'));
    }

    // The person is the title and the body is the action, so a collapsed Android card
    // (title + one line) still shows the song name, and the photo sits beside the name it
    // belongs to. Only kinds with no person (milestone, badge) keep "Livil" as the title.
    case 'activity_like': {
      const name = activityName(actor);
      const others = (grant.activity?.aggCount ?? 1) - 1;
      return out(
        others > 0 ? `${name} and ${others} other${others === 1 ? '' : 's'}` : name,
        `liked ${postPhrase(grant.post)}`,
      );
    }

    case 'activity_comment': {
      const snippet = grant.activity?.commentText;
      const what = postPhrase(grant.post);
      return out(activityName(actor), snippet
        ? `commented on ${what}: “${truncateInline(snippet, COMMENT_INLINE_MAX)}”`
        : `commented on ${what}`);
    }

    case 'activity_repost': {
      // The row's post is the ORIGINAL — the recipient's own upload — so it reads as a track.
      const title = grant.post?.title;
      return out(activityName(actor), title
        ? `reposted your track “${truncateInline(title, SONG_TITLE_MAX)}”`
        : 'reposted your track');
    }

    case 'activity_milestone':
      return out('Livil', grant.milestone
        ? `Your track hit ${milestoneLabel(grant.milestone)} plays 🎉`
        : 'Your track hit a new milestone 🎉');

    case 'badge_granted': {
      const label = grant.badge ? BADGE_LABELS[grant.badge] : undefined;
      if (grant.badge === 'verified') return out('Livil', 'Your account is now verified ✓');
      return out('Livil', label ? `You received the ${label} badge 🎉` : defaultBody(kind));
    }

    default:
      return out(personName(actor), defaultBody(kind));
  }
}

/**
 * The whole notification: copy, tap target, and the FCM data map the client renders from.
 *
 * Server-owned keys are written LAST, after the route params, so even a future change that
 * lets a param through cannot overwrite them.
 *
 * actorUserId is WITHHELD for the two kinds whose actor the recipient should not learn:
 *   • badge_granted — notify_badge_granted writes the in-app notice with a NULL actor on
 *     purpose; which staff account granted it is ops-only (profile_badges.awarded_by). The
 *     client copies every string key into tapData and `profiles` is readable by any
 *     authenticated user, so shipping the operator's uuid would name an operator, and
 *     `ops_users` is deny-all precisely so the roster is not enumerable.
 *   • activity_milestone — the actor is whichever listener's play crossed the threshold;
 *     activity_record_play stores the milestone with a NULL actor for the same reason.
 * Nothing consumes it for either: the chat-grouping fallback that reads actorUserId sits in
 * a CHAT_KINDS branch neither enters, and the APNs thread-id falls back to `kind`.
 */
export function buildPush(
  kind: string,
  actor: string,
  grant: Grant,
  profile: ActorProfile,
  request: PushRequest,
  opts: { quiet?: boolean } = {},
): { title: string; body: string; data: Record<string, string> } {
  const { title, body } = composeContent(kind, grant, profile, request);
  const nav = routeFor(kind, request.data?.route, grant, actor);
  const data: Record<string, string> = {
    ...nav.params,
    route: nav.route,
    kind,
    channelId: channelFor(kind),
    title,
    body,
  };
  if (isPersonToPerson(kind)) data.actorUserId = actor;
  // Already vetted by isAllowedAvatarUrl in the handler; Android draws it as the picture.
  if (PHOTO_KINDS.has(kind) && profile.avatarUrl) data.actorAvatarUrl = profile.avatarUrl;
  // Likes on one post share ONE card that each new like replaces: iOS via apns-collapse-id
  // (apnsFor), Android by posting under this id (pushNotifications.ts, from the release that
  // reads it; older apps ignore both keys). `quiet` marks a like inside the alert window
  // (claimLikeAlert), which updates the card without a sound. postId is UUID-checked by
  // authorizeLike, so the id is always `like:` + 36 characters.
  if (kind === 'activity_like' && grant.activity?.postId) {
    data.collapseId = `like:${grant.activity.postId}`;
    if (opts.quiet) data.quiet = '1';
  }
  return { title, body, data };
}

/**
 * The FCM `apns` block: what iOS renders itself (iOS has no headless data wake-up, so a
 * data-only push would display nothing). FCM drops it for Android tokens.
 *
 *   • thread-id stacks a conversation's notifications (or one kind's) together.
 *   • apns-collapse-id makes a like REPLACE the earlier card for the same post instead of
 *     adding one; iOS keeps only the newest notification per collapse id.
 *   • A quiet push (a later like inside the alert window) carries no sound and is
 *     `passive` (iOS 15+): it updates the card without lighting the screen.
 */
export function apnsFor(
  kind: string,
  title: string,
  body: string,
  data: Record<string, string>,
  badge: number | null,
): Record<string, unknown> {
  const quiet = data.quiet === '1';
  return {
    headers: {
      'apns-priority': '10',
      ...(data.collapseId ? { 'apns-collapse-id': data.collapseId } : {}),
    },
    payload: {
      aps: {
        alert: { title, body },
        ...(quiet ? { 'interruption-level': 'passive' } : { sound: 'default' }),
        'thread-id': data.conversationId ?? kind,
        ...(badge === null ? {} : { badge }),
      },
    },
  };
}

/**
 * Whether an FCM HTTP v1 error means THIS TOKEN is dead, so it should be deleted.
 *
 * Only the errors that are about the token itself: UNREGISTERED (the app was uninstalled or
 * the token rotated), SENDER_ID_MISMATCH (a token from another Firebase project), and an
 * INVALID_ARGUMENT whose complaint is the token field. Everything else leaves the token
 * alone — a malformed payload is OUR bug and is a 400 for every device at once, an APNs
 * credential problem (THIRD_PARTY_AUTH_ERROR) hits every iOS token at once, and quota or
 * server errors are transient. Deleting on those wiped valid devices; a stale token kept
 * by mistake costs one failed request per push.
 *
 * SENDER_ID_MISMATCH is the one that can misfire wholesale: if the FCM_* secrets ever
 * point at a different Firebase project, every token is "mismatched" and each user's
 * tokens are deleted on their next push. Recoverable — the app re-registers its token on
 * every launch — but a user who does not open the app stays unreachable until they do.
 * Check FCM_PROJECT_ID before rotating those secrets.
 */
export function shouldPruneToken(status: number, body: unknown): boolean {
  const err = (body as { error?: Record<string, unknown> } | null)?.error;
  const details = Array.isArray(err?.details) ? (err.details as Array<Record<string, unknown>>) : [];
  const code = details.find(d => typeof d?.errorCode === 'string')?.errorCode;

  if (code === 'UNREGISTERED' || code === 'SENDER_ID_MISMATCH') return true;
  if (status !== 400) return false;
  if (code !== undefined && code !== 'INVALID_ARGUMENT') return false;

  const violations = details.flatMap(d =>
    Array.isArray(d?.fieldViolations) ? (d.fieldViolations as Array<Record<string, unknown>>) : []);
  if (violations.some(v => v?.field === 'message.token')) return true;
  return typeof err?.message === 'string' && /registration token/i.test(err.message);
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

/** The kinds whose copy names the song. */
const SONG_KINDS = new Set(['activity_like', 'activity_comment', 'activity_repost']);

/** How long a Spotify title lookup may hold a push before it goes out saying "your post". */
const SPOTIFY_LOOKUP_MS = 1500;

/** After a like push makes a sound, how long further likes on that post update it silently. */
export const LIKE_ALERT_WINDOW_MS = 15 * 60_000;

/**
 * Whether this like push should make a sound: the first like on a post, or the first after
 * LIKE_ALERT_WINDOW_MS of quiet. Later likes inside the window still go out — they replace
 * the card with the new count — but silently.
 *
 * Claimed in push_like_alerts with two single statements, so two likes racing for one
 * window cannot both be loud: move an existing row forward only if its last alert is older
 * than the window (Postgres re-checks that condition after waiting on a concurrent writer's
 * row lock), else insert the row, where a conflict means another like already holds the
 * window.
 *
 * Fails LOUD. A missing table (send-push deployed before the migration), an error or a
 * throw all answer true, which is exactly the behaviour before this existed. The worst
 * case of failing this way is an extra buzz; failing quiet would swallow a notification.
 */
export async function claimLikeAlert(
  admin: SupabaseClient,
  recipient: string,
  postId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const at = new Date(now).toISOString();
  const windowStart = new Date(now - LIKE_ALERT_WINDOW_MS).toISOString();
  try {
    const moved = await admin
      .from('push_like_alerts')
      .update({ last_alert_at: at })
      .eq('recipient_id', recipient)
      .eq('post_id', postId)
      .lt('last_alert_at', windowStart)
      .select('post_id');
    if (moved.error) {
      console.warn('[send-push] like alert claim failed; alerting', moved.error.message);
      return true;
    }
    if ((moved.data ?? []).length > 0) return true;

    const created = await admin
      .from('push_like_alerts')
      .upsert(
        { recipient_id: recipient, post_id: postId, last_alert_at: at },
        { onConflict: 'recipient_id,post_id', ignoreDuplicates: true },
      )
      .select('post_id');
    if (created.error) {
      console.warn('[send-push] like alert claim failed; alerting', created.error.message);
      return true;
    }
    return (created.data ?? []).length > 0;
  } catch (e) {
    console.warn('[send-push] like alert claim threw; alerting', e instanceof Error ? e.message : e);
    return true;
  }
}

/**
 * The post a like / comment / repost push is about. A Spotify repost has no Livil track —
 * only the 22-char Spotify id (ADR-0027 stores nothing else) — so its title is asked of
 * Spotify at send time and never stored. Null when the post is gone or unreadable.
 */
export async function describePost(
  admin: SupabaseClient,
  postId: string,
  recipient: string,
  spotifyTitleOf: (spotifyTrackId: string) => Promise<string | null>,
): Promise<PostSubject | null> {
  // Only the recipient's OWN post: activity_notify_post only ever writes a row about the
  // author's post, but a recipient can edit their own activity rows (the update policy
  // covers every column), and this read is service-role — without the author filter it
  // would name a post RLS hides from them (blocked author, taken down, friends-only).
  const { data, error } = await admin
    .from('posts')
    .select('kind, spotify_track_id, tracks(title)')
    .eq('id', postId)
    .eq('author_id', recipient)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { kind?: unknown; spotify_track_id?: unknown; tracks?: unknown };
  if (typeof row.spotify_track_id === 'string' && row.spotify_track_id) {
    return { kind: 'repost', title: await spotifyTitleOf(row.spotify_track_id) };
  }
  const track = Array.isArray(row.tracks) ? row.tracks[0] : row.tracks;
  const title = (track as { title?: unknown } | null)?.title;
  return {
    kind: row.kind === 'repost' ? 'repost' : 'upload',
    title: typeof title === 'string' && title.trim() ? title.trim() : null,
  };
}

/**
 * A Spotify song's title, via the project's own `spotify` function and ON THE ACTOR'S
 * SESSION: that function only serves signed-in callers, keeps the app token, the per-user
 * budget and the circuit breaker, and this one gains no Spotify credential. Bounded by
 * SPOTIFY_LOOKUP_MS; any failure is null.
 */
export async function spotifyTitle(
  supabaseUrl: string,
  authHeader: string,
  anonKey: string,
  spotifyTrackId: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  if (!/^[A-Za-z0-9]{22}$/.test(spotifyTrackId)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SPOTIFY_LOOKUP_MS);
  try {
    const res = await fetchFn(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/spotify`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        ...(anonKey ? { apikey: anonKey } : {}),
      },
      body: JSON.stringify({ action: 'tracks', ids: [spotifyTrackId] }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null) as
      { tracks?: Record<string, { title?: unknown } | null> } | null;
    const title = body?.tracks?.[spotifyTrackId]?.title;
    return typeof title === 'string' && title.trim() ? title.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Livil's own scheduled pushes (mood nudges, repost digests) ───────────────
// The database decides who gets what and writes the final text (push_run_slot, migration
// 20261025000000); this file only delivers rows it queued. See flushScheduled.

/** Where each scheduled kind opens, and the card it replaces (iOS apns-collapse-id). */
const SCHEDULED_KINDS: Record<string, { route: string; collapseId: string }> = {
  // The "+ Track" chooser: repost from Spotify or upload. Present in every shipped build.
  mood_nudge: { route: 'AddToLivil', collapseId: 'mood' },
  // The main tabs (Home first). A tab cannot be named from a data-only push, which carries
  // strings only; the app lands on the tab navigator it already shows.
  repost_digest: { route: 'App', collapseId: 'digest' },
};

/**
 * Ids per request. PostgREST carries `.in()` lists in the URL; a few hundred uuids would
 * overrun the gateway's URL limit and fail every lookup, which here would mean marking a
 * whole slot `failed`.
 */
const ID_CHUNK = 100;

export function chunked<T>(xs: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** No legitimate request comes close: the longest is a chat preview of a few hundred bytes. */
const MAX_BODY_BYTES = 16_384;

/** The send id of a hand-off from the database, or null when this is not one. */
export function scheduledSendIdOf(payload: unknown): string | null {
  const id = (payload as { scheduledSendId?: unknown } | null)?.scheduledSendId;
  return isUuid(id) ? id.toLowerCase() : null;
}

/** One FCM HTTP v1 send. `dead` = the token itself is gone and should be pruned. */
export async function sendFcm(
  endpoint: string,
  accessToken: string,
  message: Record<string, unknown>,
  fetchFn: typeof fetch = fetch,
): Promise<'sent' | 'dead' | 'failed'> {
  // One device's failure must not abort the others, so a thrown fetch is caught here.
  try {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message }),
    });
    if (res.ok) { await res.body?.cancel(); return 'sent'; }
    let errBody: unknown = null;
    try { errBody = await res.json(); } catch { /* non-JSON error body */ }
    if (shouldPruneToken(res.status, errBody)) return 'dead';
    console.warn('[send-push] FCM refused a send; token kept', res.status, fcmErrorCode(errBody));
    return 'failed';
  } catch (e) {
    console.warn('[send-push] FCM request threw; token kept', e instanceof Error ? e.message : e);
    return 'failed';
  }
}

type ScheduledRow = {
  id: string;
  recipient_id: string;
  title: string;
  body: string;
  avatar_url: string | null;
};

/**
 * Deliver the rows the database queued for one scheduled send — all of them in one call,
 * which is fine at today's size (one row per person with a phone). Past a few thousand,
 * claim in batches and have push_maintain hand off the remainder.
 *
 * CLAIMS before sending — `queued → sending` in one UPDATE — so a second hand-off of the
 * same send (push_maintain's retry, or anyone repeating the call) finds nothing left and
 * sends nothing twice. A caller cannot add or change a row: the tables are deny-all and
 * this only reads what push_run_slot wrote. If FCM cannot be reached at all, the claimed
 * rows go back to `queued` for the retry; push_maintain expires them after an hour.
 */
export async function flushScheduled(
  admin: SupabaseClient,
  sendId: string,
  supabaseUrl: string,
  deps: {
    accessToken?: () => Promise<string>;
    projectId?: string;
    fetchFn?: typeof fetch;
  } = {},
): Promise<{ claimed: number; sent: number; failed: number; pruned: number }> {
  const none = { claimed: 0, sent: 0, failed: 0, pruned: 0 };
  const { data: send } = await admin.from('push_sends').select('kind').eq('id', sendId).maybeSingle();
  const shape = SCHEDULED_KINDS[(send as { kind?: string } | null)?.kind ?? ''];
  if (!shape) return none;
  const kind = (send as { kind: string }).kind;

  const { data: claimedRows, error: claimErr } = await admin
    .from('push_deliveries')
    .update({ status: 'sending' })
    .eq('send_id', sendId)
    .eq('status', 'queued')
    .select('id, recipient_id, title, body, avatar_url');
  const rows = (claimedRows ?? []) as ScheduledRow[];
  if (claimErr || rows.length === 0) return none;

  let accessToken: string;
  try {
    accessToken = await (deps.accessToken ?? getFcmAccessToken)();
  } catch (e) {
    console.error('[send-push] FCM auth failed; scheduled rows requeued', e instanceof Error ? e.message : e);
    for (const ids of chunked(rows.map(r => r.id))) {
      await admin.from('push_deliveries').update({ status: 'queued' }).in('id', ids);
    }
    return { ...none, claimed: rows.length };
  }
  const projectId = deps.projectId ?? Deno.env.get('FCM_PROJECT_ID')!;
  const endpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  const devices: Array<{ user_id: string; token: string; platform?: string | null }> = [];
  for (const ids of chunked([...new Set(rows.map(r => r.recipient_id))])) {
    const { data: tokenRows } = await admin
      .from('device_tokens')
      .select('user_id, token, platform')
      .in('user_id', ids);
    devices.push(...((tokenRows ?? []) as typeof devices));
  }

  const sentIds: string[] = [];
  const failedIds: string[] = [];
  const deadTokens: string[] = [];
  await Promise.all(rows.map(async row => {
    const mine = devices.filter(d => d.user_id === row.recipient_id && d.token);
    const badge = mine.some(d => d.platform === 'ios') ? await unreadBadgeCount(admin, row.recipient_id) : null;
    const title = clamp(row.title, MAX_TITLE);
    const body = clamp(row.body, MAX_BODY);
    const data: Record<string, string> = {
      route: shape.route,
      kind,
      channelId: 'activity',
      title,
      body,
      // The delivery, not the send: what the app reports a tap with (push_record_open).
      pushId: row.id,
      collapseId: shape.collapseId,
    };
    if (isAllowedAvatarUrl(row.avatar_url, supabaseUrl)) data.actorAvatarUrl = row.avatar_url;

    let delivered = false;
    for (const device of mine) {
      const outcome = await sendFcm(endpoint, accessToken, {
        token: device.token,
        data,
        android: { priority: 'high' },
        apns: apnsFor(kind, title, body, data, badge),
      }, deps.fetchFn);
      if (outcome === 'sent') delivered = true;
      if (outcome === 'dead') deadTokens.push(device.token);
    }
    (delivered ? sentIds : failedIds).push(row.id);
  }));

  const now = new Date().toISOString();
  for (const ids of chunked(sentIds)) {
    await admin.from('push_deliveries').update({ status: 'sent', sent_at: now }).in('id', ids);
  }
  for (const ids of chunked(failedIds)) {
    await admin.from('push_deliveries').update({ status: 'failed' }).in('id', ids);
  }
  for (const tokens of chunked(deadTokens)) {
    await admin.from('device_tokens').delete().in('token', tokens);
  }
  return { claimed: rows.length, sent: sentIds.length, failed: failedIds.length, pruned: deadTokens.length };
}

export async function handler(req: Request): Promise<Response> {
  // Preflight, BEFORE the method check — a browser sends this before every cross-origin
  // POST carrying an Authorization header, and answering 405 stops the real request from
  // ever being made. 204 with the headers above is the whole contract.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  // Before anything reads the body (which now happens ahead of user resolution, see below).
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return json(413, { error: 'too_large' });
  }

  // 1. AUTHENTICATION — resolve the actor from the JWT, not the body.
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'missing_bearer' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // The body is read before the user is resolved only to recognise the database's
  // hand-off of a scheduled send, which carries the public anon key rather than a user.
  // It delivers rows the database already wrote, once (see flushScheduled); everything
  // else still needs a real user below.
  let payload: PushRequest | null = null;
  try { payload = await req.json(); } catch { payload = null; }
  const scheduledId = scheduledSendIdOf(payload);
  if (scheduledId) {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const result = await flushScheduled(admin, scheduledId, url);
    console.log(JSON.stringify({ fn: 'send-push', kind: 'scheduled', outcome: 'flushed', ...result }));
    return json(200, { ok: true });
  }

  // A user-scoped client just to resolve the caller identity from their JWT.
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? serviceKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: authErr } = await asUser.auth.getUser();
  const actor = userData?.user?.id;
  if (authErr || !actor) return json(401, { error: 'invalid_token' });

  // 2. Validate input.
  if (!payload || typeof payload !== 'object') return json(400, { error: 'bad_json' });

  const kind = typeof payload.kind === 'string' ? payload.kind : '';
  if (!isValidRecipient(payload.recipientUserId)) return json(400, { error: 'bad_recipient' });
  // Lowercased: the regex accepts either case and Postgres ignores it, but the self-target
  // refusal and the id comparisons in authorize() are plain string comparisons.
  const recipient = payload.recipientUserId.toLowerCase();
  if (!isValidKind(kind)) return json(400, { error: 'bad_kind' });

  if (!checkRateLimit(actor)) return json(429, { error: 'rate_limited' });

  // 3. AUTHORIZATION — service-role client; these reads ARE the perimeter. The ids in
  // data.params are claims authorize() verifies; nothing else in params is read at all.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const grant = await authorize(admin, kind, actor, recipient, claimsFrom(payload));
  if (!grant) return json(403, { error: 'not_authorized' });

  // Every outcome past this point answers the CALLER identically. The caller is the sender,
  // and how a push fared is the recipient's business: whether they have a phone, which
  // categories they muted, and above all whether they blocked the sender. The detail goes
  // to the function log instead. (No shipped client reads this body — pushDispatch.ts and
  // web/src/data/push.ts look only at `error`.)
  const done = (outcome: string, extra: Record<string, number> = {}) => {
    console.log(JSON.stringify({ fn: 'send-push', kind, outcome, ...extra }));
    return json(200, { ok: true });
  };

  // 3a. BLOCKS — after authorization (an unauthorized actor learns nothing) and before
  // anything is sent. Group conversations included; see isPersonToPerson.
  if (isPersonToPerson(kind) && await isBlockedBetween(admin, actor, recipient)) {
    return done('blocked');
  }

  // 3b. PREFERENCE — the recipient may have switched this category off. Checked after
  // authorization (so an unauthorized actor still learns nothing) and before the token
  // lookup and FCM call, which is the point of doing it server-side: a muted category
  // costs no send and never wakes the device. Android channels cannot do this — the OS
  // suppresses display only after delivery, and gives iOS nothing at all.
  if (await isCategoryMuted(admin, recipient, kind)) return done('category_muted');

  // 4. Look up the recipient's device tokens, and the actor's name for the copy.
  const [{ data: tokenRows, error: tokErr }, { data: prof }] = await Promise.all([
    admin.from('device_tokens').select('token, platform').eq('user_id', recipient),
    admin.from('profiles').select('display_name, username, avatar_url').eq('id', actor).maybeSingle(),
  ]);
  if (tokErr) return json(500, { error: 'token_lookup_failed' });
  const tokens = (tokenRows ?? []).map((r: { token: string }) => r.token).filter(Boolean);
  if (tokens.length === 0) return done('no_tokens');
  // `platform` is selected above and, until now, discarded. It earns its place here:
  // the badge count below is an extra database round-trip that ONLY iOS can use.
  const hasIosToken = (tokenRows ?? [])
    .some((r: { platform?: string | null }) => r.platform === 'ios');

  // 5. Build the DATA-ONLY FCM payload the client's notifee renderer expects. All FCM
  // data values must be strings. `route` + the verified params drive tap-routing. The
  // copy is built here for every kind (see composeContent); the relationship + jam kinds
  // have always relied on it (else the notification arrives blank — LIV-9 device test,
  // 2026-07-23), and since this change the rest do too.
  const profile: ActorProfile = {
    displayName: typeof prof?.display_name === 'string' ? prof.display_name : null,
    username: typeof prof?.username === 'string' ? prof.username : null,
    avatarUrl: isAllowedAvatarUrl(prof?.avatar_url, url) ? prof.avatar_url : null,
  };

  // 4b. The song the push names. After the token lookup, so a recipient with no phone costs
  // no lookups; best-effort throughout — any failure leaves the copy at "your post".
  if (grant.activity?.postId && SONG_KINDS.has(kind)) {
    const subject = await describePost(admin, grant.activity.postId, recipient, id =>
      spotifyTitle(url, authHeader, Deno.env.get('SUPABASE_ANON_KEY') ?? '', id));
    if (subject) grant.post = subject;
  }

  // 4c. Likes on one post: is this the like that makes a sound? Claimed only now, past the
  // blocked / muted / no-phone exits, so a like that was never going to reach a phone
  // cannot use up the window. (A send that then fails at FCM still uses it: the next like
  // inside the window is silent rather than an extra buzz.)
  const likePostId = kind === 'activity_like' ? grant.activity?.postId : null;
  const quiet = likePostId ? !(await claimLikeAlert(admin, recipient, likePostId)) : false;

  const { title, body, data } = buildPush(kind, actor, grant, profile, payload, { quiet });

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

  // 6. Send via FCM HTTP v1, and prune dead tokens. A failure to mint the FCM token is
  // ours, not the recipient's, so it answers like every other outcome rather than with a
  // 500 that only the not-blocked, not-muted, has-a-phone path could ever produce.
  let accessToken: string;
  try {
    accessToken = await getFcmAccessToken();
  } catch (e) {
    console.error('[send-push] FCM auth failed', e instanceof Error ? e.message : e);
    return done('fcm_auth_failed');
  }
  const projectId = Deno.env.get('FCM_PROJECT_ID')!;
  const endpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  let sent = 0;
  let failed = 0;
  const deadTokens: string[] = [];
  await Promise.all(tokens.map(async (token: string) => {
    const outcome = await sendFcm(endpoint, accessToken, {
      token,
      data,
      android: { priority: 'high' },
      // iOS-only; FCM drops it for Android tokens, so one payload serves both.
      apns: apnsFor(kind, title, body, data, badge),
    });
    if (outcome === 'sent') sent++;
    else if (outcome === 'dead') deadTokens.push(token);
    else failed++;
  }));

  if (deadTokens.length > 0) {
    await admin.from('device_tokens').delete().in('token', deadTokens);
  }

  return done('sent', { sent, failed, pruned: deadTokens.length, quiet: quiet ? 1 : 0 });
}

/** The FcmError code from an HTTP v1 error body, for the log line only. */
function fcmErrorCode(body: unknown): string {
  const err = (body as { error?: { status?: unknown; details?: unknown } } | null)?.error;
  const details = Array.isArray(err?.details) ? (err.details as Array<{ errorCode?: unknown }>) : [];
  const code = details.find(d => typeof d?.errorCode === 'string')?.errorCode ?? err?.status;
  return typeof code === 'string' ? code : 'unknown';
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
