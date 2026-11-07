/**
 * Offline is not signed out. Asking the server who is signed in fails offline, and screens
 * that took that failure for "no user" told people "You must be signed in" (owner report,
 * 2026-10-19, Profile).
 */
const mockGetSession = jest.fn();
jest.mock('../../../lib/supabase', () => ({
  supabase: { auth: { getSession: () => mockGetSession() } },
}));

import { getMyUserId, isConnectionFailure, isFailedRefreshEvent, noUserError, startupSession } from '../session';

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

describe('startupSession (an expired login with no way to refresh it is not signed out)', () => {
  const saved = { access_token: 'a', user: { id: 'u1' } } as never;
  const offline = Object.assign(new Error('Network request failed'), { name: 'AuthRetryableFetchError' });

  it('keeps the saved login when the refresh could not reach the server', async () => {
    await expect(startupSession(null, offline, async () => saved)).resolves.toBe(saved);
  });
  it('uses what the client answered', async () => {
    const readSaved = jest.fn();
    const live = { access_token: 'b', user: { id: 'u1' } } as never;
    await expect(startupSession(live, null, readSaved)).resolves.toBe(live);
    expect(readSaved).not.toHaveBeenCalled();
  });
  it('is signed out when there is no login, or the server refused it', async () => {
    const refused = Object.assign(new Error('Invalid Refresh Token'), { name: 'AuthApiError', status: 400 });
    const readSaved = jest.fn(async () => saved);
    await expect(startupSession(null, null, readSaved)).resolves.toBeNull();
    await expect(startupSession(null, refused, readSaved)).resolves.toBeNull();
    expect(readSaved).not.toHaveBeenCalled();
  });
  it('is signed out when the connection failed and nothing is saved', async () => {
    await expect(startupSession(null, offline, async () => null)).resolves.toBeNull();
  });
});

describe('isFailedRefreshEvent', () => {
  it('ignores "no session" from a refresh that failed', () => {
    expect(isFailedRefreshEvent('INITIAL_SESSION', null)).toBe(true);
  });
  it('never ignores a sign-out, or an event carrying a login', () => {
    const live = { access_token: 'a', user: { id: 'u1' } } as never;
    expect(isFailedRefreshEvent('SIGNED_OUT', null)).toBe(false);
    expect(isFailedRefreshEvent('TOKEN_REFRESHED', live)).toBe(false);
    expect(isFailedRefreshEvent('INITIAL_SESSION', live)).toBe(false);
  });
});
