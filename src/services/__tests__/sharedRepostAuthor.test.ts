/**
 * A friends-only repost sent to a non-friend in chat says whose it is (20261112000000). The
 * name must come from the server and the profile read, never from the message; a backend
 * without the function must leave the card as the plain song card (null), and a failed
 * REQUEST must throw so the card's cache does not remember "nobody".
 */
const mockRpc = jest.fn();
const mockMaybeSingle = jest.fn();
const mockEq = jest.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn(() => ({ select: mockSelect }));
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => (mockFrom as (...a: unknown[]) => unknown)(...args),
  },
}));

import { fetchSharedRepostAuthor } from '../share';

const MESSAGE = 'ca000000-0000-0000-0000-000000000001';
const RIYA = 'c6000000-0000-0000-0000-000000000001';

beforeEach(() => {
  mockRpc.mockReset();
  mockMaybeSingle.mockReset();
  mockEq.mockClear();
  mockFrom.mockClear();
});

it('asks the server by MESSAGE, then reads that profile', async () => {
  mockRpc.mockResolvedValue({ data: RIYA, error: null });
  mockMaybeSingle.mockResolvedValue({
    data: { id: RIYA, username: 'riya', display_name: 'Riya', avatar_url: 'https://x/a.jpg' },
    error: null,
  });
  await expect(fetchSharedRepostAuthor(MESSAGE)).resolves.toEqual({
    userId: RIYA, username: 'riya', displayName: 'Riya', avatarUrl: 'https://x/a.jpg',
  });
  expect(mockRpc).toHaveBeenCalledWith('shared_repost_author', { p_message_id: MESSAGE });
  expect(mockFrom).toHaveBeenCalledWith('profiles');
  expect(mockEq).toHaveBeenCalledWith('id', RIYA);
});

it('names nobody → null, and no profile read', async () => {
  mockRpc.mockResolvedValue({ data: null, error: null });
  await expect(fetchSharedRepostAuthor(MESSAGE)).resolves.toBeNull();
  expect(mockFrom).not.toHaveBeenCalled();
});

it('a profile the viewer may not see → null', async () => {
  mockRpc.mockResolvedValue({ data: RIYA, error: null });
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  await expect(fetchSharedRepostAuthor(MESSAGE)).resolves.toBeNull();
});

it.each(['PGRST202', '42883'])('a backend without the function (%s) → null, not an error', async code => {
  mockRpc.mockResolvedValue({ data: null, error: { code, message: 'missing' } });
  await expect(fetchSharedRepostAuthor(MESSAGE)).resolves.toBeNull();
});

it('a failed request throws', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { code: '', message: 'Network request failed' } });
  await expect(fetchSharedRepostAuthor(MESSAGE)).rejects.toBeTruthy();
});
