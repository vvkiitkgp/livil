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
  channelFor,
  clamp,
  defaultBody,
  isCategoryMuted,
  isValidKind,
  isValidRecipient,
  selfTargetAllowed,
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
      or(expr: string) { filters.__or = expr; return b; },
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
});

// ── per-category preference ─────────────────────────────────────────────────
// Polarity is the opposite of authorize(): this ALLOWS by default. Every "unknown"
// case below must resolve to "not muted", because a preference that fails closed
// silently stops a user's notifications with no error anyone would see.

const prefsRow = (over: Record<string, boolean> = {}) => ({
  social: true, activity: true, messages: true, jam: true, ...over,
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
  const KINDS = [
    'friend_request', 'friend_accepted', 'new_follower', 'new_fan',
    'message', 'reaction',
    'jam_invite_dm', 'jam_started', 'jam_join', 'jam_ended',
    'activity_like', 'activity_comment', 'activity_repost', 'activity_milestone',
  ];
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
  assertEquals(isValidRecipient(A), true);
  assertEquals(isValidRecipient('nope'), false);
  assertEquals(isValidRecipient(undefined), false);
});

Deno.test('selfTargetAllowed only for activity_milestone', () => {
  assertEquals(selfTargetAllowed('activity_milestone'), true);
  assertEquals(selfTargetAllowed('message'), false);
});

// ── authorize(): the security-relevant gates ────────────────────────────────
Deno.test('message: allowed only when actor and recipient share a conversation', async () => {
  const shared = fakeAdmin((_t, f) => ({
    data: f.user_id === A ? [{ conversation_id: 'c1' }, { conversation_id: 'c2' }]
                          : [{ conversation_id: 'c2' }, { conversation_id: 'c3' }],
  }));
  assertEquals(await authorize(shared, 'message', A, B), true); // both in c2

  const disjoint = fakeAdmin((_t, f) => ({
    data: f.user_id === A ? [{ conversation_id: 'c1' }] : [{ conversation_id: 'c9' }],
  }));
  assertEquals(await authorize(disjoint, 'message', A, B), false);
  assertEquals(await authorize(disjoint, 'reaction', A, B), false);
});

Deno.test('friend_accepted / jam: require an accepted friendship', async () => {
  const friends = fakeAdmin(() => ({ count: 1 }));
  const strangers = fakeAdmin(() => ({ count: 0 }));
  assertEquals(await authorize(friends, 'friend_accepted', A, B), true);
  assertEquals(await authorize(friends, 'jam_started', A, B), true);
  assertEquals(await authorize(strangers, 'jam_join', A, B), false);
});

Deno.test('new_fan / new_follower: require a star edge actor -> recipient', async () => {
  const starred = fakeAdmin(() => ({ count: 1 }));
  const not = fakeAdmin(() => ({ count: 0 }));
  assertEquals(await authorize(starred, 'new_fan', A, B), true);
  assertEquals(await authorize(not, 'new_follower', A, B), false);
});

Deno.test('activity_*: coarse gate — recipient must be a real author', async () => {
  const author = fakeAdmin(() => ({ count: 2 }));
  const noPosts = fakeAdmin(() => ({ count: 0 }));
  assertEquals(await authorize(author, 'activity_like', A, B), true);
  assertEquals(await authorize(noPosts, 'activity_comment', A, B), false);
});

Deno.test('friend_request: requires a pending request from actor -> recipient', async () => {
  const pending = fakeAdmin(() => ({ count: 1 }));
  const none = fakeAdmin(() => ({ count: 0 }));
  assertEquals(await authorize(pending, 'friend_request', A, B), true);
  assertEquals(await authorize(none, 'friend_request', A, B), false);
});

Deno.test('self-targeting: only activity_milestone; unknown kinds denied', async () => {
  const any = fakeAdmin(() => ({ count: 1 }));
  assertEquals(await authorize(any, 'activity_milestone', A, A), true);
  assertEquals(await authorize(any, 'message', A, A), false);
  assertEquals(await authorize(any, 'totally_unknown', A, B), false);
});
