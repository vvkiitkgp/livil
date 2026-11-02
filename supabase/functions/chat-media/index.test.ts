// Tests for the chat-media edge function (PROP-0011). Run:
//   deno test --no-config supabase/functions/chat-media/index.test.ts
//
// No network: every dependency is a fake. The properties under test, most important first:
//   - a link is handed out only for a message the caller can read (RLS = members), only while
//     it is under 20 minutes old, and never for an object outside the message's own chat;
//   - the link's lifetime is the time LEFT, so it can never outlive the window;
//   - only signed-in users get a link or the status;
//   - the sweep needs no user, deletes in batches, and is throttled per isolate.

import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  type Deps,
  handle,
  LIFETIME_MS,
  type MessageRow,
  mediaObject,
  planLink,
  resetState,
  SWEEP_BATCH,
  SWEEP_MIN_INTERVAL_MS,
} from './app.ts';

const CONV = 'c2000000-0000-0000-0000-000000000001';
const OTHER_CONV = 'c2000000-0000-0000-0000-000000000009';
const MSG = 'c3000000-0000-0000-0000-000000000001';
const OBJECT = `${CONV}/a0000000-0000-0000-0000-000000000001.jpg`;
const T0 = Date.parse('2026-11-02T10:00:00.000Z');

function row(over: Partial<MessageRow> = {}): MessageRow {
  return {
    id: MSG,
    conversation_id: CONV,
    created_at: new Date(T0).toISOString(),
    deleted_at: null,
    metadata: { media: { v: 1, type: 'photo', object: OBJECT } },
    ...over,
  };
}

type Calls = { signed: Array<[string, number]>; removed: string[][] };

function deps(over: Partial<Deps> = {}, opts: { now?: number; message?: MessageRow | null; expired?: string[][] } = {}) {
  const calls: Calls = { signed: [], removed: [] };
  const expired = [...(opts.expired ?? [])];
  const d: Deps = {
    env: { enabled: true },
    getUserId: (jwt) => Promise.resolve(jwt === 'good' ? 'u1' : null),
    readMessage: () => Promise.resolve(opts.message === undefined ? row() : opts.message),
    signUrl: (object, ttl) => {
      calls.signed.push([object, ttl]);
      return Promise.resolve(`https://signed.example/${object}?ttl=${ttl}`);
    },
    expiredObjects: () => Promise.resolve(expired.shift() ?? []),
    removeObjects: (names) => {
      calls.removed.push(names);
      return Promise.resolve(true);
    },
    now: () => opts.now ?? T0 + 60_000,
    ...over,
  };
  return { d, calls };
}

function post(body: unknown, jwt: string | null = 'good'): Request {
  return new Request('https://fn.example/chat-media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(body),
  });
}

// ── link ────────────────────────────────────────────────────────────────────

Deno.test('link: a member gets a signed URL for the photo while it is fresh', async () => {
  const { d, calls } = deps();
  const res = await handle(post({ action: 'link', message_id: MSG }), d);
  assertEquals(res.status, 200);
  const body = await res.json();
  assert(body.url.startsWith('https://signed.example/'));
  assertEquals(body.expires_at, new Date(T0 + LIFETIME_MS).toISOString());
  assertEquals(body.now, new Date(T0 + 60_000).toISOString());
  assertEquals(calls.signed, [[OBJECT, 1140]]);
});

Deno.test('link: the URL lives only as long as the time left — never past the 20 minutes', async () => {
  const { d, calls } = deps({}, { now: T0 + LIFETIME_MS - 1_500 });
  const res = await handle(post({ action: 'link', message_id: MSG }), d);
  assertEquals(res.status, 200);
  assertEquals(calls.signed[0][1], 1);
});

Deno.test('link: at 20 minutes it is gone', async () => {
  for (const now of [T0 + LIFETIME_MS, T0 + LIFETIME_MS - 999, T0 + LIFETIME_MS + 60_000]) {
    const { d, calls } = deps({}, { now });
    const res = await handle(post({ action: 'link', message_id: MSG }), d);
    assertEquals(res.status, 410, `at +${now - T0} ms`);
    assertEquals((await res.json()).error, 'expired');
    assertEquals(calls.signed.length, 0);
  }
});

Deno.test('link: someone who cannot read the message (not a member) gets 404, no URL', async () => {
  const { d, calls } = deps({}, { message: null });
  const res = await handle(post({ action: 'link', message_id: MSG }), d);
  assertEquals(res.status, 404);
  assertEquals(calls.signed.length, 0);
});

Deno.test('link: a file outside the message\'s own chat is never signed', async () => {
  const { d, calls } = deps({}, {
    message: row({ metadata: { media: { object: `${OTHER_CONV}/a0000000-0000-0000-0000-000000000001.jpg` } } }),
  });
  const res = await handle(post({ action: 'link', message_id: MSG }), d);
  assertEquals(res.status, 400);
  assertEquals(calls.signed.length, 0);
});

Deno.test('link: a malformed or missing object is refused', async () => {
  for (const metadata of [null, {}, { media: {} }, { media: { object: `${CONV}/../x.jpg` } }, { gif: { id: 'x' } }]) {
    const { d, calls } = deps({}, { message: row({ metadata }) });
    const res = await handle(post({ action: 'link', message_id: MSG }), d);
    assertEquals(res.status, 400, JSON.stringify(metadata));
    assertEquals(calls.signed.length, 0);
  }
});

Deno.test('link: a deleted message gives nothing', async () => {
  const { d, calls } = deps({}, { message: row({ deleted_at: new Date(T0).toISOString() }) });
  const res = await handle(post({ action: 'link', message_id: MSG }), d);
  assertEquals(res.status, 410);
  assertEquals(calls.signed.length, 0);
});

Deno.test('link: a bad message id is a 400 before any read', async () => {
  let read = false;
  const { d } = deps({ readMessage: () => { read = true; return Promise.resolve(row()); } });
  const res = await handle(post({ action: 'link', message_id: 'nope' }), d);
  assertEquals(res.status, 400);
  assertEquals(read, false);
});

Deno.test('link and status: signed-in users only', async () => {
  for (const jwt of [null, 'bad']) {
    const { d, calls } = deps();
    assertEquals((await handle(post({ action: 'link', message_id: MSG }, jwt), d)).status, 401);
    assertEquals((await handle(post({ action: 'status' }, jwt), d)).status, 401);
    assertEquals(calls.signed.length, 0);
  }
});

Deno.test('status: follows CHAT_MEDIA_ENABLED', async () => {
  for (const enabled of [true, false]) {
    const { d } = deps({ env: { enabled } });
    const res = await handle(post({ action: 'status' }), d);
    assertEquals(await res.json(), { enabled });
  }
});

// ── sweep ───────────────────────────────────────────────────────────────────

Deno.test('sweep: needs no user, and deletes what is expired', async () => {
  resetState();
  const { d, calls } = deps({}, { expired: [['a', 'b']] });
  const res = await handle(post({ action: 'sweep' }, null), d);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { deleted: 2 });
  assertEquals(calls.removed, [['a', 'b']]);
});

Deno.test('sweep: full batches keep going, a short batch stops', async () => {
  resetState();
  const full = Array.from({ length: SWEEP_BATCH }, (_, i) => `n${i}`);
  const { d, calls } = deps({}, { expired: [full, ['last']] });
  const res = await handle(post({ action: 'sweep' }, null), d);
  assertEquals((await res.json()).deleted, SWEEP_BATCH + 1);
  assertEquals(calls.removed.length, 2);
});

Deno.test('sweep: throttled per isolate', async () => {
  resetState();
  let now = T0;
  const { d, calls } = deps({ now: () => now }, { expired: [['a'], ['b'], ['c']] });
  await handle(post({ action: 'sweep' }, null), d);
  now += SWEEP_MIN_INTERVAL_MS - 1;
  assertEquals((await (await handle(post({ action: 'sweep' }, null), d)).json()).throttled, true);
  now += 1;
  await handle(post({ action: 'sweep' }, null), d);
  assertEquals(calls.removed, [['a'], ['b']]);
});

Deno.test('sweep: a failed delete is reported, not swallowed', async () => {
  resetState();
  const { d } = deps({ removeObjects: () => Promise.resolve(false) }, { expired: [['a']] });
  const res = await handle(post({ action: 'sweep' }, null), d);
  assertEquals(res.status, 502);
});

// ── plumbing ────────────────────────────────────────────────────────────────

Deno.test('only POST; OPTIONS answers CORS; unknown action is a 400', async () => {
  const { d } = deps();
  assertEquals((await handle(new Request('https://fn.example', { method: 'GET' }), d)).status, 405);
  assertEquals((await handle(new Request('https://fn.example', { method: 'OPTIONS' }), d)).status, 204);
  assertEquals((await handle(post({ action: 'nope' }), d)).status, 400);
  assertEquals((await handle(new Request('https://fn.example', { method: 'POST', body: '[]' }), d)).status, 400);
});

Deno.test('mediaObject / planLink are pure', () => {
  assertEquals(mediaObject({ media: { object: OBJECT } }), OBJECT);
  assertEquals(mediaObject({ media: { object: 7 } }), null);
  const plan = planLink(row(), T0);
  assert(plan.ok && plan.ttlSeconds === LIFETIME_MS / 1000);
});
