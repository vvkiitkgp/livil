/**
 * `navigate` adds a new screen unless the target is the one showing, so a push tapped from
 * inside a chat that names `App` would mount a second copy of every tab: two Home feeds, two
 * unread counters. It has to go back to the `App` that is already there.
 */

const mockNavigate = jest.fn();
let mockReady = true;

jest.mock('@react-navigation/native', () => ({
  createNavigationContainerRef: () => ({
    isReady: () => mockReady,
    navigate: (...a: unknown[]) => mockNavigate(...(a as [])),
  }),
}));

import { flushPendingNavigation, navigateWhenReady } from '../navigationRef';

beforeEach(() => {
  jest.clearAllMocks();
  mockReady = true;
});

it('goes back to the App that exists, whichever tab it asks for', () => {
  navigateWhenReady('App', { screen: 'Inbox' });
  expect(mockNavigate).toHaveBeenCalledWith('App', { screen: 'Inbox' }, { pop: true });
});

it('still opens any other screen as a new one', () => {
  navigateWhenReady('Conversation', { conversationId: 'conv-riya' });
  expect(mockNavigate).toHaveBeenCalledWith('Conversation', { conversationId: 'conv-riya' }, undefined);
});

it('does the same for a tap held back until the navigator was up (cold start)', () => {
  mockReady = false;
  navigateWhenReady('App', { screen: 'Inbox' });
  expect(mockNavigate).not.toHaveBeenCalled();

  mockReady = true;
  flushPendingNavigation();
  expect(mockNavigate).toHaveBeenCalledWith('App', { screen: 'Inbox' }, { pop: true });
});
