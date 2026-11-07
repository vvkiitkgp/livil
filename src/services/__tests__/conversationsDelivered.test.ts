/**
 * "Delivered" stamps (20261119000000): this app tells the server it received a chat's
 * messages. Fire-and-forget, never throws, asks once per new message — and on a backend
 * where the migration is not applied yet, stops asking after the first "no such function".
 */
const mockRpc = jest.fn();
const mockFrom = jest.fn();
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: (...a: unknown[]) => mockFrom(...a),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'me' } } }) },
  },
}));

import {
  __resetDeliveredForTest,
  getOtherMemberReadAt,
  markConversationDelivered,
  markConversationsDelivered,
} from '../conversations';

beforeEach(() => {
  __resetDeliveredForTest();
  mockRpc.mockReset();
  mockFrom.mockReset();
});

describe('markConversationDelivered', () => {
  it('stamps up to the newest message, once per newer message', async () => {
    mockRpc.mockResolvedValue({ error: null });
    await markConversationDelivered('c1', '2026-11-02T10:05:00Z');
    await markConversationDelivered('c1', '2026-11-02T10:05:00Z');
    await markConversationDelivered('c1', '2026-11-02T10:01:00Z');
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('mark_conversation_delivered', {
      p_conversation_id: 'c1',
      p_up_to: '2026-11-02T10:05:00Z',
    });
    await markConversationDelivered('c1', '2026-11-02T10:06:00Z');
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it('migration not applied: one try, then quiet — never an error', async () => {
    mockRpc.mockResolvedValue({ error: { code: 'PGRST202', message: 'Could not find the function' } });
    await expect(markConversationDelivered('c1', '2026-11-02T10:05:00Z')).resolves.toBeUndefined();
    await markConversationDelivered('c2', '2026-11-02T10:06:00Z');
    await markConversationsDelivered([{ id: 'c3', lastMessageAt: '2026-11-02T10:07:00Z' }]);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('a failed stamp is tried again next time; a thrown one never escapes', async () => {
    mockRpc.mockResolvedValueOnce({ error: { code: '500', message: 'timeout' } });
    await markConversationDelivered('c1', '2026-11-02T10:05:00Z');
    mockRpc.mockRejectedValueOnce(new Error('Network request failed'));
    await expect(markConversationDelivered('c1', '2026-11-02T10:05:00Z')).resolves.toBeUndefined();
    mockRpc.mockResolvedValueOnce({ error: null });
    await markConversationDelivered('c1', '2026-11-02T10:05:00Z');
    expect(mockRpc).toHaveBeenCalledTimes(3);
  });
});

describe('markConversationsDelivered', () => {
  it('stamps only when some chat has a newer message than this session stamped', async () => {
    mockRpc.mockResolvedValue({ error: null });
    const list = [
      { id: 'c1', lastMessageAt: '2026-11-02T10:05:00Z' },
      { id: 'c2', lastMessageAt: null },
    ];
    await markConversationsDelivered(list);
    await markConversationsDelivered(list);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('mark_conversations_delivered');
    await markConversationsDelivered([{ id: 'c2', lastMessageAt: '2026-11-02T10:09:00Z' }]);
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it('never for a group: receipts are one-to-one only', async () => {
    mockRpc.mockResolvedValue({ error: null });
    await markConversationsDelivered([{ id: 'g1', kind: 'group', lastMessageAt: '2026-11-02T10:05:00Z' }]);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('getOtherMemberReadAt', () => {
  type Query = {
    select: () => Query;
    eq: () => Query;
    neq: () => Query;
    limit: () => Query;
    maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  };
  function query(result: { data: unknown; error: unknown }): Query {
    const q: Query = {
      select: () => q,
      eq: () => q,
      neq: () => q,
      limit: () => q,
      maybeSingle: () => Promise.resolve(result),
    };
    return q;
  }

  it('reads both stamps', async () => {
    mockFrom.mockReturnValueOnce(query({
      data: { user_id: 'riya', last_read_at: '2026-11-02T10:03:00Z', last_delivered_at: '2026-11-02T10:05:00Z' },
      error: null,
    }));
    await expect(getOtherMemberReadAt('c1')).resolves.toEqual({
      userId: 'riya',
      lastReadAt: '2026-11-02T10:03:00Z',
      lastDeliveredAt: '2026-11-02T10:05:00Z',
    });
  });

  it('column not there yet: falls back to the old read, so "Seen" still works', async () => {
    mockFrom
      .mockReturnValueOnce(query({ data: null, error: { code: '42703', message: 'column does not exist' } }))
      .mockReturnValueOnce(query({ data: { user_id: 'riya', last_read_at: '2026-11-02T10:03:00Z' }, error: null }));
    await expect(getOtherMemberReadAt('c1')).resolves.toEqual({
      userId: 'riya',
      lastReadAt: '2026-11-02T10:03:00Z',
      lastDeliveredAt: null,
    });
  });
});
