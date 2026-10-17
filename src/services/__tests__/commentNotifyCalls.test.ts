/**
 * Who comments.ts tells, and when:
 *  - a reply tells the parent comment's author; when they also own the post, the post's
 *    "commented on your post" is skipped — told once, not twice;
 *  - a top-level comment tells only the post's author, as before;
 *  - liking a comment tells its author; unliking tells nobody.
 */
const mockNotifyPost = jest.fn(async (..._a: unknown[]) => undefined);
const mockNotifyComment = jest.fn(async (..._a: unknown[]): Promise<{ recipientIsPostAuthor: boolean } | null> => null);
jest.mock('../activity', () => ({
  notifyPostActivity: (...a: unknown[]) => mockNotifyPost(...a),
  notifyCommentActivity: (...a: unknown[]) => mockNotifyComment(...a),
}));

let mockExistingLike: { comment_id: string } | null = null;
let mockDeleteResult: { data: unknown; error: unknown } = { data: [{ id: 'c-1' }], error: null };
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'me' } }, error: null }) },
    from: (table: string) => {
      if (table === 'post_comment_likes') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: mockExistingLike, error: null }),
          delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
          insert: async () => ({ error: null }),
        };
        return chain;
      }
      return {
        delete: () => ({ eq: () => ({ select: async () => mockDeleteResult }) }),
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => ({
              data: {
                id: 'new-comment',
                post_id: row.post_id,
                author_id: 'me',
                body: row.body,
                parent_comment_id: row.parent_comment_id,
                created_at: '2026-10-17T10:00:00Z',
                like_count: 0,
                author: { id: 'me', username: 'riya', display_name: 'Riya', avatar_url: null },
              },
              error: null,
            }),
          }),
        }),
      };
    },
  },
}));

import { __resetSongColumnsMissingForTest, createComment, deleteComment, toggleCommentLike } from '../comments';

/** Let the fire-and-forget notification chain run. */
const settle = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  __resetSongColumnsMissingForTest();
  mockNotifyPost.mockClear();
  mockNotifyComment.mockReset();
  mockExistingLike = null;
});

it('a top-level comment tells only the post\'s author, as before', async () => {
  await createComment('post-1', 'love this');
  await settle();
  expect(mockNotifyComment).not.toHaveBeenCalled();
  expect(mockNotifyPost).toHaveBeenCalledWith('post-1', 'comment', { commentText: 'love this', commentId: 'new-comment' });
});

it('a reply tells the parent\'s author, and the post\'s author too when they are someone else', async () => {
  mockNotifyComment.mockResolvedValueOnce({ recipientIsPostAuthor: false });
  await createComment('post-1', 'haha true', 'parent-1');
  await settle();
  expect(mockNotifyComment).toHaveBeenCalledWith('new-comment', 'comment_reply');
  expect(mockNotifyPost).toHaveBeenCalledWith('post-1', 'comment', expect.objectContaining({ commentId: 'new-comment' }));
});

it('a reply to the post author\'s own comment tells them once', async () => {
  mockNotifyComment.mockResolvedValueOnce({ recipientIsPostAuthor: true });
  await createComment('post-1', 'anytime', 'parent-1');
  await settle();
  expect(mockNotifyComment).toHaveBeenCalledTimes(1);
  expect(mockNotifyPost).not.toHaveBeenCalled();
});

it('a reply the server would not notify about (yourself, blocked) still tells the post\'s author', async () => {
  mockNotifyComment.mockResolvedValueOnce(null);
  await createComment('post-1', 'also this', 'parent-1');
  await settle();
  expect(mockNotifyPost).toHaveBeenCalledTimes(1);
});

it('liking a comment tells its author; unliking tells nobody', async () => {
  expect(await toggleCommentLike('c-1')).toBe(true);
  expect(mockNotifyComment).toHaveBeenCalledWith('c-1', 'comment_like');
  mockNotifyComment.mockClear();
  mockExistingLike = { comment_id: 'c-1' };
  expect(await toggleCommentLike('c-1')).toBe(false);
  expect(mockNotifyComment).not.toHaveBeenCalled();
});

it('a delete the database refused (not yours, not your post) is a failure, not silence', async () => {
  mockDeleteResult = { data: [{ id: 'c-1' }], error: null };
  await expect(deleteComment('c-1')).resolves.toBeUndefined();
  // RLS refuses by matching no row — no error comes back.
  mockDeleteResult = { data: [], error: null };
  await expect(deleteComment('c-1')).rejects.toThrow("Couldn't delete the comment.");
  mockDeleteResult = { data: null, error: { message: 'boom' } };
  await expect(deleteComment('c-1')).rejects.toThrow('boom');
});
