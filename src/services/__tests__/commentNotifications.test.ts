/**
 * "Liked your comment" / "replied to your comment" (migration 20261031000000), app side:
 *  - the Activity list asks for activity_list_v2, and falls back to activity_list on a
 *    backend without it; an unknown type is still dropped, never drawn blank;
 *  - the two types read as sentences;
 *  - notifyCommentActivity pushes only when the server says to, and never throws.
 */
const mockRpc = jest.fn();
const mockSendPush = jest.fn();
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }),
  },
}));
jest.mock('../pushDispatch', () => ({ sendPush: (...a: unknown[]) => mockSendPush(...a) }));

import {
  __resetActivityListForTest,
  activitySummary,
  listActivity,
  notifyCommentActivity,
  type ActivityItem,
} from '../activity';

function row(over: Record<string, unknown>) {
  return {
    id: 'n1',
    type: 'comment_like',
    actor_id: 'riya-id',
    post_id: 'post-1',
    agg_count: 1,
    is_read: false,
    created_at: '2026-10-17T10:00:00Z',
    updated_at: '2026-10-17T10:00:00Z',
    payload: { comment_id: 'c-1', comment_text: 'this slaps' },
    actor_username: 'riya',
    actor_display_name: 'Riya',
    actor_avatar_url: null,
    post_title: 'Kesariya',
    post_cover_art_url: null,
    ...over,
  };
}

let warn: jest.SpyInstance;
beforeEach(() => {
  __resetActivityListForTest();
  mockRpc.mockReset();
  mockSendPush.mockReset();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe('listActivity', () => {
  it('reads activity_list_v2 and understands both new types', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        row({ id: 'n1', agg_count: 3 }),
        row({ id: 'n2', type: 'comment_reply', payload: { comment_id: 'r-1', comment_text: 'haha true' } }),
      ],
      error: null,
    });
    const items = await listActivity(undefined, { postDetails: false });
    expect(mockRpc).toHaveBeenCalledWith('activity_list_v2', { p_limit: 50, p_before: null });
    expect(items[0]).toMatchObject({ type: 'comment_like', aggCount: 3, commentText: 'this slaps', commentId: 'c-1' });
    expect(items[1]).toMatchObject({ type: 'comment_reply', commentText: 'haha true', commentId: 'r-1' });
  });

  it('a type this app does not know is dropped, not drawn blank', async () => {
    mockRpc.mockResolvedValueOnce({ data: [row({ type: 'something_new' }), row({ id: 'n2' })], error: null });
    const items = await listActivity(undefined, { postDetails: false });
    expect(items.map(i => i.id)).toEqual(['n2']);
  });

  it('a backend without activity_list_v2: the old list, and it stays the old list', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
      .mockResolvedValueOnce({ data: [row({ type: 'like', payload: null })], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const items = await listActivity(undefined, { postDetails: false });
    expect(items).toHaveLength(1);
    expect(mockRpc.mock.calls.map(c => c[0])).toEqual(['activity_list_v2', 'activity_list']);
    await listActivity(undefined, { postDetails: false });
    expect(mockRpc.mock.calls[2][0]).toBe('activity_list');
  });

  it('asks for the new list again after a while (the migration may have landed since)', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'missing' } })
      .mockResolvedValue({ data: [], error: null });
    await listActivity(undefined, { postDetails: false });
    now.mockReturnValue(1_000_000 + 11 * 60 * 1000);
    await listActivity(undefined, { postDetails: false });
    expect(mockRpc.mock.calls.map(c => c[0])).toEqual(['activity_list_v2', 'activity_list', 'activity_list_v2']);
    now.mockRestore();
  });

  it('any other failure is still an error', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'timeout' } });
    await expect(listActivity(undefined, { postDetails: false })).rejects.toBeTruthy();
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});

describe('the sentences', () => {
  const actor = { id: 'riya-id', username: 'riya', displayName: 'Riya', avatarUrl: null };
  const post = { postId: 'post-1', title: null, coverArtUrl: null, artistName: null, spotifyTrackId: null };
  const base = { id: 'n', isRead: false, createdAt: '', updatedAt: '' };

  it('a like on your comment, and several', () => {
    const one: ActivityItem = { ...base, type: 'comment_like', actor, post, aggCount: 1, commentText: 'this slaps', commentId: 'c' };
    expect(activitySummary(one)).toBe('Riya liked your comment: “this slaps”');
    expect(activitySummary({ ...one, aggCount: 3, commentText: null })).toBe('Riya and 2 others liked your comment');
  });

  it('a reply to your comment', () => {
    const reply: ActivityItem = { ...base, type: 'comment_reply', actor, post, commentText: 'haha true', commentId: 'r' };
    expect(activitySummary(reply)).toBe('Riya replied to your comment: “haha true”');
  });
});

describe('notifyCommentActivity', () => {
  const answer = (over: Record<string, unknown> = {}) => ({
    data: [{
      recipient_id: 'sam-id',
      agg_count: 1,
      actor_display_name: 'Riya',
      recipient_should_push: true,
      recipient_is_post_author: false,
      ...over,
    }],
    error: null,
  });

  it('a like: writes the row, pushes the comment-like kind to the comment\'s author', async () => {
    mockRpc.mockResolvedValueOnce(answer());
    expect(await notifyCommentActivity('c-1', 'comment_like')).toEqual({ recipientIsPostAuthor: false });
    expect(mockRpc).toHaveBeenCalledWith('activity_notify_comment', { p_comment_id: 'c-1', p_type: 'comment_like' });
    expect(mockSendPush).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: 'sam-id',
      kind: 'activity_comment_like',
      data: { route: 'ActivityCenter', params: { commentId: 'c-1' } },
    }));
  });

  it('a repeat like updates quietly: no second push', async () => {
    mockRpc.mockResolvedValueOnce(answer({ recipient_should_push: false }));
    await notifyCommentActivity('c-1', 'comment_like');
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it('a reply says when its recipient also owns the post', async () => {
    mockRpc.mockResolvedValueOnce(answer({ recipient_is_post_author: true }));
    expect(await notifyCommentActivity('r-1', 'comment_reply')).toEqual({ recipientIsPostAuthor: true });
    expect(mockSendPush).toHaveBeenCalledWith(expect.objectContaining({ kind: 'activity_comment_reply' }));
  });

  it('nothing to notify (yourself, blocked) is null, with no push', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await notifyCommentActivity('c-1', 'comment_like')).toBeNull();
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it('a backend without the function: null, never a throw', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'missing' } });
    await expect(notifyCommentActivity('c-1', 'comment_like')).resolves.toBeNull();
    mockRpc.mockRejectedValueOnce(new Error('network'));
    await expect(notifyCommentActivity('c-1', 'comment_reply')).resolves.toBeNull();
  });
});
