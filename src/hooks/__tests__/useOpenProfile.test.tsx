/**
 * A post card opens a profile by PUSHING one, never by `navigate`: from inside a UserProfile,
 * `navigate` swaps the open profile's params instead of opening the person tapped, which is
 * the 2026-11-08 bug (a repost's "↻ from @name" tag glitched on someone's profile). The one
 * tap that opens nothing is the profile already on screen.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockDispatch = jest.fn();
let mockRoute: { name: string; params?: object } = { name: 'Home' };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ dispatch: mockDispatch }),
  useRoute: () => mockRoute,
  StackActions: { push: (name: string, params: object) => ({ type: 'PUSH', payload: { name, params } }) },
}));

import { useOpenProfile } from '../useOpenProfile';

function mount() {
  const api: { current: ((userId: string) => void) | null } = { current: null };
  function Probe() {
    api.current = useOpenProfile();
    return null;
  }
  act(() => { TestRenderer.create(<Probe />); });
  return api.current!;
}

const pushOf = (userId: string) => ({ type: 'PUSH', payload: { name: 'UserProfile', params: { userId } } });

beforeEach(() => { mockDispatch.mockClear(); });

it('pushes the profile from the feed', () => {
  mockRoute = { name: 'Home' };
  mount()('krishna');
  expect(mockDispatch).toHaveBeenCalledWith(pushOf('krishna'));
});

it('pushes the creator on top of someone else\'s profile, rather than swapping it', () => {
  mockRoute = { name: 'UserProfile', params: { userId: 'riya' } };
  mount()('krishna');
  expect(mockDispatch).toHaveBeenCalledWith(pushOf('krishna'));
});

it('opens nothing for the profile already on screen', () => {
  mockRoute = { name: 'UserProfile', params: { userId: 'riya' } };
  mount()('riya');
  expect(mockDispatch).not.toHaveBeenCalled();
});
