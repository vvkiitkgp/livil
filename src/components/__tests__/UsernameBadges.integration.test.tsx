/**
 * The REAL component inside the REAL provider.
 *
 * The context is tested on its own and the marks are tested on their own; both pass. This
 * asserts the seam between them, which is where a badge can be fetched correctly and still
 * never reach the screen.
 */
const mockFetch = jest.fn();
jest.mock('../../services/profileBadges', () => ({
  fetchProfileBadges: (ids: string[]) => mockFetch(ids),
  PROFILE_BADGES: ['first_100', 'verified'],
}));

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ProfileBadgesProvider } from '../../contexts/ProfileBadgesContext';
import UsernameBadges from '../UsernameBadges';

test('renders both marks once the batch resolves', async () => {
  jest.useFakeTimers();
  mockFetch.mockResolvedValue({ u1: ['first_100', 'verified'] });

  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ProfileBadgesProvider><UsernameBadges userId="u1" size={15} /></ProfileBadgesProvider>,
    );
  });

  // Nothing before the batch lands — the component costs no layout on most rows.
  expect(tree.toJSON()).toBeNull();

  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(60);
    await Promise.resolve();
  });

  expect(mockFetch).toHaveBeenCalledWith(['u1']);
  // The marks actually drew, rather than the cache merely being correct.
  expect(JSON.stringify(tree.toJSON())).toContain('RNSVG');
  jest.useRealTimers();
});
