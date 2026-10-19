/**
 * A GIF in chat is a TEXT message: body '🎞 GIF' (what older builds, the inbox line and the
 * push show) with the GIF in metadata — no new message kind, nothing new on the server.
 */
const mockInsert = jest.fn();
const mockSendPush = jest.fn(async () => {});
jest.mock('../../../lib/supabase', () => {
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const k of ['select', 'eq', 'neq']) { c[k] = () => c; }
    c.maybeSingle = async () => result;
    c.single = async () => result;
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
    return c;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'me' } } }) },
      from: (table: string) => {
        if (table === 'messages') {
          return {
            insert: (row: unknown) => {
              mockInsert(row);
              return chain({ data: { id: 'm1', created_at: '2026-10-19T10:00:00Z' }, error: null });
            },
          };
        }
        if (table === 'conversations') { return chain({ data: { kind: 'dm', name: null } }); }
        return chain({ data: [{ user_id: 'friend' }] });
      },
    },
  };
});
jest.mock('../pushDispatch', () => ({ sendPush: (...a: unknown[]) => mockSendPush(...(a as [])) }));

import { sendMessage } from '../messages';
import { chatGifMetadata } from '../../utils/chatGif';

it('sends a GIF as a text message with the GIF in metadata, and pushes "🎞 GIF"', async () => {
  const metadata = chatGifMetadata({ id: '3o7TKSjRrfIPjeiVyM', width: 200, height: 150 });
  const msg = await sendMessage('c1', { kind: 'text', body: '🎞 GIF', metadata });

  expect(mockInsert).toHaveBeenCalledWith({ conversation_id: 'c1', sender_id: 'me', kind: 'text', body: '🎞 GIF', metadata });
  expect(msg).toMatchObject({ kind: 'text', body: '🎞 GIF', metadata });
  await new Promise(r => setImmediate(r));
  expect(mockSendPush).toHaveBeenCalledWith(expect.objectContaining({ recipientUserId: 'friend', body: '🎞 GIF' }));
});

it('a plain text message still carries no metadata', async () => {
  mockInsert.mockClear();
  await sendMessage('c1', { kind: 'text', body: 'hey' });
  expect(mockInsert).toHaveBeenCalledWith({ conversation_id: 'c1', sender_id: 'me', kind: 'text', body: 'hey' });
});
