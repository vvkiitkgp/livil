/**
 * A reply quoting a message above the loaded pages fetches that original by id. Pins: it asks
 * for this chat's messages only, brings the sender's name for the quote's author line, never
 * brings a deleted message's words, and a failed read throws so the caller can ask again.
 */
type Result = { data: unknown; error: unknown };
const mockTables: Record<string, (filters: Record<string, unknown>) => Result> = {};
const mockAsked: string[] = [];

function mockBuilder(table: string) {
  mockAsked.push(table);
  const filters: Record<string, unknown> = {};
  const b: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => { filters[name] = args; return b; };
  for (const m of ['select', 'eq', 'order', 'limit', 'lt', 'in', 'is']) { b[m] = chain(m); }
  const run = () => Promise.resolve(mockTables[table]!(filters));
  b.then = (ok: (r: Result) => unknown, bad: (e: unknown) => unknown) => run().then(ok, bad);
  return b;
}

jest.mock('../../../lib/supabase', () => ({
  supabase: { from: (t: string) => mockBuilder(t), rpc: jest.fn() },
}));
jest.mock('../session', () => ({ getMyUserId: () => Promise.resolve('me') }));

import { fetchMessagesByIds } from '../messages';

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  conversation_id: 'c1',
  sender_id: 'riya',
  kind: 'text',
  body: `message ${id}`,
  metadata: null,
  reply_to_id: null,
  created_at: '2026-11-02T10:00:00.000Z',
  deleted_at: null,
  ...extra,
});

beforeEach(() => {
  mockAsked.length = 0;
  mockTables.profiles = () => ({ data: [{ id: 'riya', username: 'riya', display_name: 'Riya', avatar_url: null }], error: null });
});

it('asks for those ids in this chat, and brings the sender for the quote', async () => {
  let filters: Record<string, unknown> = {};
  mockTables.messages = f => { filters = f; return { data: [row('m1')], error: null }; };
  const found = await fetchMessagesByIds('c1', ['m1', 'm2']);
  expect(filters.eq).toEqual(['conversation_id', 'c1']);
  expect(filters.in).toEqual(['id', ['m1', 'm2']]);
  expect(found).toEqual([expect.objectContaining({ id: 'm1', body: 'message m1', senderDisplayName: 'Riya', reactions: [] })]);
});

it('a deleted original comes back without its words', async () => {
  mockTables.messages = () => ({
    data: [row('m1', { deleted_at: '2026-11-02T10:04:00.000Z', body: 'my number is 98765 43210', metadata: { x: 1 } })],
    error: null,
  });
  const [original] = await fetchMessagesByIds('c1', ['m1']);
  expect(original).toEqual(expect.objectContaining({ body: null, metadata: null }));
  expect(original!.deletedAt).toBe('2026-11-02T10:04:00.000Z');
});

it('no ids asks nothing', async () => {
  await expect(fetchMessagesByIds('c1', [])).resolves.toEqual([]);
  expect(mockAsked).toEqual([]);
});

it('an original that no longer exists is simply not returned', async () => {
  mockTables.messages = () => ({ data: [], error: null });
  await expect(fetchMessagesByIds('c1', ['gone'])).resolves.toEqual([]);
  expect(mockAsked).toEqual(['messages']);
});

it('a failed read throws', async () => {
  mockTables.messages = () => ({ data: null, error: { code: 'XX000', message: 'network' } });
  await expect(fetchMessagesByIds('c1', ['m1'])).rejects.toEqual(expect.objectContaining({ code: 'XX000' }));
});
