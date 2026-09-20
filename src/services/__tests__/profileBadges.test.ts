/**
 * Tests for the badge read path.
 *
 * WHY THIS ONE IS WORTH PINNING
 *
 * Two of these properties are product rules that fail SILENTLY if they regress, which is
 * the shape this codebase keeps paying for:
 *
 *   1. FAIL-SAFE, NOT THROWING. A badge is decoration on a profile that has already
 *      loaded, and it is fetched inside the same Promise.all as the profile row itself.
 *      If this ever rejected, a badge outage would blank the whole profile screen —
 *      a much larger failure than the one it is reporting.
 *
 *   2. UNKNOWN BADGES ARE DROPPED. The database CHECK allows one value today, and the
 *      renderer maps badge names to components. A badge added server-side and shipped
 *      before the client knows it would otherwise reach the rail and render nothing,
 *      taking up a slot and a tap target that do nothing.
 *
 * The RPC itself is mocked: what the server returns is asserted in
 * supabase/tests/rls/first-100-badges.test.sql, against a real Postgres.
 */

const mockRpc = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: { rpc: (fn: string, args: unknown) => mockRpc(fn, args) },
}));

import { fetchBadgesForUser, fetchProfileBadges } from '../profileBadges';

beforeEach(() => {
  mockRpc.mockReset().mockResolvedValue({ data: [], error: null });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  (console.warn as jest.Mock).mockRestore();
});

describe('fetchProfileBadges', () => {
  it('groups badges by user', async () => {
    mockRpc.mockResolvedValue({
      data: [
        { user_id: 'a', badge: 'first_100' },
        { user_id: 'b', badge: 'first_100' },
      ],
      error: null,
    });

    await expect(fetchProfileBadges(['a', 'b'])).resolves.toEqual({
      a: ['first_100'],
      b: ['first_100'],
    });
  });

  it('drops a badge the client does not know how to render', async () => {
    mockRpc.mockResolvedValue({
      data: [
        { user_id: 'a', badge: 'first_100' },
        { user_id: 'a', badge: 'badge_from_the_future' },
      ],
      error: null,
    });

    await expect(fetchProfileBadges(['a'])).resolves.toEqual({ a: ['first_100'] });
  });

  it('asks about each id once, however many times it was passed', async () => {
    await fetchProfileBadges(['a', 'a', 'b', '']);
    expect(mockRpc).toHaveBeenCalledWith('badges_for_profiles', { p_user_ids: ['a', 'b'] });
  });

  it('does not call the database at all for an empty list', async () => {
    await expect(fetchProfileBadges([])).resolves.toEqual({});
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // The whole point of the fail-safe mode: the profile renders, minus the badge.
  it('resolves empty when the rpc errors, rather than rejecting', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(fetchProfileBadges(['a'])).resolves.toEqual({});
  });

  it('resolves empty when the rpc throws, rather than rejecting', async () => {
    mockRpc.mockRejectedValue(new Error('offline'));
    await expect(fetchProfileBadges(['a'])).resolves.toEqual({});
  });

  // A row with no user id cannot be attributed to anyone. The server already filters
  // orphaned rows; this is the client refusing to key an object by "null".
  it('ignores a row with no user id', async () => {
    mockRpc.mockResolvedValue({
      data: [{ user_id: null, badge: 'first_100' }],
      error: null,
    });
    await expect(fetchProfileBadges(['a'])).resolves.toEqual({});
  });
});

describe('fetchBadgesForUser', () => {
  it('returns that user’s badges', async () => {
    mockRpc.mockResolvedValue({ data: [{ user_id: 'a', badge: 'first_100' }], error: null });
    await expect(fetchBadgesForUser('a')).resolves.toEqual(['first_100']);
  });

  it('returns an empty list for someone with none', async () => {
    await expect(fetchBadgesForUser('a')).resolves.toEqual([]);
  });
});
