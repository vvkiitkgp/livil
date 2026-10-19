/**
 * Offline is not signed out. Asking the server who is signed in fails offline, and screens
 * that took that failure for "no user" told people "You must be signed in" (owner report,
 * 2026-10-19, Profile).
 */
const mockGetSession = jest.fn();
jest.mock('../../../lib/supabase', () => ({
  supabase: { auth: { getSession: () => mockGetSession() } },
}));

import { getMyUserId, isConnectionFailure, noUserError } from '../session';

describe('getMyUserId (the session saved on the phone)', () => {
  it('the id, with no server call', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null });
    await expect(getMyUserId()).resolves.toBe('u1');
  });
  it('null when signed out', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(getMyUserId()).resolves.toBeNull();
  });
  it('an expired session that could not refresh offline throws the connection error', async () => {
    const err = Object.assign(new Error('Network request failed'), { name: 'AuthRetryableFetchError' });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: err });
    await expect(getMyUserId()).rejects.toBe(err);
  });
});

describe('noUserError', () => {
  it('offline: the connection error, so it reads "Check your connection"', () => {
    const err = Object.assign(new Error('Network request failed'), { name: 'AuthRetryableFetchError' });
    expect(noUserError(err, 'You must be signed in to like a post.')).toBe(err);
    expect(noUserError(new TypeError('Failed to fetch'), 'x').message).toBe('Failed to fetch');
  });
  it('really signed out: the signed-in message', () => {
    expect(noUserError(null, 'You must be signed in to like a post.').message)
      .toBe('You must be signed in to like a post.');
    const invalid = Object.assign(new Error('invalid JWT'), { name: 'AuthApiError' });
    expect(noUserError(invalid, 'You must be signed in to comment.').message)
      .toBe('You must be signed in to comment.');
  });
  it('isConnectionFailure ignores non-errors', () => {
    expect(isConnectionFailure(undefined)).toBe(false);
    expect(isConnectionFailure('Network request failed')).toBe(false);
  });
});
