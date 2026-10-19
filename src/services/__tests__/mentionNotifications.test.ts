/**
 * Mentions (migration 20261109000000), app side:
 *  - a 'mention' row reads as a sentence — a caption tag and a comment tag differ;
 *  - notifyMentions asks the server (by post OR comment) and pushes to exactly who it
 *    returns, as activity_mention; a missing function is silence, never a throw.
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

import { __resetActivityListForTest, activitySummary, listActivity, notifyMentions } from '../activity';

function row(over: Record<string, unknown>) {
  return {
    id: 'n1',
    type: 'mention',
    actor_id: 'sam-id',
    post_id: 'post-1',
    agg_count: 1,
    is_read: false,
    created_at: '2026-10-19T10:00:00Z',
    updated_at: '2026-10-19T10:00:00Z',
    payload: { where: 'post', text: "this one's for @riya 🎧" },
    actor_username: 'sam',
    actor_display_name: 'Sam',
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

it('a caption tag and a comment tag read as sentences, quoting the text', async () => {
  mockRpc.mockResolvedValue({
    data: [
      row({}),
      row({ id: 'n2', payload: { where: 'comment', text: '@riya listen to the drop', comment_id: 'c-9' } }),
    ],
    error: null,
  });
  const items = await listActivity();
  expect(items.map(activitySummary)).toEqual([
    "Sam tagged you in a post: “this one's for @riya 🎧”",
    'Sam mentioned you in a comment: “@riya listen to the drop”',
  ]);
  expect(items[1]).toMatchObject({ type: 'mention', where: 'comment', commentId: 'c-9' });
});

it('notifyMentions pushes to exactly the people the server returns', async () => {
  mockRpc.mockResolvedValue({
    data: [{ recipient_id: 'riya-id', actor_display_name: 'Sam' }, { recipient_id: 'tom-id', actor_display_name: 'Sam' }],
    error: null,
  });
  await notifyMentions({ postId: 'post-1' });
  expect(mockRpc).toHaveBeenCalledWith('activity_notify_mentions', { p_post_id: 'post-1' });
  expect(mockSendPush.mock.calls.map(c => [c[0].recipientUserId, c[0].kind])).toEqual([
    ['riya-id', 'activity_mention'],
    ['tom-id', 'activity_mention'],
  ]);

  mockRpc.mockClear();
  mockRpc.mockResolvedValue({ data: [], error: null });
  await notifyMentions({ commentId: 'c-1' });
  expect(mockRpc).toHaveBeenCalledWith('activity_notify_mentions', { p_comment_id: 'c-1' });
});

it('a backend without the function: nothing pushed, nothing thrown', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'missing' } });
  await expect(notifyMentions({ postId: 'post-1' })).resolves.toBeUndefined();
  expect(mockSendPush).not.toHaveBeenCalled();
});
