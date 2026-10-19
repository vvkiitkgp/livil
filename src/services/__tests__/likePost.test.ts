/**
 * likePost — what a double tap on the artwork calls. It only ever LIKES:
 *  - a new like is inserted and tells the post's author;
 *  - a like that already exists (the card's heart was stale — liked on another screen) is
 *    the answer wanted: no error, nothing deleted, nobody told twice;
 *  - any other failure is an error, so the card can put its heart back.
 */
const mockNotifyPost = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../activity', () => ({
  notifyPostActivity: (...a: unknown[]) => mockNotifyPost(...a),
  notifyMentions: jest.fn(),
}));
jest.mock('../pushDispatch', () => ({ sendPush: jest.fn() }));
jest.mock('../spotify', () => ({ fetchSpotifyTrackIds: jest.fn() }));

let mockInsertError: { code?: string; message: string } | null = null;
const mockInsert = jest.fn(async (_row: Record<string, unknown>) => ({ error: mockInsertError }));
const mockDelete = jest.fn();
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'me' } }, error: null }) },
    from: (table: string) => {
      if (table !== 'post_likes') { throw new Error(`unexpected table ${table}`); }
      return { insert: (row: Record<string, unknown>) => mockInsert(row), delete: mockDelete };
    },
  },
}));

import { likePost } from '../posts';

beforeEach(() => {
  mockInsertError = null;
  mockInsert.mockClear();
  mockDelete.mockClear();
  mockNotifyPost.mockClear();
});

it('likes a post and tells its author', async () => {
  await expect(likePost('p-1')).resolves.toBeUndefined();
  expect(mockInsert).toHaveBeenCalledWith({ post_id: 'p-1', user_id: 'me' });
  expect(mockNotifyPost).toHaveBeenCalledWith('p-1', 'like');
});

it('treats an existing like as liked — never deletes it, never notifies again', async () => {
  mockInsertError = { code: '23505', message: 'duplicate key value violates unique constraint "post_likes_pkey"' };
  await expect(likePost('p-1')).resolves.toBeUndefined();
  expect(mockDelete).not.toHaveBeenCalled();
  expect(mockNotifyPost).not.toHaveBeenCalled();
});

it('throws on any other failure so the heart can be put back', async () => {
  mockInsertError = { code: '42501', message: 'permission denied' };
  await expect(likePost('p-1')).rejects.toThrow('permission denied');
  expect(mockNotifyPost).not.toHaveBeenCalled();
});
