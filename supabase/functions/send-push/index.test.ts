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
  isValidKind,
  isValidRecipient,
  selfTargetAllowed,
} from './app.ts';

// ── a minimal fake of the supabase-js query builder ─────────────────────────
// resolver(table, filters, opts) returns the awaited `{ data }` or `{ count }`.
type Resolver = (
  table: string,
  filters: Record<string, string>,
  opts: { head?: boolean; count?: string },
) => { data?: unknown[]; count?: number };

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
