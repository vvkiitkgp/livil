/**
 * Opening a chat with deletes in it (20261119010000): a message deleted for everyone comes
 * back as a placeholder — NEVER with its words, even one deleted before the server erased
 * them — a message I deleted for myself is left out, nothing at or before my Clear chat is
 * shown (nor any older page), and a backend without the migration loads the chat as before.
 */
type Result = { data: unknown; error: unknown };
const mockTables: Record<string, (filters: Record<string, unknown>) => Result> = {};

function mockBuilder(table: string) {
  const filters: Record<string, unknown> = {};
  const b: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => { filters[name] = args; return b; };
  for (const m of ['select', 'eq', 'order', 'limit', 'lt', 'in', 'is']) { b[m] = chain(m); }
  const run = () => Promise.resolve(mockTables[table]!(filters));
  b.maybeSingle = run;
  b.then = (ok: (r: Result) => unknown, bad: (e: unknown) => unknown) => run().then(ok, bad);
  return b;
}

jest.mock('../../../lib/supabase', () => ({
  supabase: { from: (t: string) => mockBuilder(t), rpc: jest.fn() },
}));
jest.mock('../session', () => ({ getMyUserId: () => Promise.resolve('me') }));

import { __resetChatDeletionForTest, fetchMessages, getChatDeletionAvailable } from '../messages';

const row = (id: string, min: number, extra: Record<string, unknown> = {}) => ({
  id,
  conversation_id: 'c1',
  sender_id: 'riya',
  kind: 'text',
  body: `message ${id}`,
  metadata: null,
  reply_to_id: null,
  created_at: `2026-11-02T10:${String(min).padStart(2, '0')}:00.000Z`,
  deleted_at: null,
  ...extra,
});

beforeEach(() => {
  __resetChatDeletionForTest();
  mockTables.profiles = () => ({ data: [{ id: 'riya', username: 'riya', display_name: 'Riya', avatar_url: null }], error: null });
  mockTables.message_reactions = () => ({ data: [], error: null });
});

it('a message deleted for everyone is a placeholder, without its words', async () => {
  mockTables.messages = () => ({
    data: [
      row('m3', 3),
      // Deleted by an older path: the words are still in the row. Never shown.
      row('m2', 2, { deleted_at: '2026-11-02T10:04:00.000Z', body: 'my number is 98765 43210', metadata: { x: 1 } }),
      row('m1', 1),
    ],
    error: null,
  });
  const { messages } = await fetchMessages('c1');
  expect(messages.map(m => m.id)).toEqual(['m3', 'm2', 'm1']);
  expect(messages[1]).toEqual(expect.objectContaining({ body: null, metadata: null, reactions: [] }));
  expect(messages[1]!.deletedAt).toBe('2026-11-02T10:04:00.000Z');
});

it('a cleared chat loads as its one line', async () => {
  mockTables.messages = () => ({
    data: [row('m1', 1, { kind: 'system', sender_id: null, body: 'Riya cleared this chat', metadata: { chat_cleared: true } })],
    error: null,
  });
  const { messages, nextCursor } = await fetchMessages('c1');
  expect(messages.map(m => m.body)).toEqual(['Riya cleared this chat']);
  expect(messages[0]!.metadata).toEqual({ chat_cleared: true });
  expect(nextCursor).toBeNull();
});

it('a full page has a next page', async () => {
  mockTables.messages = () => ({ data: [row('m3', 3), row('m2', 2), row('m1', 1)], error: null });
  const { messages, nextCursor } = await fetchMessages('c1', undefined, 2);
  expect(messages.map(m => m.id)).toEqual(['m3', 'm2']);
  expect(nextCursor).toBe(messages[1]!.createdAt);
});

describe('getChatDeletionAvailable', () => {
  it('is on once the delete rules are live', async () => {
    mockTables.conversation_hides = () => ({ data: [], error: null });
    await expect(getChatDeletionAvailable()).resolves.toBe(true);
  });

  it('stays off, for this launch, without them', async () => {
    mockTables.conversation_hides = () => ({ data: null, error: { code: 'PGRST205', message: 'no table' } });
    await expect(getChatDeletionAvailable()).resolves.toBe(false);
    mockTables.conversation_hides = () => ({ data: [], error: null });
    await expect(getChatDeletionAvailable()).resolves.toBe(false);
  });

  it('asks again after a failed read, which may only be a bad connection', async () => {
    mockTables.conversation_hides = () => ({ data: null, error: { code: 'XX000', message: 'network' } });
    await expect(getChatDeletionAvailable()).resolves.toBe(false);
    mockTables.conversation_hides = () => ({ data: [], error: null });
    await expect(getChatDeletionAvailable()).resolves.toBe(true);
  });
});
