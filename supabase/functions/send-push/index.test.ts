// Unit tests for the pure logic in send-push. Run: `deno test` in this directory.
//
// SCOPE: the relationship gates in authorize() and the pure helpers — the parts a wrong
// change silently breaks. The FCM send path and JWT verification are integration concerns
// that need a deployed function (or a mocked network) and are out of scope here.
//
// authorize() takes the admin client as a parameter, so we inject a fake whose responses
// are scripted per table+filter — no network, no Supabase.

import { assertEquals } from 'jsr:@std/assert@1';
import {
  authorize,
  buildPush,
  claimsFrom,
  channelFor,
  clamp,
  composeContent,
  defaultBody,
  apnsFor,
  claimLikeAlert,
  describePost,
  chunked,
  flushScheduled,
  scheduledSendIdOf,
  sendFcm,
  LIKE_ALERT_WINDOW_MS,
  sliceWhole,
  type Grant,
  isAllowedAvatarUrl,
  isBlockedBetween,
  isCategoryMuted,
  preferenceColumnsFor,
  isPersonToPerson,
  isValidKind,
  KINDS,
  handler,
  isValidRecipient,
  milestoneLabel,
  postPhrase,
  reactionEmoji,
  routeFor,
  shouldPruneToken,
  spotifyTitle,
} from './app.ts';

// ── a minimal fake of the supabase-js query builder ─────────────────────────
// resolver(table, filters, opts) returns the awaited `{ data }` or `{ count }`.
// `data` is `unknown` rather than `unknown[]` so a resolver can also answer a
// .maybeSingle() call, which yields a single row object (or null) instead of an array.
type Resolver = (
  table: string,
  filters: Record<string, string>,
  opts: { head?: boolean; count?: string },
) => { data?: unknown; count?: number; error?: unknown };

// deno-lint-ignore no-explicit-any
function fakeAdmin(resolver: Resolver): any {
  const makeBuilder = (table: string) => {
    const filters: Record<string, string> = {};
    let opts: { head?: boolean; count?: string } = {};
    // deno-lint-ignore no-explicit-any
    const b: any = {
      select(_c: string, o?: { head?: boolean; count?: string }) { if (o) opts = o; return b; },
      eq(col: string, val: string) { filters[col] = val; return b; },
      // authorizeBadgeGranted uses .is('revoked_at', null) to mean "live badge". Recorded
      // like eq so a resolver can assert the query really asked for live rows only.
      is(col: string, val: unknown) { filters[col] = String(val); return b; },
      or(expr: string) { filters.__or = expr; return b; },
      // Recorded as a comma-joined list so a resolver can check which ids were asked about.
      in(col: string, vals: string[]) { filters[`${col}__in`] = vals.join(','); return b; },
      // Recorded under `<col>__gte` so a resolver can assert a read is time-bounded.
      gte(col: string, val: string) { filters[`${col}__gte`] = val; return b; },
      lt(col: string, val: string) { filters[`${col}__lt`] = val; return b; },
      delete() { filters.__op = 'delete'; return b; },
      // Writes are recorded as the operation plus its row, so a resolver can answer per step.
      update(row: Record<string, unknown>) { filters.__op = 'update'; filters.__row = JSON.stringify(row); return b; },
      upsert(row: Record<string, unknown>, o?: { onConflict?: string; ignoreDuplicates?: boolean }) {
        filters.__op = 'upsert';
        filters.__row = JSON.stringify(row);
        filters.__onConflict = o?.onConflict ?? '';
        filters.__ignoreDuplicates = String(o?.ignoreDuplicates ?? false);
        return b;
      },
      order(col: string) { filters.__order = col; return b; },
      limit(n: number) { filters.__limit = String(n); return b; },
      // Terminal, like the real builder: resolves straight to the resolver's answer
      // rather than returning `b`, so the row shape is whatever the test scripted.
      maybeSingle() { return Promise.resolve(resolver(table, filters, opts)); },
      then(res: (v: unknown) => void, rej?: (e: unknown) => void) {
        return Promise.resolve(resolver(table, filters, opts)).then(res, rej);
      },
    };
    return b;
  };
  return { from: (t: string) => makeBuilder(t) };
}

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';
const CONV = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const JAM = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const POST = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

/** authorize() returns the Grant it proved, or null. Most gate tests only ask "allowed?". */
// deno-lint-ignore no-explicit-any
const allows = async (admin: any, kind: string, actor: string, recipient: string, claims = {}) =>
  (await authorize(admin, kind, actor, recipient, claims)) !== null;

// ── pure helpers ────────────────────────────────────────────────────────────
Deno.test('channelFor routes each kind to the channel the client created', () => {
  assertEquals(channelFor('message'), 'messages');
  assertEquals(channelFor('reaction'), 'messages');
  assertEquals(channelFor('jam_started'), 'jam');
  assertEquals(channelFor('jam_invite_dm'), 'jam');
  // regression: activity_* must NOT fall through to 'social'
  assertEquals(channelFor('activity_like'), 'activity');
  assertEquals(channelFor('activity_milestone'), 'activity');
  assertEquals(channelFor('friend_request'), 'social');
  assertEquals(channelFor('new_fan'), 'social');
  // badge_granted lands in the activity feed but carries no `activity_` prefix, so the
  // prefix match does not cover it — it must be routed explicitly or it falls to 'social'
  // and lands on a channel the client never created.
  assertEquals(channelFor('badge_granted'), 'activity');
});

// ── per-category preference ─────────────────────────────────────────────────
// Polarity is the opposite of authorize(): this ALLOWS by default. Every "unknown"
// case below must resolve to "not muted", because a preference that fails closed
// silently stops a user's notifications with no error anyone would see.

const prefsRow = (over: Record<string, boolean> = {}) => ({
  social: true, activity: true, messages: true, jam: true, mentions: true, ...over,
});

Deno.test('isCategoryMuted: a user who never set a preference gets everything', async () => {
  // No row at all — the common case, since nothing backfills existing users.
  const admin = fakeAdmin(() => ({ data: null }));
  assertEquals(await isCategoryMuted(admin, B, 'message'), false);
  assertEquals(await isCategoryMuted(admin, B, 'friend_request'), false);
});

Deno.test('isCategoryMuted: an explicit false suppresses that category', async () => {
  const admin = fakeAdmin(() => ({ data: prefsRow({ messages: false }) }));
  assertEquals(await isCategoryMuted(admin, B, 'message'), true);
  assertEquals(await isCategoryMuted(admin, B, 'reaction'), true);
});

Deno.test('isCategoryMuted: muting one category leaves the others delivering', async () => {
  // The routing bug worth guarding: muting Messages must not silence Jam or Social.
  const admin = fakeAdmin(() => ({ data: prefsRow({ messages: false }) }));
  assertEquals(await isCategoryMuted(admin, B, 'jam_started'), false);
  assertEquals(await isCategoryMuted(admin, B, 'friend_request'), false);
  assertEquals(await isCategoryMuted(admin, B, 'activity_like'), false);
});

Deno.test('isCategoryMuted: reads the preference of the RECIPIENT', async () => {
  let seen = '';
  const admin = fakeAdmin((table, filters) => {
    if (table === 'notification_preferences') seen = filters.user_id ?? '';
    return { data: prefsRow() };
  });
  await isCategoryMuted(admin, B, 'message');
  assertEquals(seen, B);
});

Deno.test('isCategoryMuted: fails OPEN on a read error', async () => {
  // A database blip must not silently stop delivery — the user would never know.
  const admin = fakeAdmin(() => ({ error: { message: 'connection reset' } }));
  assertEquals(await isCategoryMuted(admin, B, 'message'), false);
});

Deno.test('isCategoryMuted: a missing or null column is not a mute', async () => {
  // Only an explicit `false` suppresses; anything else means "no objection".
  assertEquals(await isCategoryMuted(fakeAdmin(() => ({ data: {} })), B, 'message'), false);
  assertEquals(
    await isCategoryMuted(fakeAdmin(() => ({ data: { messages: null } })), B, 'message'),
    false,
  );
});

Deno.test('every channelFor() result is a column on notification_preferences', async () => {
  // The coupling the migration documents: column names ARE the channel ids. If a new
  // kind ever routes to a fifth channel with no column, this catches it here rather
  // than as notifications that quietly cannot be muted.
  // ITERATES THE REAL SET, not a copy. This test previously kept its own hardcoded list of
  // 14 kinds — so adding badge_granted left the new kind unchecked by the very test written
  // to catch that class of drift. Importing KINDS makes the two impossible to disagree.
  const columns = Object.keys(prefsRow());
  for (const kind of KINDS) {
    const category = channelFor(kind);
    assertEquals(
      columns.includes(category),
      true,
      `channelFor('${kind}') = '${category}', which is not a notification_preferences column`,
    );
    // And muting that column must actually suppress this kind.
    const admin = fakeAdmin(() => ({ data: prefsRow({ [category]: false }) }));
    assertEquals(await isCategoryMuted(admin, B, kind), true, `muting '${category}' did not suppress '${kind}'`);
  }
});

Deno.test('isCategoryMuted: mentions — their own switch, and Activity silences them too', async () => {
  const muted = async (over: Record<string, boolean>) =>
    await isCategoryMuted(fakeAdmin(() => ({ data: prefsRow(over) })), B, 'activity_mention');
  assertEquals(await muted({}), false);
  assertEquals(await muted({ mentions: false }), true);
  assertEquals(await muted({ activity: false }), true);
  // The Mentions switch touches nothing else.
  assertEquals(await isCategoryMuted(fakeAdmin(() => ({ data: prefsRow({ mentions: false }) })), B, 'activity_like'), false);
  // Before the column exists (no `mentions` in the row): not muted.
  const { mentions: _gone, ...older } = prefsRow();
  assertEquals(await isCategoryMuted(fakeAdmin(() => ({ data: older })), B, 'activity_mention'), false);
  assertEquals(preferenceColumnsFor('activity_mention'), ['activity', 'mentions']);
});

Deno.test('defaultBody: kinds without client copy get server-generated text', () => {
  assertEquals(defaultBody('friend_request'), 'sent you a friend request');
  assertEquals(defaultBody('friend_accepted'), 'accepted your friend request');
  assertEquals(defaultBody('new_fan'), 'started following you');
  assertEquals(defaultBody('jam_invite_dm'), 'invited you to a Jam');
  assertEquals(defaultBody('jam_ended'), 'ended the Jam');
});

Deno.test('clamp truncates and tolerates non-strings', () => {
  assertEquals(clamp('hello', 3), 'hel');
  assertEquals(clamp(undefined, 5), '');
  assertEquals(clamp(42, 5), '');
});

Deno.test('input validation', () => {
  assertEquals(isValidKind('message'), true);
  assertEquals(isValidKind('not_a_kind'), false);
  assertEquals(isValidKind('badge_granted'), true);
  assertEquals(isValidRecipient(A), true);
  assertEquals(isValidRecipient('nope'), false);
  assertEquals(isValidRecipient(undefined), false);
});

Deno.test('isPersonToPerson: only the two notices from Livil are exempt from blocks', () => {
  assertEquals(isPersonToPerson('activity_milestone'), false);
  assertEquals(isPersonToPerson('badge_granted'), false);
  for (const kind of KINDS) {
    if (kind === 'activity_milestone' || kind === 'badge_granted') continue;
    assertEquals(isPersonToPerson(kind), true, `${kind} must be stopped by a block`);
  }
});

// ── authorize(): the security-relevant gates ────────────────────────────────
// ── message / reaction / jam_invite_dm: THE named conversation ──────────────
//
// Scripted as the database would answer: conversation_members holds (conversation, user)
// pairs, and the gate asks for both people's rows in ONE conversation.
const convAdmin = (
  memberships: Array<[string, string]>,
  conv: { kind: string; name: string | null } | null = { kind: 'dm', name: null },
  jamRooms: Array<[string, string]> = [],
) =>
  fakeAdmin((table, f) => {
    if (table === 'conversation_members') {
      const wanted = (f.user_id__in ?? '').split(',');
      return {
        data: memberships
          .filter(([c, u]) => c === f.conversation_id && wanted.includes(u))
          .map(([, u]) => ({ user_id: u })),
      };
    }
    if (table === 'conversations') return { data: f.id === CONV ? conv : null };
    if (table === 'jam_rooms') {
      return { count: jamRooms.filter(([j, c]) => j === f.id && c === f.conversation_id).length };
    }
    return { count: 0 };
  });

Deno.test('message: allowed when both people are members of the NAMED conversation', async () => {
  const admin = convAdmin([[CONV, A], [CONV, B]], { kind: 'group', name: 'Weekend Crew' });
  const grant = await authorize(admin, 'message', A, B, { conversationId: CONV });
  assertEquals(grant?.conversation, { id: CONV, kind: 'group', name: 'Weekend Crew' });
  assertEquals(await allows(admin, 'reaction', A, B, { conversationId: CONV }), true);
});

Deno.test('message: sharing SOME other conversation is not enough', async () => {
  // The old gate: any intersection of memberships passed. A and B share OTHER, but the
  // push names CONV, which B is not in — so the push could not route anywhere B can open.
  const OTHER = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  const admin = convAdmin([[OTHER, A], [OTHER, B], [CONV, A]]);
  assertEquals(await allows(admin, 'message', A, B, { conversationId: CONV }), false);
  assertEquals(await allows(admin, 'reaction', A, B, { conversationId: CONV }), false);
});

Deno.test('message: no conversationId, or a malformed one, is refused', async () => {
  // Every shipped build sends it, so its absence is not a client we need to serve.
  const admin = convAdmin([[CONV, A], [CONV, B]]);
  assertEquals(await allows(admin, 'message', A, B), false);
  assertEquals(await allows(admin, 'message', A, B, { conversationId: 'not-a-uuid' }), false);
  assertEquals(await allows(admin, 'message', A, B, { conversationId: `${CONV},x` }), false);
});

Deno.test('message: a conversation whose row cannot be read is refused', async () => {
  // The row supplies the title; one we cannot read is one we cannot vouch for.
  assertEquals(await allows(convAdmin([[CONV, A], [CONV, B]], null), 'message', A, B, { conversationId: CONV }), false);
});

Deno.test('message: an errored membership read denies', async () => {
  const admin = fakeAdmin(table => (table === 'conversation_members'
    ? { error: { message: 'boom' } }
    : { data: { kind: 'dm', name: null } }));
  assertEquals(await allows(admin, 'message', A, B, { conversationId: CONV }), false);
});

Deno.test('jam_invite_dm: the jam room must belong to that conversation', async () => {
  const members: Array<[string, string]> = [[CONV, A], [CONV, B]];
  const ok = convAdmin(members, { kind: 'dm', name: null }, [[JAM, CONV]]);
  const grant = await authorize(ok, 'jam_invite_dm', A, B, { conversationId: CONV, jamRoomId: JAM });
  assertEquals(grant?.jamRoomId, JAM);

  const elsewhere = convAdmin(members, { kind: 'dm', name: null }, [[JAM, C]]);
  assertEquals(await allows(elsewhere, 'jam_invite_dm', A, B, { conversationId: CONV, jamRoomId: JAM }), false);
  assertEquals(await allows(ok, 'jam_invite_dm', A, B, { conversationId: CONV }), false);
});

Deno.test('friend_accepted / jam: require an accepted friendship', async () => {
  const friends = fakeAdmin(() => ({ count: 1 }));
  const strangers = fakeAdmin(() => ({ count: 0 }));
  assertEquals(await allows(friends, 'friend_accepted', A, B), true);
  assertEquals(await allows(friends, 'jam_started', A, B), true);
  assertEquals(await allows(strangers, 'jam_join', A, B), false);
});

Deno.test('new_fan / new_follower: require a star edge actor -> recipient', async () => {
  const starred = fakeAdmin(() => ({ count: 1 }));
  const not = fakeAdmin(() => ({ count: 0 }));
  assertEquals(await allows(starred, 'new_fan', A, B), true);
  assertEquals(await allows(not, 'new_follower', A, B), false);
});

// ── activity_*: the row activity_notify_post wrote ─────────────────────────
//
// The old gate asked only "has the recipient ever posted?" — true of every creator, so any
// signed-in user could push any text to any creator's lock screen. These require the row
// the RPC writes after it checked the like / comment / repost really happened.

Deno.test('activity_*: being an author is no longer enough', async () => {
  // The exact fake the old test passed with: the recipient has posts, nothing else.
  const author = fakeAdmin(() => ({ count: 2, data: [] }));
  assertEquals(await allows(author, 'activity_like', A, B), false);
  assertEquals(await allows(author, 'activity_comment', A, B), false);
  assertEquals(await allows(author, 'activity_repost', A, B), false);
  assertEquals(await allows(author, 'activity_comment_like', A, B), false);
  assertEquals(await allows(author, 'activity_comment_reply', A, B), false);
});

const NOW = () => new Date().toISOString();
const MINUTES_AGO = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/**
 * activity_notifications / post_views / post_likes, filtered the way PostgREST would —
 * INCLUDING the time bound, so widening the evidence window fails a test instead of
 * silently passing.
 */
const activityAdmin = (
  rows: Array<Record<string, unknown>>,
  plays: Array<{ post_id: string; played_at: string }> = [],
  likes: Array<[string, string]> = [],
  commentLikes: Array<[string, string]> = [],
) =>
  fakeAdmin((table, f) => {
    if (table === 'activity_notifications') {
      const col = f.updated_at__gte ? 'updated_at' : 'created_at';
      const since = f[`${col}__gte`];
      // Every evidence read must be time-bounded, or an old like is a permanent permit.
      assertEquals(Boolean(since), true);
      return {
        data: rows.filter(r =>
          r.recipient_id === f.recipient_id && r.type === f.type &&
          (f.actor_id === undefined || r.actor_id === f.actor_id) &&
          String(r[col] ?? NOW()) >= since),
      };
    }
    if (table === 'post_views') {
      assertEquals(Boolean(f.played_at__gte), true);
      const asked = (f.post_id__in ?? '').split(',');
      return {
        data: plays.filter(p =>
          f.user_id === A && asked.includes(p.post_id) && p.played_at >= f.played_at__gte),
      };
    }
    if (table === 'post_likes') {
      return { count: likes.filter(([post, user]) => post === f.post_id && user === f.user_id).length };
    }
    if (table === 'post_comment_likes') {
      return { count: commentLikes.filter(([c, user]) => c === f.comment_id && user === f.user_id).length };
    }
    return { count: 0 };
  });

Deno.test('activity_like: allowed by the row naming this actor, with its count', async () => {
  const admin = activityAdmin([
    { recipient_id: B, type: 'like', actor_id: A, agg_count: 3, payload: {}, post_id: POST },
  ]);
  const grant = await authorize(admin, 'activity_like', A, B);
  // postId is the liked post, which the copy's song name is looked up from.
  assertEquals(grant?.activity, { aggCount: 3, commentText: null, postId: POST });
});

Deno.test('activity_like: allowed when a racing like re-pointed actor_id, via notified', async () => {
  const row = { recipient_id: B, type: 'like', actor_id: C, post_id: POST, agg_count: 2, payload: { notified: [C, A] } };
  assertEquals(await allows(activityAdmin([row], [], [[POST, A], [POST, C]]), 'activity_like', A, B), true);
});

Deno.test('activity_like: a former liker named only in notified is refused', async () => {
  // notified is never pruned. Mallory liked, then unliked; Sam's new like re-opens the
  // window. Without the post_likes check this pushed "Mallory liked your post".
  const row = { recipient_id: B, type: 'like', actor_id: C, post_id: POST, agg_count: 1, payload: { notified: [A, C] } };
  assertEquals(await allows(activityAdmin([row], [], [[POST, C]]), 'activity_like', A, B), false);
});

Deno.test('activity_*: evidence older than the window is refused', async () => {
  const stale = MINUTES_AGO(11);
  assertEquals(await allows(activityAdmin([
    { recipient_id: B, type: 'like', actor_id: A, agg_count: 1, payload: {}, updated_at: stale },
  ]), 'activity_like', A, B), false);
  assertEquals(await allows(activityAdmin([
    { recipient_id: B, type: 'comment', actor_id: A, payload: {}, created_at: stale },
  ]), 'activity_comment', A, B), false);
  assertEquals(await allows(activityAdmin([
    { recipient_id: B, type: 'like', actor_id: A, agg_count: 1, payload: {}, updated_at: MINUTES_AGO(9) },
  ]), 'activity_like', A, B), true);
});

Deno.test('activity_like: refused when the row belongs to someone else', async () => {
  const admin = activityAdmin([
    { recipient_id: B, type: 'like', actor_id: C, agg_count: 1, payload: { notified: [C] } },
  ]);
  assertEquals(await allows(admin, 'activity_like', A, B), false);
});

Deno.test('activity_like: refused once every like on the post is taken back', async () => {
  const admin = activityAdmin([{ recipient_id: B, type: 'like', actor_id: A, agg_count: 0, payload: {} }]);
  assertEquals(await allows(admin, 'activity_like', A, B), false);
});

Deno.test('activity_comment: the snippet comes from the stored row, not the request', async () => {
  const admin = activityAdmin([
    { recipient_id: B, type: 'comment', actor_id: A, payload: { comment_text: 'this slaps' } },
  ]);
  const grant = await authorize(admin, 'activity_comment', A, B);
  assertEquals(grant?.activity?.commentText, 'this slaps');
  // A repost row is not evidence of a comment, and vice versa.
  assertEquals(await allows(admin, 'activity_repost', A, B), false);
});

Deno.test('activity_repost: allowed by a repost row from this actor', async () => {
  const admin = activityAdmin([{ recipient_id: B, type: 'repost', actor_id: A, payload: {} }]);
  assertEquals(await allows(admin, 'activity_repost', A, B), true);
  assertEquals(await allows(admin, 'activity_repost', C, B), false);
});

// ── activity_comment_like / activity_comment_reply (20261031000000) ─────────
const COMMENT = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

Deno.test('activity_comment_like: allowed by the row naming this actor, with its count and snippet', async () => {
  const admin = activityAdmin([{
    recipient_id: B, type: 'comment_like', actor_id: A, agg_count: 2, post_id: POST,
    payload: { comment_id: COMMENT, comment_text: 'this slaps', notified: [C, A] },
  }]);
  const grant = await authorize(admin, 'activity_comment_like', A, B);
  assertEquals(grant?.activity, { aggCount: 2, commentText: 'this slaps', postId: POST, commentId: COMMENT });
});

Deno.test('activity_comment_like: via notified only while the like still stands', async () => {
  const row = {
    recipient_id: B, type: 'comment_like', actor_id: C, agg_count: 2, post_id: POST,
    payload: { comment_id: COMMENT, notified: [A, C] },
  };
  assertEquals(await allows(activityAdmin([row], [], [], [[COMMENT, A]]), 'activity_comment_like', A, B), true);
  // Liked, unliked: still in notified, gone from post_comment_likes.
  assertEquals(await allows(activityAdmin([row], [], [], []), 'activity_comment_like', A, B), false);
  // A post like is not a comment like.
  assertEquals(await allows(activityAdmin([row], [], [[POST, A]], []), 'activity_comment_like', A, B), false);
});

Deno.test('activity_comment_like: refused for someone else\'s row, a stale one, or no likes left', async () => {
  assertEquals(await allows(activityAdmin([
    { recipient_id: B, type: 'comment_like', actor_id: C, agg_count: 1, payload: { comment_id: COMMENT, notified: [C] } },
  ]), 'activity_comment_like', A, B), false);
  assertEquals(await allows(activityAdmin([
    { recipient_id: B, type: 'comment_like', actor_id: A, agg_count: 1, payload: {}, updated_at: MINUTES_AGO(11) },
  ]), 'activity_comment_like', A, B), false);
  assertEquals(await allows(activityAdmin([
    { recipient_id: B, type: 'comment_like', actor_id: A, agg_count: 0, payload: {} },
  ]), 'activity_comment_like', A, B), false);
  // A post-like row is not evidence of a comment like, nor the other way round.
  const postLike = activityAdmin([{ recipient_id: B, type: 'like', actor_id: A, agg_count: 1, payload: {} }]);
  assertEquals(await allows(postLike, 'activity_comment_like', A, B), false);
  const commentLike = activityAdmin([{ recipient_id: B, type: 'comment_like', actor_id: A, agg_count: 1, payload: {} }]);
  assertEquals(await allows(commentLike, 'activity_like', A, B), false);
});

Deno.test('activity_comment_like: the comment the app names is the one quoted', async () => {
  const OTHER = 'abababab-abab-abab-abab-abababababab';
  // Riya liked two of Sam's comments a moment apart; the newer row is OTHER's.
  const admin = activityAdmin([
    { recipient_id: B, type: 'comment_like', actor_id: A, agg_count: 1, payload: { comment_id: OTHER, comment_text: 'second' }, updated_at: NOW() },
    { recipient_id: B, type: 'comment_like', actor_id: A, agg_count: 1, payload: { comment_id: COMMENT, comment_text: 'first' }, updated_at: MINUTES_AGO(1) },
  ]);
  assertEquals((await authorize(admin, 'activity_comment_like', A, B, { commentId: COMMENT }))?.activity?.commentText, 'first');
  assertEquals((await authorize(admin, 'activity_comment_like', A, B, { commentId: COMMENT }))?.activity?.commentId, COMMENT);
  // No claim (an older app): the newest, as before.
  assertEquals((await authorize(admin, 'activity_comment_like', A, B))?.activity?.commentText, 'second');
  // A claim naming a comment with no row for this actor proves nothing.
  assertEquals(await allows(admin, 'activity_comment_like', A, B, { commentId: POST }), false);
});

Deno.test('buildPush: likes on one comment share one card', () => {
  const grant: Grant = { activity: { aggCount: 2, commentText: null, postId: POST, commentId: COMMENT } };
  assertEquals(buildPush('activity_comment_like', A, grant, riya, {} as never).data.collapseId, `comment_like:${COMMENT}`);
  // Never a sound-off: that window is for post likes.
  assertEquals(buildPush('activity_comment_like', A, grant, riya, {} as never, { quiet: true }).data.quiet, undefined);
  // A reply keeps a card of its own.
  assertEquals(buildPush('activity_comment_reply', A, grant, riya, {} as never).data.collapseId, undefined);
});

Deno.test('activity_comment_reply: allowed by a reply row from this actor; snippet from the row', async () => {
  const admin = activityAdmin([
    { recipient_id: B, type: 'comment_reply', actor_id: A, post_id: POST, payload: { comment_text: 'haha true' } },
  ]);
  const grant = await authorize(admin, 'activity_comment_reply', A, B);
  assertEquals(grant?.activity, { aggCount: 1, commentText: 'haha true', postId: POST });
  assertEquals(await allows(admin, 'activity_comment_reply', C, B), false);
  // A reply row is not a comment-on-your-post row, and vice versa.
  assertEquals(await allows(admin, 'activity_comment', A, B), false);
  const comment = activityAdmin([{ recipient_id: B, type: 'comment', actor_id: A, payload: {} }]);
  assertEquals(await allows(comment, 'activity_comment_reply', A, B), false);
  // Time-bounded like every other.
  assertEquals(await allows(activityAdmin([
    { recipient_id: B, type: 'comment_reply', actor_id: A, payload: {}, created_at: MINUTES_AGO(11) },
  ]), 'activity_comment_reply', A, B), false);
});

Deno.test('composeContent: comment likes and replies name the comment, not the song', () => {
  const one: Grant = { activity: { aggCount: 1, commentText: 'this slaps', postId: POST } };
  assertEquals(composeContent('activity_comment_like', one, riya, {}),
    { title: 'Riya', body: 'liked your comment: “this slaps”' });
  const three: Grant = { activity: { aggCount: 3, commentText: null, postId: POST }, post: { kind: 'upload', title: 'Kesariya' } };
  assertEquals(composeContent('activity_comment_like', three, riya, {}),
    { title: 'Riya and 2 others', body: 'liked your comment' });
  assertEquals(composeContent('activity_comment_reply', { activity: { aggCount: 1, commentText: 'haha true', postId: POST } }, riya, {}),
    { title: 'Riya', body: 'replied to your comment: “haha true”' });
  assertEquals(composeContent('activity_comment_reply', { activity: { aggCount: 1, commentText: null, postId: POST } }, riya, {}).body,
    'replied to your comment');
  // The request's text never reaches the copy.
  assertEquals(composeContent('activity_comment_reply', one, riya, { body: 'click my link' }).body,
    'replied to your comment: “this slaps”');
});

Deno.test('the comment kinds: activity channel, the actor\'s photo, Activity on tap', () => {
  assertEquals(channelFor('activity_comment_like'), 'activity');
  assertEquals(channelFor('activity_comment_reply'), 'activity');
  assertEquals(isPersonToPerson('activity_comment_like'), true);
  assertEquals(isPersonToPerson('activity_comment_reply'), true);
  const withPhoto = { ...riya, avatarUrl: 'https://lh3.googleusercontent.com/a/abc' };
  const grant: Grant = { activity: { aggCount: 1, commentText: null, postId: POST } };
  assertEquals(buildPush('activity_comment_like', A, grant, withPhoto, {} as never).data.actorAvatarUrl,
    'https://lh3.googleusercontent.com/a/abc');
  assertEquals(buildPush('activity_comment_reply', A, grant, withPhoto, {} as never).data.actorAvatarUrl,
    'https://lh3.googleusercontent.com/a/abc');
  assertEquals(routeFor('activity_comment_reply', 'ActivityCenter', grant, A), { route: 'ActivityCenter', params: {} });
  assertEquals(routeFor('activity_comment_like', 'Conversation', grant, A), { route: 'ActivityCenter', params: {} });
});

Deno.test('activity_*: an errored read denies', async () => {
  const admin = fakeAdmin(() => ({ error: { message: 'boom' } }));
  assertEquals(await allows(admin, 'activity_like', A, B), false);
  assertEquals(await allows(admin, 'activity_comment', A, B), false);
  assertEquals(await allows(admin, 'activity_milestone', A, B), false);
  assertEquals(await allows(admin, 'activity_comment_like', A, B), false);
  assertEquals(await allows(admin, 'activity_comment_reply', A, B), false);
});

// ── activity_milestone: a listener's play crossed the author's threshold ─────

Deno.test('activity_milestone: allowed for the listener whose play crossed it', async () => {
  // Before this change the kind was allowed ONLY self-targeted, which the RPC never
  // produces (it skips the author's own plays) — so no milestone push was ever delivered.
  // The RPC writes the play and the milestone in one transaction: same now().
  const at = MINUTES_AGO(1);
  const row = { recipient_id: B, type: 'play_milestone', post_id: POST, payload: { threshold: 1000 }, created_at: at };
  const grant = await authorize(activityAdmin([row], [{ post_id: POST, played_at: at }]), 'activity_milestone', A, B);
  assertEquals(grant?.milestone, 1000);
  // …and remembers which of the recipient's posts it was, so the push can name the song.
  assertEquals(grant?.milestonePostId, POST);
});

Deno.test('activity_milestone: another recent listener cannot re-announce it', async () => {
  // A's play is recent, but not the one that crossed the threshold.
  const row = { recipient_id: B, type: 'play_milestone', post_id: POST, payload: { threshold: 100 }, created_at: MINUTES_AGO(1) };
  const earlier = { post_id: POST, played_at: MINUTES_AGO(2) };
  assertEquals(await allows(activityAdmin([row], [earlier]), 'activity_milestone', A, B), false);
  assertEquals(await allows(activityAdmin([row], []), 'activity_milestone', A, B), false);
  assertEquals(await allows(activityAdmin([], [earlier]), 'activity_milestone', A, B), false);
});

Deno.test('friend_request: requires a pending request from actor -> recipient', async () => {
  const pending = fakeAdmin(() => ({ count: 1 }));
  const none = fakeAdmin(() => ({ count: 0 }));
  assertEquals(await allows(pending, 'friend_request', A, B), true);
  assertEquals(await allows(none, 'friend_request', A, B), false);
});

Deno.test('self-targeting is refused for every kind but badge_granted; unknown kinds denied', async () => {
  const any = fakeAdmin(() => ({ count: 1, data: [{ user_id: A }] }));
  for (const kind of KINDS) {
    if (kind === 'badge_granted') continue;
    assertEquals(await allows(any, kind, A, A, { conversationId: CONV }), false, kind);
    // Postgres ignores uuid case; the self-target comparison must too.
    assertEquals(await allows(any, kind, A, A.toUpperCase(), { conversationId: CONV }), false, kind);
  }
  assertEquals(await allows(any, 'totally_unknown', A, B), false);
});

// ── badge_granted: the first kind dispatched from the ops dashboard ─────────
//
// Two conditions, both required, and the second is the one that matters. Without it an
// operator could push "your account is verified" to anybody — and a push notification is
// the most credible surface Livil has. The claim must be true when it is sent.

/** Ops membership and badge holding, scripted independently. */
const badgeAdmin = (isOps: boolean, recipientHolds: boolean) =>
  fakeAdmin((table, filters) => {
    if (table === 'ops_users') {
      return { count: isOps && filters.user_id === A ? 1 : 0 };
    }
    if (table === 'profile_badges') {
      // The query must ask for LIVE badges. A rule that counted revoked ones would
      // announce a badge the person no longer has.
      assertEquals(filters.revoked_at, 'null');
      return { count: recipientHolds && filters.user_id === B ? 1 : 0 };
    }
    return { count: 0 };
  });

Deno.test('badge_granted: an operator may announce a badge the recipient really holds', async () => {
  assertEquals(await allows(badgeAdmin(true, true), 'badge_granted', A, B), true);
});

Deno.test('badge_granted: a non-ops caller is refused even when the badge is real', async () => {
  // The spam vector: anyone signed in pushing "you're verified" to anyone.
  assertEquals(await allows(badgeAdmin(false, true), 'badge_granted', A, B), false);
});

Deno.test('badge_granted: an operator cannot announce a badge nobody holds', async () => {
  // The lie vector, and the reason the second condition exists at all.
  assertEquals(await allows(badgeAdmin(true, false), 'badge_granted', A, B), false);
});

Deno.test('badge_granted: an operator granting to THEMSELVES is allowed', async () => {
  // Happens routinely — the first account anyone tests with is their own. This is why the
  // rule runs BEFORE the self-target shortcut: falling through to selfTargetAllowed()
  // would refuse a legitimate grant.
  const admin = fakeAdmin((table, filters) => {
    if (table === 'ops_users') return { count: filters.user_id === A ? 1 : 0 };
    if (table === 'profile_badges') return { count: filters.user_id === A ? 1 : 0 };
    return { count: 0 };
  });
  assertEquals(await allows(admin, 'badge_granted', A, A), true);
});

Deno.test('badge_granted: a NON-ops user cannot push themselves a fake badge notice', async () => {
  // The other half of running before the shortcut. If selfTargetAllowed('badge_granted')
  // were true, this would pass — any signed-in user notifying themselves they are
  // verified, with no badge anywhere. The ops check is what refuses it.
  const admin = fakeAdmin((table, filters) => {
    if (table === 'ops_users') return { count: 0 };
    if (table === 'profile_badges') return { count: filters.user_id === B ? 1 : 0 };
    return { count: 0 };
  });
  assertEquals(await allows(admin, 'badge_granted', B, B), false);
});

// ── the gate must FAIL CLOSED ───────────────────────────────────────────────
//
// The mutation that survived every other test: `(ops.count ?? 0)` → `(ops.count ?? 1)`.
// PostgREST resolves to `{ data, error, count }` without throwing, so a failed read yields
// `count: null` — and `?? 1` would turn "the database did not answer" into "allow", letting
// any signed-in user push a badge notice to anyone. The current `?? 0` denies instead.
//
// This is the polarity contrast with isCategoryMuted above, which deliberately allows by
// default: a preference that fails closed silences somebody with no error to see, whereas
// an authorization that fails open is an open door.

Deno.test('badge_granted: an errored ops_users read denies rather than allows', async () => {
  const admin = fakeAdmin(table => (table === 'ops_users'
    ? { error: { message: 'boom' } }          // no `count` key at all
    : { count: 1 }));
  assertEquals(await allows(admin, 'badge_granted', A, B), false);
});

Deno.test('badge_granted: an errored profile_badges read denies rather than allows', async () => {
  const admin = fakeAdmin(table => (table === 'profile_badges'
    ? { error: { message: 'boom' } }
    : { count: 1 }));
  assertEquals(await allows(admin, 'badge_granted', A, B), false);
});

// The product rule, asserted on the ANSWER rather than on the query shape. The structural
// check inside badgeAdmin pins that `.is('revoked_at', null)` was written; this pins what
// it is FOR — a revoked badge must not be announceable.
Deno.test('badge_granted: a revoked badge cannot be announced', async () => {
  const admin = fakeAdmin((table, filters) => {
    if (table === 'ops_users') return { count: 1 };
    if (table === 'profile_badges') {
      // Scripted as the database would answer: rows exist, but none that are live.
      return { count: filters.revoked_at === 'null' ? 0 : 1 };
    }
    return { count: 0 };
  });
  assertEquals(await allows(admin, 'badge_granted', A, B), false);
});

// ── CORS: the ops dashboard is the first BROWSER caller ─────────────────────
//
// Every caller before badge_granted was React Native, which issues no preflight, so the
// function never handled OPTIONS. The dashboard's grant produced `OPTIONS | 405` in
// production and the POST was never sent — a failed preflight raises no application error,
// so the only trace was the edge log.

Deno.test('OPTIONS preflight is answered, not rejected as a bad method', async () => {
  const res = await handler(new Request('https://x/send-push', { method: 'OPTIONS' }));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get('access-control-allow-origin'), '*');
  // The browser refuses to send an Authorization header unless the preflight names it.
  const allowed = res.headers.get('access-control-allow-headers') ?? '';
  assertEquals(allowed.includes('authorization'), true);
  assertEquals(allowed.includes('content-type'), true);
});

Deno.test('a genuinely wrong method is still refused', async () => {
  // The preflight branch must not become a catch-all for anything that is not POST.
  const res = await handler(new Request('https://x/send-push', { method: 'GET' }));
  assertEquals(res.status, 405);
});

Deno.test('error responses carry CORS headers too', async () => {
  // Without these the browser hides the real status behind an opaque CORS failure, and a
  // 401 or 403 becomes impossible to debug from the dashboard.
  const res = await handler(new Request('https://x/send-push', { method: 'POST' }));
  assertEquals(res.status, 401);
  assertEquals(res.headers.get('access-control-allow-origin'), '*');
});

// ── blocks ──────────────────────────────────────────────────────────────────

Deno.test('isBlockedBetween: checks BOTH directions', async () => {
  let expr = '';
  const admin = fakeAdmin((table, f) => {
    assertEquals(table, 'blocked_users');
    expr = f.__or ?? '';
    return { count: 1 };
  });
  assertEquals(await isBlockedBetween(admin, A, B), true);
  assertEquals(expr.includes(`blocker_id.eq.${A},blocked_id.eq.${B}`), true);
  assertEquals(expr.includes(`blocker_id.eq.${B},blocked_id.eq.${A}`), true);
});

Deno.test('blocks: group-conversation pushes are stopped too', () => {
  // A blocked member's group message still lands in the group (the database bars only the
  // DM), but no longer buzzes the person who blocked them — and they cannot send that person
  // a group "message" preview nobody else sees. The gate is by kind, never by conversation.
  for (const kind of ['message', 'reaction', 'jam_invite_dm']) {
    assertEquals(isPersonToPerson(kind), true, kind);
  }
});

Deno.test('isBlockedBetween: no block → false; a failed read counts as blocked', async () => {
  assertEquals(await isBlockedBetween(fakeAdmin(() => ({ count: 0 })), A, B), false);
  // Fails closed: part of the perimeter, and the cost is one undelivered notification.
  assertEquals(await isBlockedBetween(fakeAdmin(() => ({ error: { message: 'boom' } })), A, B), true);
});

// ── what the notification says: server-derived ─────────────────────────────

const riya = { displayName: 'Riya', username: 'riya' };
const dm: Grant = { conversation: { id: CONV, kind: 'dm', name: null } };
const group: Grant = { conversation: { id: CONV, kind: 'group', name: 'Weekend Crew' } };

Deno.test('composeContent: relationship kinds ignore caller title and body', () => {
  const forged = { title: 'Livil', body: 'Your account is suspended. Verify at evil.example' };
  assertEquals(composeContent('friend_request', {}, riya, forged), {
    title: 'Riya', body: 'sent you a friend request',
  });
  assertEquals(composeContent('jam_ended', {}, riya, forged), { title: 'Riya', body: 'ended the Jam' });
});

Deno.test('composeContent: activity kinds are built from the proven row, not the request', () => {
  const forged = { body: 'Livil: your account is suspended' };
  assertEquals(
    composeContent('activity_like', { activity: { aggCount: 1, commentText: null } }, riya, forged),
    { title: 'Riya', body: 'liked your post' },
  );
  assertEquals(
    composeContent('activity_like', { activity: { aggCount: 3, commentText: null } }, riya, forged),
    { title: 'Riya and 2 others', body: 'liked your post' },
  );
  assertEquals(
    composeContent('activity_like', { activity: { aggCount: 2, commentText: null } }, riya, forged).title,
    'Riya and 1 other',
  );
  assertEquals(
    composeContent('activity_comment', { activity: { aggCount: 1, commentText: 'this  slaps\n' } }, riya, forged),
    { title: 'Riya', body: 'commented on your post: “this slaps”' },
  );
  assertEquals(
    composeContent('activity_repost', { activity: { aggCount: 1, commentText: null } }, riya, forged),
    { title: 'Riya', body: 'reposted your track' },
  );
});

Deno.test('composeContent: activity names fall back to @username, as the Activity row does', () => {
  const noName = { displayName: null, username: 'riya' };
  assertEquals(
    composeContent('activity_repost', { activity: { aggCount: 1, commentText: null } }, noName, {}),
    { title: '@riya', body: 'reposted your track' },
  );
});

Deno.test('composeContent: a long comment is trimmed the way the Activity row trims it', () => {
  const long = 'x'.repeat(200);
  const body = composeContent('activity_comment', { activity: { aggCount: 1, commentText: long } }, riya, {}).body;
  assertEquals(body, `commented on your post: “${'x'.repeat(79)}…”`);
});

Deno.test('composeContent: milestone and badge copy come from the proven facts', () => {
  assertEquals(composeContent('activity_milestone', { milestone: 1000 }, riya, { body: 'hacked' }), {
    title: 'Livil', body: 'Your track hit 1K plays 🎉',
  });
  // The song is named once describePost could read it; the first milestone greets listeners.
  const song = { kind: 'upload' as const, title: 'Midnight Chai' };
  assertEquals(composeContent('activity_milestone', { milestone: 25, post: song }, riya, {}).body,
    '“Midnight Chai” hit 25 plays 🎉');
  assertEquals(composeContent('activity_milestone', { milestone: 5, post: song }, riya, {}).body,
    'Your first listeners are in 🎉 “Midnight Chai” hit 5 plays');
  assertEquals(composeContent('activity_milestone', { milestone: 5 }, riya, {}).body,
    'Your first listeners are in 🎉 Your track hit 5 plays');
  assertEquals(composeContent('badge_granted', { badge: 'verified' }, riya, { body: 'hacked' }).body,
    'Your account is now verified ✓');
  assertEquals(composeContent('badge_granted', { badge: 'first_100' }, riya, {}).body,
    'You received the First 100 badge 🎉');
  assertEquals(composeContent('badge_granted', { badge: null }, riya, {}).body,
    'You received a badge on Livil');
});

Deno.test('milestoneLabel matches the client', () => {
  assertEquals(milestoneLabel(5), '5');
  assertEquals(milestoneLabel(500), '500');
  assertEquals(milestoneLabel(1000), '1K');
  assertEquals(milestoneLabel(1500), '1.5K');
  assertEquals(milestoneLabel(10000), '10K');
});

Deno.test('composeContent: a DM is titled with the SENDER, never the caller title', () => {
  // Shipped clients send no title for DMs; a forged one must not become "Livil".
  assertEquals(composeContent('message', dm, riya, { title: 'Livil', body: 'hey!' }), {
    title: 'Riya', body: 'hey!',
  });
});

Deno.test('composeContent: a group message is titled with the group and prefixed with the SENDER', () => {
  // What every shipped client sends: "@<own handle>: <preview>". Not doubled.
  assertEquals(composeContent('message', group, riya, { body: '@riya: see you at 8' }), {
    title: 'Weekend Crew', body: '@riya: see you at 8',
  });
  // Impersonating another member puts the real sender in front of the forgery.
  assertEquals(composeContent('message', group, riya, { body: '@sam: I quit' }).body, '@riya: @sam: I quit');
  // A client that lost the sender's handle still gets the prefix.
  assertEquals(composeContent('message', group, riya, { body: 'hi' }).body, '@riya: hi');
});

Deno.test('composeContent: message bodies are clamped', () => {
  assertEquals(composeContent('message', dm, riya, { body: 'a'.repeat(1000) }).body.length, 240);
  assertEquals(composeContent('message', dm, riya, { body: 42 }).body, 'sent you a message');
});

Deno.test('reactionEmoji: takes a short emoji sequence and nothing else', () => {
  assertEquals(reactionEmoji('reacted 🔥 to your message'), '🔥');
  assertEquals(reactionEmoji('reacted ❤️ to your message'), '❤️');
  assertEquals(reactionEmoji('reacted 👍🏽 to your message'), '👍🏽');
  assertEquals(reactionEmoji('reacted 👩‍👩‍👧 to your message'), '👩‍👩‍👧');
  assertEquals(reactionEmoji('reacted 🇮🇳 to your message'), '🇮🇳');
  assertEquals(reactionEmoji('reacted 1️⃣ to your message'), '1️⃣');
  // Words smuggled into the emoji slot.
  assertEquals(reactionEmoji('reacted 🔥. Your account is suspended. Verify now 🔥 to your message'), null);
  assertEquals(reactionEmoji('reacted 123 to your message'), null);
  assertEquals(reactionEmoji('Your account is suspended'), null);
  assertEquals(reactionEmoji(undefined), null);
});

Deno.test('composeContent: reactions — DM, group, and a forged body', () => {
  assertEquals(composeContent('reaction', dm, riya, { body: 'reacted 🔥 to your message' }), {
    title: 'Riya', body: 'reacted 🔥 to your message',
  });
  assertEquals(composeContent('reaction', group, riya, { body: 'reacted 🔥 to your message' }), {
    title: 'Weekend Crew', body: '@riya reacted 🔥 to your message',
  });
  assertEquals(composeContent('reaction', dm, riya, { body: 'Livil: your account is suspended' }).body,
    'reacted to your message');
});

// ── where a tap opens: allowlisted, with verified params ────────────────────

Deno.test('routeFor: a route outside the kind\'s list becomes the default', () => {
  assertEquals(routeFor('activity_like', 'ChangePassword', {}, A), { route: 'ActivityCenter', params: {} });
  assertEquals(routeFor('friend_request', undefined, {}, A), { route: 'FriendRequests', params: {} });
  assertEquals(routeFor('jam_ended', { evil: true }, {}, A), { route: 'Inbox', params: {} });
});

Deno.test('routeFor: every shipped route for every kind is still honoured', () => {
  // The routes each released build sends (verified back to 46a687c).
  assertEquals(routeFor('message', 'Conversation', dm, A), { route: 'Conversation', params: { conversationId: CONV } });
  assertEquals(routeFor('reaction', 'Conversation', dm, A).route, 'Conversation');
  assertEquals(
    routeFor('jam_invite_dm', 'JamRoom', { ...dm, jamRoomId: JAM }, A),
    { route: 'JamRoom', params: { jamRoomId: JAM, conversationId: CONV } },
  );
  assertEquals(routeFor('new_fan', 'ActivityCenter', {}, A).route, 'ActivityCenter');
  // The first push builds opened the actor's profile for these two.
  assertEquals(routeFor('new_fan', 'UserProfile', {}, A), { route: 'UserProfile', params: { userId: A } });
  assertEquals(routeFor('friend_accepted', 'UserProfile', {}, A).params.userId, A);
  assertEquals(routeFor('badge_granted', 'ActivityCenter', { badge: 'verified' }, A).route, 'ActivityCenter');
});

Deno.test('routeFor: Conversation without a verified conversation falls back to Inbox', () => {
  assertEquals(routeFor('message', 'Conversation', {}, A), { route: 'Inbox', params: {} });
});

// ── the whole payload: the D-45 overwrite, end to end ───────────────────────
//
// The request below is the attack as it worked before this change: the params loop ran
// AFTER kind/channelId/title/body were set, so params overwrote all four (past the length
// clamp), set kind 'message' to get the chat-style card, and injected an avatar.

const attack = {
  recipientUserId: B,
  kind: 'activity_like',
  title: 'Livil',
  body: 'Your account is suspended. Verify at evil.example',
  data: {
    route: 'ChangePassword',
    params: {
      kind: 'message',
      channelId: 'messages',
      title: 'Livil Security',
      body: 'Your account is suspended. Verify at evil.example',
      route: 'ChangePassword',
      actorAvatarUrl: 'https://evil.example/livil-logo.png',
      actorDisplayName: 'Livil Security',
      actorUserId: C,
      conversationId: CONV,
      extra: 'anything',
    },
  },
};

Deno.test('buildPush: caller params cannot overwrite or add any key', () => {
  const grant: Grant = { activity: { aggCount: 1, commentText: null } };
  const { title, body, data } = buildPush('activity_like', A, grant, riya, attack);
  assertEquals(title, 'Riya');
  assertEquals(body, 'liked your post');
  assertEquals(data, {
    route: 'ActivityCenter',
    kind: 'activity_like',
    channelId: 'activity',
    title: 'Riya',
    body: 'liked your post',
    actorUserId: A,
  });
});

Deno.test('buildPush: a message keeps the shipped shape, from verified facts only', () => {
  // Exactly what src/services/messages.ts sends for a group message.
  const shipped = {
    recipientUserId: B,
    kind: 'message',
    title: 'Weekend Crew',
    body: '@riya: see you at 8',
    data: { route: 'Conversation', params: { conversationId: CONV, title: 'Weekend Crew' } },
  };
  const { data } = buildPush('message', A, group, riya, shipped);
  assertEquals(data, {
    conversationId: CONV,
    route: 'Conversation',
    kind: 'message',
    channelId: 'messages',
    title: 'Weekend Crew',
    body: '@riya: see you at 8',
    actorUserId: A,
  });
});

Deno.test('buildPush: the operator and the milestone listener stay anonymous', () => {
  assertEquals(buildPush('badge_granted', A, { badge: 'verified' }, riya, {}).data.actorUserId, undefined);
  assertEquals(buildPush('activity_milestone', A, { milestone: 5 }, riya, {}).data.actorUserId, undefined);
});

Deno.test('buildPush: every data value is a string (FCM rejects anything else)', () => {
  for (const kind of KINDS) {
    const grant: Grant = { ...dm, jamRoomId: JAM, activity: { aggCount: 1, commentText: null }, milestone: 5, badge: null };
    const { data } = buildPush(kind, A, grant, riya, attack);
    for (const [k, v] of Object.entries(data)) assertEquals(typeof v, 'string', `${kind}.${k}`);
  }
});

// ── token pruning: only when the TOKEN is the problem ───────────────────────

const fcmErr = (status: string, details: unknown[] = [], message = 'x') =>
  ({ error: { status, message, details } });
const fcmCode = (errorCode: string) =>
  ({ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode });

Deno.test('shouldPruneToken: dead tokens are pruned', () => {
  assertEquals(shouldPruneToken(404, fcmErr('NOT_FOUND', [fcmCode('UNREGISTERED')])), true);
  assertEquals(shouldPruneToken(403, fcmErr('PERMISSION_DENIED', [fcmCode('SENDER_ID_MISMATCH')])), true);
  assertEquals(shouldPruneToken(400, fcmErr('INVALID_ARGUMENT', [
    fcmCode('INVALID_ARGUMENT'),
    { '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'message.token', description: 'Invalid registration token' }] },
  ])), true);
  assertEquals(shouldPruneToken(400, fcmErr('INVALID_ARGUMENT', [fcmCode('INVALID_ARGUMENT')],
    'The registration token is not a valid FCM registration token')), true);
});

Deno.test('shouldPruneToken: OUR mistakes and outages never delete a device', () => {
  // A malformed payload: every device would 400 at once, and every token was deleted.
  assertEquals(shouldPruneToken(400, fcmErr('INVALID_ARGUMENT', [
    fcmCode('INVALID_ARGUMENT'),
    { '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'message.data[0].value', description: 'Invalid value' }] },
  ], 'Invalid value at \'message.data[0].value\'')), false);
  // An APNs credential problem hits every iOS token at once.
  assertEquals(shouldPruneToken(401, fcmErr('UNAUTHENTICATED', [fcmCode('THIRD_PARTY_AUTH_ERROR')])), false);
  assertEquals(shouldPruneToken(429, fcmErr('RESOURCE_EXHAUSTED', [fcmCode('QUOTA_EXCEEDED')])), false);
  assertEquals(shouldPruneToken(500, fcmErr('INTERNAL', [fcmCode('INTERNAL')])), false);
  assertEquals(shouldPruneToken(503, fcmErr('UNAVAILABLE', [fcmCode('UNAVAILABLE')])), false);
  // A bare 404 (e.g. a wrong FCM_PROJECT_ID in the URL) is not proof the token is dead.
  assertEquals(shouldPruneToken(404, null), false);
  assertEquals(shouldPruneToken(400, null), false);
});

// ── claims: the only part of params that is read ───────────────────────────

Deno.test('claimsFrom: reads conversationId, jamRoomId, commentId and notificationId from data.params, nothing else', () => {
  assertEquals(
    claimsFrom({ data: { route: 'JamRoom', params: { jamRoomId: JAM, conversationId: CONV, title: 'x' } } }),
    { conversationId: CONV, jamRoomId: JAM, commentId: undefined, notificationId: undefined },
  );
  // A comment like names its comment (activity_comment_like) — a claim, only ever matched.
  assertEquals(
    claimsFrom({ data: { route: 'ActivityCenter', params: { commentId: POST, body: 'x' } } }),
    { conversationId: undefined, jamRoomId: undefined, commentId: POST, notificationId: undefined },
  );
  // A mention names its row (activity_mention) — claimed once, by claim_mention_push.
  assertEquals(
    claimsFrom({ data: { route: 'ActivityCenter', params: { notificationId: POST } } }).notificationId,
    POST,
  );
  assertEquals(claimsFrom({}), {});
  assertEquals(claimsFrom({ data: null }), {});
  // deno-lint-ignore no-explicit-any
  assertEquals(claimsFrom({ data: { params: 'nope' as any } }), {});
});

// ── every request the store app sends today still works ─────────────────────
//
// The literal request bodies of release 1aa88a7 (2.1.2), re-checked against 2.1.3 (77) at
// 1c56cd0 — the only call-site change is a group preview's wording, not its shape —
// (src/services/*.ts → pushDispatch.ts) and
// of the ops dashboard (web/src/data/push.ts), run through the same three steps the
// handler runs: claimsFrom → authorize → buildPush. The database is scripted to hold the
// rows each call site's own RPC or insert has just written. A gate that stops accepting a
// shipped shape fails here, not on users' phones.

/** One database in which every relationship the shipped call sites rely on exists. */
const shippedWorld = () => {
  const at = new Date().toISOString();
  return fakeAdmin((table, f) => {
    switch (table) {
      case 'conversation_members': {
        const wanted = (f.user_id__in ?? '').split(',');
        return { data: f.conversation_id === CONV ? [A, B].filter(u => wanted.includes(u)).map(user_id => ({ user_id })) : [] };
      }
      case 'conversations': return { data: f.id === CONV ? { kind: 'group', name: 'Weekend Crew' } : null };
      case 'jam_rooms': return { count: f.id === JAM && f.conversation_id === CONV ? 1 : 0 };
      case 'friendships': return { count: 1 };
      case 'follows': return { count: f.follower_id === A && f.following_id === B ? 1 : 0 };
      case 'activity_notifications': {
        const rows: Record<string, Array<Record<string, unknown>>> = {
          like: [{ actor_id: A, post_id: POST, agg_count: 3, payload: { notified: [A] } }],
          comment: [{ payload: { comment_text: 'this slaps' } }],
          repost: [{ payload: {} }],
          play_milestone: [{ post_id: POST, payload: { threshold: 100 }, created_at: at }],
        };
        return { data: f.recipient_id === B ? rows[f.type] ?? [] : [] };
      }
      case 'post_views': return { data: [{ post_id: POST, played_at: at }] };
      case 'ops_users': return { count: f.user_id === A ? 1 : 0 };
      case 'profile_badges': return f.__limit ? { data: [{ badge: 'verified' }] } : { count: 1 };
      default: return { count: 0 };
    }
  });
};

const SHIPPED: Array<{ site: string; req: Record<string, unknown>; title: string; body: string; route: string }> = [
  { site: 'relationships.ts sendFriendRequest',
    req: { recipientUserId: B, kind: 'friend_request', data: { route: 'FriendRequests' } },
    title: 'Riya', body: 'sent you a friend request', route: 'FriendRequests' },
  { site: 'activity.ts notifyFriendOutcome',
    req: { recipientUserId: B, kind: 'friend_accepted', data: { route: 'ActivityCenter' } },
    title: 'Riya', body: 'accepted your friend request', route: 'ActivityCenter' },
  { site: 'activity.ts notifyNewFan',
    req: { recipientUserId: B, kind: 'new_fan', data: { route: 'ActivityCenter' } },
    title: 'Riya', body: 'started following you', route: 'ActivityCenter' },
  { site: 'activity.ts notifyPostActivity (like)',
    req: { recipientUserId: B, kind: 'activity_like', title: 'Livil', body: 'Riya and 2 others liked your post', data: { route: 'ActivityCenter' } },
    title: 'Riya and 2 others', body: 'liked your post', route: 'ActivityCenter' },
  { site: 'activity.ts notifyPostActivity (comment)',
    req: { recipientUserId: B, kind: 'activity_comment', title: 'Livil', body: 'Riya commented on your post: “this slaps”', data: { route: 'ActivityCenter' } },
    title: 'Riya', body: 'commented on your post: “this slaps”', route: 'ActivityCenter' },
  { site: 'activity.ts notifyPostActivity (repost)',
    req: { recipientUserId: B, kind: 'activity_repost', title: 'Livil', body: 'Riya reposted your track', data: { route: 'ActivityCenter' } },
    title: 'Riya', body: 'reposted your track', route: 'ActivityCenter' },
  { site: 'posts.ts recordPlay (milestone)',
    req: { recipientUserId: B, kind: 'activity_milestone', title: 'Livil', body: 'Your track hit 100 plays 🎉', data: { route: 'ActivityCenter' } },
    title: 'Livil', body: 'Your track hit 100 plays 🎉', route: 'ActivityCenter' },
  { site: 'messages.ts dispatchMessagePush (group text)',
    req: { recipientUserId: B, kind: 'message', title: 'Weekend Crew', body: '@riya: see you at 8', data: { route: 'Conversation', params: { conversationId: CONV, title: 'Weekend Crew' } } },
    title: 'Weekend Crew', body: '@riya: see you at 8', route: 'Conversation' },
  { site: 'messages.ts addReaction',
    req: { recipientUserId: B, kind: 'reaction', body: 'reacted 🔥 to your message', data: { route: 'Conversation', params: { conversationId: CONV, title: '' } } },
    title: 'Weekend Crew', body: '@riya reacted 🔥 to your message', route: 'Conversation' },
  { site: 'messages.ts dispatchMessagePush (jam invite)',
    req: { recipientUserId: B, kind: 'jam_invite_dm', data: { route: 'JamRoom', params: { jamRoomId: JAM, conversationId: CONV } } },
    title: 'Riya', body: 'invited you to a Jam', route: 'JamRoom' },
  { site: 'jamRooms.ts endJamRoom',
    req: { recipientUserId: B, kind: 'jam_ended', data: { route: 'Inbox' } },
    title: 'Riya', body: 'ended the Jam', route: 'Inbox' },
  { site: 'web/src/data/push.ts sendBadgePush',
    req: { recipientUserId: B, kind: 'badge_granted', title: 'Livil', body: 'Your account is now verified ✓', data: { route: 'ActivityCenter' } },
    title: 'Livil', body: 'Your account is now verified ✓', route: 'ActivityCenter' },
];

for (const c of SHIPPED) {
  Deno.test(`shipped request still delivers: ${c.site}`, async () => {
    const req = c.req as Parameters<typeof buildPush>[4];
    const kind = req.kind as string;
    assertEquals(isValidKind(kind), true);
    const grant = await authorize(shippedWorld(), kind, A, B, claimsFrom(req));
    assertEquals(grant !== null, true, `${c.site} was refused`);
    const { title, body, data } = buildPush(kind, A, grant!, riya, req);
    assertEquals({ title, body, route: data.route }, { title: c.title, body: c.body, route: c.route });
  });
}

// ── Naming the song, and the actor's photo (notifications #2) ─────────────────────────────

const SUPA = 'https://fqzrmqnlgjeuxzinbqvs.supabase.co';
const SPOTIFY_ID = 'AAAAAAAAAAAAAAAAAAAAAA';

Deno.test('postPhrase: names the song by what the post is, and falls back to "your post"', () => {
  assertEquals(postPhrase({ kind: 'repost', title: 'Blinding Lights' }), 'your repost of “Blinding Lights”');
  assertEquals(postPhrase({ kind: 'upload', title: 'Monsoon Letters' }), 'your track “Monsoon Letters”');
  assertEquals(postPhrase({ kind: 'repost', title: null }), 'your post');
  assertEquals(postPhrase(undefined), 'your post');
});

Deno.test('composeContent: like / comment / repost name the song when it is known', () => {
  const spotify: Grant = {
    activity: { aggCount: 1, commentText: null, postId: POST },
    post: { kind: 'repost', title: 'Blinding Lights' },
  };
  assertEquals(composeContent('activity_like', spotify, riya, {} as never),
    { title: 'Riya', body: 'liked your repost of “Blinding Lights”' });

  const three: Grant = { ...spotify, activity: { aggCount: 3, commentText: null, postId: POST } };
  assertEquals(composeContent('activity_like', three, riya, {} as never),
    { title: 'Riya and 2 others', body: 'liked your repost of “Blinding Lights”' });

  const comment: Grant = { ...spotify, activity: { aggCount: 1, commentText: 'on repeat', postId: POST } };
  assertEquals(composeContent('activity_comment', comment, riya, {} as never),
    { title: 'Riya', body: 'commented on your repost of “Blinding Lights”: “on repeat”' });

  const repost: Grant = {
    activity: { aggCount: 1, commentText: null, postId: POST },
    post: { kind: 'upload', title: 'Monsoon Letters' },
  };
  assertEquals(composeContent('activity_repost', repost, riya, {} as never),
    { title: 'Riya', body: 'reposted your track “Monsoon Letters”' });
});

Deno.test('composeContent: an unknown song falls back to "your post" / "your track"', () => {
  const unknown: Grant = { activity: { aggCount: 1, commentText: null, postId: POST } };
  assertEquals(composeContent('activity_like', unknown, riya, {} as never).body, 'liked your post');
  assertEquals(composeContent('activity_repost', unknown, riya, {} as never).body, 'reposted your track');
});

Deno.test('isAllowedAvatarUrl: only this project\'s avatars bucket and Google account photos', () => {
  assertEquals(isAllowedAvatarUrl(`${SUPA}/storage/v1/object/public/avatars/a/me.jpg`, SUPA), true);
  assertEquals(isAllowedAvatarUrl(`${SUPA}/`.slice(0, -1) + '/storage/v1/object/public/avatars/x.png', `${SUPA}/`), true);
  assertEquals(isAllowedAvatarUrl('https://lh3.googleusercontent.com/a/abc=s96-c', SUPA), true);
  assertEquals(isAllowedAvatarUrl('https://evil.example/pixel.png', SUPA), false);
  assertEquals(isAllowedAvatarUrl(`${SUPA}/storage/v1/object/public/tracks-media/x.png`, SUPA), false);
  assertEquals(isAllowedAvatarUrl('https://lh3.googleusercontent.com.evil.example/x', SUPA), false);
  assertEquals(isAllowedAvatarUrl(null, SUPA), false);
});

Deno.test('isAllowedAvatarUrl: no way out of the host or the bucket', () => {
  const bucket = `${SUPA}/storage/v1/object/public/avatars`;
  for (const bad of [
    // off-host
    'https://lh3.googleusercontent.com@evil.example/x',
    `${SUPA}.evil.example/storage/v1/object/public/avatars/x.png`,
    `${SUPA}@evil.example/storage/v1/object/public/avatars/x.png`,
    'http://lh3.googleusercontent.com/a/x',
    'HTTPS://lh3.googleusercontent.com/a/x',
    'https://lh3.googleusercontent.com:8443/a/x',
    'https://user:pw@lh3.googleusercontent.com/a/x',
    // out of the bucket, onto another endpoint of our own host (which may redirect)
    `${bucket}/../../../../../auth/v1/verify?type=signup&token=x&redirect_to=https://evil.example`,
    `${bucket}/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/rest/v1/profiles`,
    `${bucket}/%2E%2E/x`,
    `${bucket}/..%2fx`,
    `${bucket}/..\\x`,
    `${bucket}/a/./../../x`,
    `${SUPA}/storage/v1/object/public/avatarsX/x.png`,
  ]) {
    assertEquals(isAllowedAvatarUrl(bad, SUPA), false, bad);
  }
  // Real production shapes still pass.
  assertEquals(isAllowedAvatarUrl(`${bucket}/0a1b2c3d-0000-4000-8000-000000000000/avatar-1728900000000.jpg`, SUPA), true);
  assertEquals(isAllowedAvatarUrl(`${bucket}/0a1b/avatar.jpg?t=1728900000000`, SUPA), true);
  assertEquals(isAllowedAvatarUrl('https://lh3.googleusercontent.com/a/ACg8ocJx_y-Z=s96-c', SUPA), true);
});

Deno.test('clamp / long comments never strand half an emoji', () => {
  assertEquals(sliceWhole('ab😀', 3), 'ab');
  assertEquals(sliceWhole('ab😀', 4), 'ab😀');
  assertEquals(clamp('😀😀', 3), '😀');
  const body = composeContent('activity_comment', { activity: { aggCount: 1, commentText: `${'x'.repeat(78)}😀tail` } }, riya, {}).body;
  assertEquals(body, `commented on your post: “${'x'.repeat(78)}…”`);
});

Deno.test('buildPush: the actor\'s photo rides only on like / comment / repost', () => {
  const withPhoto = { ...riya, avatarUrl: 'https://lh3.googleusercontent.com/a/abc' };
  const grant: Grant = { activity: { aggCount: 1, commentText: null, postId: POST } };
  assertEquals(buildPush('activity_like', A, grant, withPhoto, {} as never).data.actorAvatarUrl,
    'https://lh3.googleusercontent.com/a/abc');
  assertEquals(buildPush('activity_comment', A, grant, withPhoto, {} as never).data.actorAvatarUrl,
    'https://lh3.googleusercontent.com/a/abc');
  // Not on other kinds — a chat's Android card would change shape, and that is not this change.
  const dm: Grant = { conversation: { id: CONV, kind: 'dm', name: null } };
  assertEquals(buildPush('message', A, dm, withPhoto, { body: 'hi' } as never).data.actorAvatarUrl, undefined);
  // And never when the handler did not vet one.
  assertEquals(buildPush('activity_like', A, grant, riya, {} as never).data.actorAvatarUrl, undefined);
});

Deno.test('describePost: a Spotify repost asks Spotify for its title; a Livil post reads its track', async () => {
  const asked: string[] = [];
  let filters: Record<string, string> = {};
  const spotifyRow = fakeAdmin((_t, f) => {
    filters = { ...f };
    return { data: { kind: 'repost', spotify_track_id: SPOTIFY_ID, tracks: null } };
  });
  assertEquals(
    await describePost(spotifyRow, POST, B, id => { asked.push(id); return Promise.resolve('Blinding Lights'); }),
    { kind: 'repost', title: 'Blinding Lights' },
  );
  assertEquals(asked, [SPOTIFY_ID]);
  // Only the recipient's own post — a recipient can rewrite their activity row's post_id,
  // and this read bypasses RLS.
  assertEquals(filters.id, POST);
  assertEquals(filters.author_id, B);

  const upload = fakeAdmin(() => ({ data: { kind: 'upload', spotify_track_id: null, tracks: { title: ' Monsoon Letters ' } } }));
  assertEquals(await describePost(upload, POST, B, () => Promise.resolve('never')), { kind: 'upload', title: 'Monsoon Letters' });

  const gone = fakeAdmin(() => ({ data: null }));
  assertEquals(await describePost(gone, POST, B, () => Promise.resolve('never')), null);

  const broken = fakeAdmin(() => ({ data: null, error: { message: 'boom' } }));
  assertEquals(await describePost(broken, POST, B, () => Promise.resolve('never')), null);
});

Deno.test('spotifyTitle: asks the spotify function on the caller\'s session; any failure is null', async () => {
  let call: { url: string; init: RequestInit } | null = null;
  const ok = ((url: string, init: RequestInit) => {
    call = { url, init };
    return Promise.resolve(new Response(JSON.stringify({ tracks: { [SPOTIFY_ID]: { title: 'Blinding Lights' } } })));
  }) as unknown as typeof fetch;
  assertEquals(await spotifyTitle(SUPA, 'Bearer user-jwt', 'anon', SPOTIFY_ID, ok), 'Blinding Lights');
  assertEquals(call!.url, `${SUPA}/functions/v1/spotify`);
  assertEquals((call!.init.headers as Record<string, string>)['Authorization'], 'Bearer user-jwt');
  assertEquals(JSON.parse(String(call!.init.body)), { action: 'tracks', ids: [SPOTIFY_ID] });

  const refused = (() => Promise.resolve(new Response('{}', { status: 401 }))) as unknown as typeof fetch;
  assertEquals(await spotifyTitle(SUPA, 'Bearer x', 'anon', SPOTIFY_ID, refused), null);

  const unknown = (() => Promise.resolve(new Response(JSON.stringify({ tracks: { [SPOTIFY_ID]: null } })))) as unknown as typeof fetch;
  assertEquals(await spotifyTitle(SUPA, 'Bearer x', 'anon', SPOTIFY_ID, unknown), null);

  const down = (() => Promise.reject(new Error('network'))) as unknown as typeof fetch;
  assertEquals(await spotifyTitle(SUPA, 'Bearer x', 'anon', SPOTIFY_ID, down), null);

  let fetched = false;
  const spy = (() => { fetched = true; return Promise.resolve(new Response('{}')); }) as unknown as typeof fetch;
  assertEquals(await spotifyTitle(SUPA, 'Bearer x', 'anon', 'not-an-id', spy), null);
  assertEquals(fetched, false);
});

// ── One card per liked post, one sound per window (notifications #3) ────────────────────

Deno.test('buildPush: a like carries its post\'s card id; quiet only when the window says so', () => {
  const like: Grant = { activity: { aggCount: 3, commentText: null, postId: POST } };
  const loud = buildPush('activity_like', A, like, riya, {} as never).data;
  assertEquals(loud.collapseId, `like:${POST}`);
  assertEquals(loud.quiet, undefined);
  assertEquals(buildPush('activity_like', A, like, riya, {} as never, { quiet: true }).data.quiet, '1');

  // Only likes share a card: every comment and repost is its own event.
  const comment: Grant = { activity: { aggCount: 1, commentText: 'on repeat', postId: POST } };
  assertEquals(buildPush('activity_comment', A, comment, riya, {} as never, { quiet: true }).data.collapseId, undefined);
  assertEquals(buildPush('activity_repost', A, comment, riya, {} as never).data.collapseId, undefined);
  // No post id (an older row) → no shared card, as before.
  const noPost: Grant = { activity: { aggCount: 1, commentText: null } };
  assertEquals(buildPush('activity_like', A, noPost, riya, {} as never).data.collapseId, undefined);
});

Deno.test('apnsFor: a like replaces its post\'s card; a quiet one makes no sound', () => {
  const loud = apnsFor('activity_like', 'Riya', 'liked your post', { collapseId: `like:${POST}` }, 3);
  assertEquals(loud, {
    headers: { 'apns-priority': '10', 'apns-collapse-id': `like:${POST}` },
    payload: { aps: {
      alert: { title: 'Riya', body: 'liked your post' },
      sound: 'default',
      'thread-id': 'activity_like',
      badge: 3,
    } },
  });

  const quiet = apnsFor('activity_like', 'Priya and 4 others', 'liked your post',
    { collapseId: `like:${POST}`, quiet: '1' }, null) as { payload: { aps: Record<string, unknown> } };
  assertEquals(quiet.payload.aps.sound, undefined);
  assertEquals(quiet.payload.aps['interruption-level'], 'passive');
  assertEquals(quiet.payload.aps.badge, undefined);

  // Everything else keeps the shape it shipped with: no collapse id, a sound, its thread.
  assertEquals(apnsFor('message', 'Weekend Crew', '@riya: hi', { conversationId: CONV }, null), {
    headers: { 'apns-priority': '10' },
    payload: { aps: { alert: { title: 'Weekend Crew', body: '@riya: hi' }, sound: 'default', 'thread-id': CONV } },
  });
});

Deno.test('claimLikeAlert: loud for the first like and after the window, quiet inside it', async () => {
  const now = Date.parse('2026-10-14T09:30:00Z');
  const windowStart = new Date(now - LIKE_ALERT_WINDOW_MS).toISOString();
  type Step = { data?: unknown[]; error?: { message: string } };
  const world = (onUpdate: Step, onUpsert: Step, calls: Record<string, string>[] = []) =>
    fakeAdmin((table, f) => {
      assertEquals(table, 'push_like_alerts');
      calls.push({ ...f });
      return f.__op === 'update' ? onUpdate : onUpsert;
    });

  // A row older than the window is moved forward: loud, and the insert is never tried.
  const calls: Record<string, string>[] = [];
  assertEquals(await claimLikeAlert(world({ data: [{ post_id: POST }] }, { data: [] }, calls), B, POST, now), true);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].recipient_id, B);
  assertEquals(calls[0].post_id, POST);
  assertEquals(calls[0].last_alert_at__lt, windowStart);
  assertEquals(JSON.parse(calls[0].__row), { last_alert_at: new Date(now).toISOString() });

  // No row yet: the insert claims it — loud. It must never overwrite an existing row.
  const firstCalls: Record<string, string>[] = [];
  assertEquals(await claimLikeAlert(world({ data: [] }, { data: [{ post_id: POST }] }, firstCalls), B, POST, now), true);
  assertEquals(firstCalls[1].__op, 'upsert');
  assertEquals(firstCalls[1].__onConflict, 'recipient_id,post_id');
  assertEquals(firstCalls[1].__ignoreDuplicates, 'true');

  // A row inside the window: neither step claims it — quiet.
  assertEquals(await claimLikeAlert(world({ data: [] }, { data: [] }), B, POST, now), false);
});

Deno.test('claimLikeAlert: any failure alerts, as before this existed', async () => {
  const boom = { error: { message: 'relation "push_like_alerts" does not exist' } };
  assertEquals(await claimLikeAlert(fakeAdmin(() => boom), B, POST), true);
  assertEquals(await claimLikeAlert(fakeAdmin((_t, f) => (f.__op === 'update' ? { data: [] } : boom)), B, POST), true);
  const throwing = { from: () => { throw new Error('network'); } } as never;
  assertEquals(await claimLikeAlert(throwing, B, POST), true);
});

// ── Scheduled pushes: delivering what the database queued (20261025000000) ──────────────

const SEND = 'aaaaaaaa-0000-4000-8000-000000000001';
const ROW_ANA = 'bbbbbbbb-0000-4000-8000-000000000001';
const ROW_BEA = 'bbbbbbbb-0000-4000-8000-000000000002';

Deno.test('scheduledSendIdOf: only a uuid under scheduledSendId', () => {
  assertEquals(scheduledSendIdOf({ scheduledSendId: SEND.toUpperCase() }), SEND);
  assertEquals(scheduledSendIdOf({ scheduledSendId: 'not-a-uuid' }), null);
  assertEquals(scheduledSendIdOf({ recipientUserId: B, kind: 'message' }), null);
  assertEquals(scheduledSendIdOf(null), null);
  assertEquals(scheduledSendIdOf('x'), null);
});

Deno.test('sendFcm: sent / dead (token gone) / failed (anything else, token kept)', async () => {
  const reply = (status: number, body: unknown) =>
    (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch;
  assertEquals(await sendFcm('https://fcm', 'at', { token: 't' }, reply(200, {})), 'sent');
  assertEquals(await sendFcm('https://fcm', 'at', { token: 't' },
    reply(404, { error: { details: [{ errorCode: 'UNREGISTERED' }] } })), 'dead');
  assertEquals(await sendFcm('https://fcm', 'at', { token: 't' }, reply(500, { error: {} })), 'failed');
  const down = (() => Promise.reject(new Error('net'))) as unknown as typeof fetch;
  assertEquals(await sendFcm('https://fcm', 'at', { token: 't' }, down), 'failed');
});

/** A database holding one queued digest for Ana (two phones, one dead) and Bea (no phone). */
function scheduledWorld(kind: string | null) {
  const calls: Array<{ table: string; f: Record<string, string> }> = [];
  const admin = fakeAdmin((table, f) => {
    calls.push({ table, f: { ...f } });
    if (table === 'push_sends') return { data: kind ? { kind } : null };
    if (table === 'push_deliveries' && f.__op === 'update' && JSON.parse(f.__row).status === 'sending') {
      return { data: [
        { id: ROW_ANA, recipient_id: A, title: 'Bea, @sp_eli and 1 other',
          body: 'reposted 4 songs since last night · check them out',
          avatar_url: 'https://lh3.googleusercontent.com/a/bea=s96-c' },
        { id: ROW_BEA, recipient_id: B, title: 'Cyd and Dex', body: 'reposted 2 songs today · check them out',
          avatar_url: 'https://evil.example/pixel.png' },
      ] };
    }
    if (table === 'device_tokens' && f.__op !== 'delete') {
      return { data: [
        { user_id: A, token: 'tok-ana', platform: 'android' },
        { user_id: A, token: 'tok-dead', platform: 'android' },
      ] };
    }
    return { data: null };
  });
  const messages: Array<Record<string, unknown>> = [];
  const fetchFn = ((_url: string, init: RequestInit) => {
    const m = JSON.parse(String(init.body)).message;
    messages.push(m);
    return Promise.resolve(m.token === 'tok-dead'
      ? new Response(JSON.stringify({ error: { details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 })
      : new Response('{}', { status: 200 }));
  }) as unknown as typeof fetch;
  return { admin, calls, messages, fetchFn };
}

Deno.test('flushScheduled: claims the queued rows, sends each to every phone, records the outcome', async () => {
  const w = scheduledWorld('repost_digest');
  const result = await flushScheduled(w.admin, SEND, SUPA,
    { accessToken: () => Promise.resolve('at'), projectId: 'p', fetchFn: w.fetchFn });
  assertEquals(result, { claimed: 2, sent: 1, failed: 1, pruned: 1 });

  // The claim: only this send's QUEUED rows, flipped to sending in one statement.
  const claim = w.calls.find(c => c.table === 'push_deliveries' && JSON.parse(c.f.__row ?? '{}').status === 'sending')!;
  assertEquals(claim.f.send_id, SEND);
  assertEquals(claim.f.status, 'queued');

  // What Ana's phones receive: the database's text, the digest's route and card, her row id.
  const live = w.messages.find(m => m.token === 'tok-ana')! as {
    data: Record<string, string>; apns: { headers: Record<string, string>; payload: { aps: Record<string, unknown> } };
  };
  assertEquals(live.data, {
    route: 'App', kind: 'repost_digest', channelId: 'activity',
    title: 'Bea, @sp_eli and 1 other', body: 'reposted 4 songs since last night · check them out',
    pushId: ROW_ANA, collapseId: 'digest',
    actorAvatarUrl: 'https://lh3.googleusercontent.com/a/bea=s96-c',
  });
  assertEquals(live.apns.headers['apns-collapse-id'], 'digest');
  assertEquals(live.apns.payload.aps.sound, 'default');

  // Bea has no phone → failed, nothing sent; her row's off-list photo never went anywhere.
  assertEquals(w.messages.some(m => JSON.stringify(m).includes('evil.example')), false);
  const marked = (status: string) => w.calls.find(c =>
    c.table === 'push_deliveries' && c.f.__op === 'update' && JSON.parse(c.f.__row).status === status)?.f.id__in;
  assertEquals(marked('sent'), ROW_ANA);
  assertEquals(marked('failed'), ROW_BEA);
  // The dead token is pruned; the live one is not.
  assertEquals(w.calls.find(c => c.table === 'device_tokens' && c.f.__op === 'delete')?.f.token__in, 'tok-dead');
});

Deno.test('flushScheduled: a mood nudge opens the + Track chooser and replaces the last mood card', async () => {
  const w = scheduledWorld('mood_nudge');
  await flushScheduled(w.admin, SEND, SUPA, { accessToken: () => Promise.resolve('at'), projectId: 'p', fetchFn: w.fetchFn });
  const m = w.messages.find(x => x.token === 'tok-ana')! as { data: Record<string, string> };
  assertEquals([m.data.route, m.data.kind, m.data.collapseId], ['AddToLivil', 'mood_nudge', 'mood']);
});

Deno.test('flushScheduled: New music pushes open Home on the New on Livil tab, one card each', async () => {
  for (const [kind, collapseId] of [['new_drop', 'drop'], ['originals_weekly', 'fresh']]) {
    const w = scheduledWorld(kind);
    await flushScheduled(w.admin, SEND, SUPA, { accessToken: () => Promise.resolve('at'), projectId: 'p', fetchFn: w.fetchFn });
    const m = w.messages.find(x => x.token === 'tok-ana')! as { data: Record<string, string> };
    assertEquals([m.data.route, m.data.tab, m.data.collapseId, m.data.kind], ['App', 'new_on_livil', collapseId, kind]);
  }
});

Deno.test('flushScheduled: older kinds carry no tab', async () => {
  const w = scheduledWorld('repost_digest');
  await flushScheduled(w.admin, SEND, SUPA, { accessToken: () => Promise.resolve('at'), projectId: 'p', fetchFn: w.fetchFn });
  const m = w.messages.find(x => x.token === 'tok-ana')! as { data: Record<string, string> };
  assertEquals(m.data.tab, undefined);
});

Deno.test('flushScheduled: an unknown send claims nothing and sends nothing', async () => {
  const w = scheduledWorld(null);
  const result = await flushScheduled(w.admin, SEND, SUPA, { accessToken: () => Promise.resolve('at'), fetchFn: w.fetchFn });
  assertEquals(result, { claimed: 0, sent: 0, failed: 0, pruned: 0 });
  assertEquals(w.calls.some(c => c.table === 'push_deliveries'), false);
  assertEquals(w.messages.length, 0);
});

Deno.test('flushScheduled: FCM unreachable → the claimed rows go back to queued for the retry', async () => {
  const w = scheduledWorld('repost_digest');
  const result = await flushScheduled(w.admin, SEND, SUPA,
    { accessToken: () => Promise.reject(new Error('fcm_token_failed: 500')), fetchFn: w.fetchFn });
  assertEquals(result.claimed, 2);
  assertEquals(w.messages.length, 0);
  const requeue = w.calls.find(c =>
    c.table === 'push_deliveries' && c.f.__op === 'update' && JSON.parse(c.f.__row).status === 'queued');
  assertEquals(requeue?.f.id__in, `${ROW_ANA},${ROW_BEA}`);
});

Deno.test('chunked: splits id lists so no request carries more than 100', () => {
  assertEquals(chunked([1, 2, 3], 2), [[1, 2], [3]]);
  assertEquals(chunked([]), []);
  assertEquals(chunked(Array.from({ length: 250 }, (_, i) => i)).map(c => c.length), [100, 100, 50]);
});

Deno.test('flushScheduled: a large send looks phones up and records outcomes 100 at a time', async () => {
  const many = Array.from({ length: 150 }, (_, i) => ({
    id: `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, '0')}`,
    recipient_id: `cccccccc-0000-4000-8000-${String(i).padStart(12, '0')}`,
    title: 'x', body: 'y', avatar_url: null,
  }));
  const calls: Array<{ table: string; f: Record<string, string> }> = [];
  const admin = fakeAdmin((table, f) => {
    calls.push({ table, f: { ...f } });
    if (table === 'push_sends') return { data: { kind: 'repost_digest' } };
    if (table === 'push_deliveries' && f.__op === 'update' && JSON.parse(f.__row).status === 'sending') {
      return { data: many };
    }
    if (table === 'device_tokens') {
      return { data: f.user_id__in.split(',').map(u => ({ user_id: u, token: `tok-${u}`, platform: 'android' })) };
    }
    return { data: null };
  });
  const ok = (() => Promise.resolve(new Response('{}'))) as unknown as typeof fetch;
  const result = await flushScheduled(admin, SEND, SUPA, { accessToken: () => Promise.resolve('at'), projectId: 'p', fetchFn: ok });
  assertEquals(result.sent, 150);
  const lookups = calls.filter(c => c.table === 'device_tokens');
  assertEquals(lookups.map(c => c.f.user_id__in.split(',').length), [100, 50]);
  const marks = calls.filter(c => c.table === 'push_deliveries' && c.f.__op === 'update'
    && JSON.parse(c.f.__row).status === 'sent');
  assertEquals(marks.map(c => c.f.id__in.split(',').length), [100, 50]);
});

Deno.test('handler: an oversized body is refused before anything reads it', async () => {
  const res = await handler(new Request('https://x/send-push', {
    method: 'POST',
    headers: { Authorization: 'Bearer x', 'content-length': '20000' },
    body: 'x'.repeat(20_000),
  }));
  assertEquals(res.status, 413);
});

// ── activity_mention (20261109000000) ───────────────────────────────────────
const MENTION = '12121212-1212-1212-1212-121212121212';

/** activityAdmin, plus the row's id and claim_mention_push: true once per unpushed id. */
// deno-lint-ignore no-explicit-any
function mentionAdmin(rows: Array<Record<string, unknown>>): any {
  const base = activityAdmin(rows);
  const pushed = new Set<string>();
  const claims: Array<Record<string, unknown>> = [];
  return {
    claims,
    from: (t: string) => {
      const b = base.from(t);
      const eq = b.eq.bind(b);
      let id: string | undefined;
      b.eq = (col: string, val: string) => { if (col === 'id') { id = val; return b; } return eq(col, val); };
      const then = b.then.bind(b);
      b.then = (res: (v: unknown) => void, rej?: (e: unknown) => void) =>
        then((out: { data?: Array<Record<string, unknown>> }) =>
          res({ ...out, data: (out.data ?? []).filter(r => id === undefined || r.id === id) }), rej);
      return b;
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      claims.push({ fn, ...args });
      const row = rows.find(r => r.id === args.p_id && r.recipient_id === args.p_recipient && r.actor_id === args.p_actor);
      const ok = fn === 'claim_mention_push' && !!row && !pushed.has(String(args.p_id));
      if (ok) pushed.add(String(args.p_id));
      return Promise.resolve({ data: ok, error: null });
    },
  };
}

Deno.test('activity_mention: allowed once for the named row; quote and place from the row', async () => {
  const admin = mentionAdmin([
    { id: MENTION, recipient_id: B, type: 'mention', actor_id: A, post_id: POST, payload: { where: 'comment', text: '@riya hear this' } },
  ]);
  const grant = await authorize(admin, 'activity_mention', A, B, { notificationId: MENTION });
  assertEquals(grant?.activity, { aggCount: 1, commentText: '@riya hear this', postId: POST, mentionWhere: 'comment' });
  // SINGLE-USE: the same tag can never be pushed again (security review, 2026-10-19).
  assertEquals(await allows(admin, 'activity_mention', A, B, { notificationId: MENTION }), false);
});

Deno.test('activity_mention: refused without a row id, for someone else\'s row, or a stale one', async () => {
  const row = { id: MENTION, recipient_id: B, type: 'mention', actor_id: A, post_id: POST, payload: {} };
  // No id (an app that does not name the row): no push.
  assertEquals(await allows(mentionAdmin([row]), 'activity_mention', A, B), false);
  assertEquals(await allows(mentionAdmin([row]), 'activity_mention', A, B, { notificationId: 'not-a-uuid' }), false);
  // Another sender, another recipient, another id.
  assertEquals(await allows(mentionAdmin([row]), 'activity_mention', C, B, { notificationId: MENTION }), false);
  assertEquals(await allows(mentionAdmin([row]), 'activity_mention', A, C, { notificationId: MENTION }), false);
  assertEquals(await allows(mentionAdmin([row]), 'activity_mention', A, B, { notificationId: POST }), false);
  // Another kind's row is not a mention.
  assertEquals(await allows(mentionAdmin([{ ...row, type: 'comment' }]), 'activity_mention', A, B, { notificationId: MENTION }), false);
  // Time-bounded like every other.
  assertEquals(await allows(mentionAdmin([{ ...row, created_at: MINUTES_AGO(11) }]), 'activity_mention', A, B, { notificationId: MENTION }), false);
  // Never yourself.
  assertEquals(await allows(mentionAdmin([{ ...row, recipient_id: A }]), 'activity_mention', A, A, { notificationId: MENTION }), false);
});

Deno.test('composeContent: a mention says where, and quotes the tagged text', () => {
  const post: Grant = { activity: { aggCount: 1, commentText: "this one's for @riya 🎧", postId: POST, mentionWhere: 'post' } };
  assertEquals(composeContent('activity_mention', post, riya, {}),
    { title: 'Riya', body: "tagged you in a post: “this one's for @riya 🎧”" });
  const comment: Grant = { activity: { aggCount: 1, commentText: '@riya listen to the drop', postId: POST, mentionWhere: 'comment' } };
  assertEquals(composeContent('activity_mention', comment, riya, {}),
    { title: 'Riya', body: 'mentioned you in a comment: “@riya listen to the drop”' });
  const bare: Grant = { activity: { aggCount: 1, commentText: null, postId: POST, mentionWhere: 'post' } };
  assertEquals(composeContent('activity_mention', bare, riya, {}).body, 'tagged you in a post');
});

Deno.test('activity_mention opens Activity and shows the actor\'s photo, on the Activity channel', () => {
  assertEquals(channelFor('activity_mention'), 'activity');
  assertEquals(KINDS.has('activity_mention'), true);
});
