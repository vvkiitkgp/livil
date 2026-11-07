/**
 * The number on the Messages tab and the app icon, read the way a user reads it: every test
 * looks at what MessagesTabIcon actually shows.
 *
 * Real: the provider, the icon, and services/appBadge. Faked: the network, realtime delivery and
 * the OS badge call, so a test can make a message "arrive" and then look at the tab.
 *
 * LIMITATION: Home and Messages asking for a re-count on focus is not covered here. Those screens
 * do not mount under Jest; the request they send is what is tested.
 */

import React from 'react';
import { AppState, Platform, Text } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

type Handler = (payload: unknown) => void;
type Row = { sender_id?: string | null; kind?: string; deleted_at?: string | null };

const mockChannels: Array<{ topic: string; filter: Record<string, string>; handler: Handler }> = [];
const mockRemoved: string[] = [];
const mockListConversations = jest.fn();
const mockActivityCount = jest.fn();
const mockSetBadgeCount = jest.fn();
const mockCancelNotifications = jest.fn();
const mockDisplayed = jest.fn();
let mockPending = 0;

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'me' } } }) },
    channel: (topic: string) => {
      const channel = {
        topic,
        on: (_type: string, filter: Record<string, string>, handler: Handler) => {
          mockChannels.push({ topic, filter, handler });
          return channel;
        },
        subscribe: (onStatus?: (status: string) => void) => {
          onStatus?.('SUBSCRIBED');
          return channel;
        },
      };
      return channel;
    },
    removeChannel: (channel: { topic: string }) => {
      mockRemoved.push(channel.topic);
      return Promise.resolve();
    },
  },
}));
jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    setBadgeCount: (...a: unknown[]) => mockSetBadgeCount(...(a as [])),
    getDisplayedNotifications: () => mockDisplayed(),
    cancelAllNotifications: (...a: unknown[]) => mockCancelNotifications(...(a as [])),
  },
}));
jest.mock('../../services/conversations', () => ({
  listConversations: () => mockListConversations(),
}));
jest.mock('../../services/activity', () => ({
  getActivityUnreadCount: () => mockActivityCount(),
}));
jest.mock('../RelationshipContext', () => ({
  useRelationships: () => ({ pendingIncomingCount: mockPending }),
}));
jest.mock('../../utils/retryOnce', () => ({
  retryOnce: (fn: () => Promise<unknown>) => fn(),
}));
jest.mock('../../components/Icon', () => ({ Icon: () => null }));

import { UnreadBadgeProvider } from '../UnreadBadgeContext';
import MessagesTabIcon from '../../components/MessagesTabIcon';
import { requestBadgeRefresh } from '../../services/appBadge';
import { bumpRealtimeEpoch, getRealtimeEpoch } from '../../utils/realtimeEpoch';

const messagesTopic = () => `unread-badge:${getRealtimeEpoch()}`;
const activityTopic = () => `unread-badge:activity:me:${getRealtimeEpoch()}`;

/** Riya's chat with 2 unread and Sam's with 1 is `chats(2, 1)`. */
const chats = (...unread: number[]) => unread.map((unreadCount, i) => ({ id: `chat-${i}`, unreadCount }));

const settle = () => act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });

const tab = () => (
  <UnreadBadgeProvider>
    <MessagesTabIcon color="#fff" focused={false} />
  </UnreadBadgeProvider>
);

const opened: ReactTestRenderer[] = [];

async function openApp(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(tab()); });
  opened.push(tree);
  await settle();
  return tree;
}

/** What the tab shows: the badge's text, or null when there is no badge. */
function shown(tree: ReactTestRenderer): unknown {
  const texts = tree.root.findAllByType(Text);
  return texts.length ? texts[0].props.children : null;
}

function subscribed(topic: string) {
  const found = mockChannels.find(c => c.topic === topic);
  if (!found) { throw new Error(`no channel ${topic}`); }
  return found;
}

async function messageArrives(row: Row) {
  await act(async () => { subscribed(messagesTopic()).handler({ new: { sender_id: 'riya', ...row } }); });
}

async function activityChanges() {
  await act(async () => { subscribed(activityTopic()).handler({}); });
  await settle();
}

async function askForRecount() {
  await act(async () => { requestBadgeRefresh(); });
  await settle();
}

const appStateHandlers: Array<(state: string) => void> = [];

async function appState(state: string) {
  await act(async () => { appStateHandlers.forEach(handler => handler(state)); });
  await settle();
}

const realOS = Platform.OS;

beforeEach(() => {
  jest.clearAllMocks();
  mockChannels.length = 0;
  mockRemoved.length = 0;
  appStateHandlers.length = 0;
  mockPending = 0;
  Platform.OS = 'ios';
  mockListConversations.mockResolvedValue([]);
  mockActivityCount.mockResolvedValue(0);
  mockDisplayed.mockResolvedValue([]);
  mockSetBadgeCount.mockResolvedValue(undefined);
  mockCancelNotifications.mockResolvedValue(undefined);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: (s: string) => void) => {
    appStateHandlers.push(handler);
    return {
      remove: () => {
        const at = appStateHandlers.indexOf(handler);
        if (at >= 0) { appStateHandlers.splice(at, 1); }
      },
    };
  }) as never);
});

// requestBadgeRefresh reaches every provider still mounted, so a test's app must close with it.
afterEach(async () => {
  await act(async () => { opened.splice(0).forEach(tree => tree.unmount()); });
});

afterAll(() => { Platform.OS = realOS; });

describe('the number on the tab', () => {
  it('adds unread chats, friend requests and livil Bot activity', async () => {
    mockListConversations.mockResolvedValue(chats(2, 1));
    mockPending = 1;
    mockActivityCount.mockResolvedValue(4);
    expect(shown(await openApp())).toBe(8);
  });

  it('shows no badge when everything is read', async () => {
    expect(shown(await openApp())).toBeNull();
  });

  it('shows 99 as 99, and anything above as 99+', async () => {
    mockListConversations.mockResolvedValue(chats(99));
    const tree = await openApp();
    expect(shown(tree)).toBe(99);
    await messageArrives({});
    expect(shown(tree)).toBe('99+');
  });
});

describe('a message arriving', () => {
  it('adds one, straight away, for each message from a friend', async () => {
    const tree = await openApp();
    await messageArrives({});
    expect(shown(tree)).toBe(1);
    await messageArrives({ sender_id: 'sam' });
    expect(shown(tree)).toBe(2);
  });

  it('adds to what was already unread', async () => {
    mockListConversations.mockResolvedValue(chats(3));
    const tree = await openApp();
    await messageArrives({});
    expect(shown(tree)).toBe(4);
  });

  it('ignores a message I sent from this account', async () => {
    const tree = await openApp();
    await messageArrives({ sender_id: 'me' });
    expect(shown(tree)).toBeNull();
  });

  it('ignores a system line ("Riya joined the group")', async () => {
    const tree = await openApp();
    await messageArrives({ kind: 'system' });
    expect(shown(tree)).toBeNull();
  });

  it('ignores a message that is already deleted', async () => {
    const tree = await openApp();
    await messageArrives({ deleted_at: '2026-11-07T10:00:00Z' });
    expect(shown(tree)).toBeNull();
  });

  it('listens to new messages only, not edits', async () => {
    await openApp();
    expect(subscribed(messagesTopic()).filter).toEqual({ event: 'INSERT', schema: 'public', table: 'messages' });
  });
});

describe('livil Bot activity', () => {
  it('goes up when someone likes my post', async () => {
    const tree = await openApp();
    mockActivityCount.mockResolvedValue(1);
    await activityChanges();
    expect(shown(tree)).toBe(1);
  });

  it('re-reads the count rather than adding one, because likes merge into one row', async () => {
    mockActivityCount.mockResolvedValue(3);
    const tree = await openApp();
    // A fourth like updates the existing row: still three unread rows.
    await activityChanges();
    expect(shown(tree)).toBe(3);
  });

  it('comes down when I read it', async () => {
    mockActivityCount.mockResolvedValue(2);
    const tree = await openApp();
    expect(shown(tree)).toBe(2);
    mockActivityCount.mockResolvedValue(0);
    await activityChanges();
    expect(shown(tree)).toBeNull();
  });

  it('listens to my rows only', async () => {
    await openApp();
    expect(subscribed(activityTopic()).filter).toEqual({
      event: '*',
      schema: 'public',
      table: 'activity_notifications',
      filter: 'recipient_id=eq.me',
    });
  });

  it('keeps the number when the re-read fails', async () => {
    mockActivityCount.mockResolvedValue(2);
    const tree = await openApp();
    mockActivityCount.mockRejectedValue(new Error('Network request failed'));
    await activityChanges();
    expect(shown(tree)).toBe(2);
  });

  it('adds to unread messages rather than replacing them', async () => {
    mockListConversations.mockResolvedValue(chats(2));
    const tree = await openApp();
    mockActivityCount.mockResolvedValue(1);
    await activityChanges();
    expect(shown(tree)).toBe(3);
  });
});

describe('friend requests', () => {
  it('goes up on a new request and down when it is answered', async () => {
    const tree = await openApp();
    mockPending = 2;
    await act(async () => { tree.update(tab()); });
    expect(shown(tree)).toBe(2);
    mockPending = 0;
    await act(async () => { tree.update(tab()); });
    expect(shown(tree)).toBeNull();
  });
});

describe('reading', () => {
  it('drops the number once a chat has been read', async () => {
    mockListConversations.mockResolvedValue(chats(2, 1));
    const tree = await openApp();
    expect(shown(tree)).toBe(3);
    mockListConversations.mockResolvedValue(chats(0, 1));
    await askForRecount();
    expect(shown(tree)).toBe(1);
  });

  it('corrects the +1 a message added while its chat was open', async () => {
    const tree = await openApp();
    await messageArrives({});
    expect(shown(tree)).toBe(1);
    // The chat saved its read marker, so the server now says nothing is unread.
    await askForRecount();
    expect(shown(tree)).toBeNull();
  });

  it('an older re-count landing last cannot put the old number back', async () => {
    mockListConversations.mockResolvedValue(chats(5));
    const tree = await openApp();
    expect(shown(tree)).toBe(5);

    // Leaving a chat fires two at once: this one read before the read marker was saved...
    let finishOld!: (value: unknown) => void;
    mockListConversations.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }));
    await act(async () => { requestBadgeRefresh(); });
    // ...and this one read after.
    mockListConversations.mockResolvedValue(chats(0));
    await askForRecount();
    expect(shown(tree)).toBeNull();

    mockSetBadgeCount.mockClear();
    await act(async () => { finishOld(chats(5)); });
    await settle();
    expect(shown(tree)).toBeNull();
    expect(mockSetBadgeCount).not.toHaveBeenCalledWith(5);
  });
});

describe('coming back to the app', () => {
  it('picks up messages that arrived while it was in the background', async () => {
    const tree = await openApp();
    mockListConversations.mockResolvedValue(chats(4));
    await appState('active');
    expect(shown(tree)).toBe(4);
  });

  it('does not re-count on the way out', async () => {
    await openApp();
    mockListConversations.mockClear();
    await appState('background');
    expect(mockListConversations).not.toHaveBeenCalled();
  });

  it('re-writes the iOS icon even when the number has not changed, as a push may have set it', async () => {
    mockListConversations.mockResolvedValue(chats(3));
    await openApp();
    mockSetBadgeCount.mockClear();
    await appState('active');
    expect(mockSetBadgeCount).toHaveBeenCalledWith(3);
  });
});

describe('the app icon', () => {
  it('follows the number on iOS', async () => {
    mockListConversations.mockResolvedValue(chats(2));
    await openApp();
    expect(mockSetBadgeCount).toHaveBeenLastCalledWith(2);
    await messageArrives({});
    expect(mockSetBadgeCount).toHaveBeenLastCalledWith(3);
  });

  it('counts friend requests in its re-write', async () => {
    mockListConversations.mockResolvedValue(chats(1));
    mockActivityCount.mockResolvedValue(1);
    mockPending = 1;
    await openApp();
    mockSetBadgeCount.mockClear();
    await appState('active');
    expect(mockSetBadgeCount).toHaveBeenCalledWith(3);
  });

  it('is never given a number on Android, which has no way to set one', async () => {
    Platform.OS = 'android';
    mockListConversations.mockResolvedValue(chats(2));
    await openApp();
    await appState('active');
    expect(mockSetBadgeCount).not.toHaveBeenCalled();
  });

  it('clears only our own notifications when everything is read, never the music card', async () => {
    Platform.OS = 'android';
    mockListConversations.mockResolvedValue(chats(2));
    const tree = await openApp();
    mockCancelNotifications.mockClear();
    mockDisplayed.mockResolvedValue([{ id: 'livil:chat:riya' }, { id: '123456' }]);
    mockListConversations.mockResolvedValue(chats(0));
    await askForRecount();
    expect(shown(tree)).toBeNull();
    expect(mockCancelNotifications).toHaveBeenCalledWith(['livil:chat:riya']);
  });
});

describe('coming back to the app on an iPhone', () => {
  // RealtimeConnectionGate closed the socket on leaving, which wiped both channels' listeners.
  async function socketReopened() {
    await act(async () => { bumpRealtimeEpoch(); });
    await settle();
  }

  it('listens again, so a message after the app switch still adds one', async () => {
    const tree = await openApp();
    const before = messagesTopic();
    await socketReopened();
    expect(messagesTopic()).not.toBe(before);
    await messageArrives({});
    expect(shown(tree)).toBe(1);
  });

  it('listens again for livil Bot too', async () => {
    const tree = await openApp();
    await socketReopened();
    mockActivityCount.mockResolvedValue(2);
    await activityChanges();
    expect(shown(tree)).toBe(2);
  });

  it('drops the dead channels instead of keeping them', async () => {
    await openApp();
    const dead = [messagesTopic(), activityTopic()];
    await socketReopened();
    expect(mockRemoved).toEqual(expect.arrayContaining(dead));
  });

  it('re-counts once listening, for whatever arrived while it was not', async () => {
    const tree = await openApp();
    mockListConversations.mockResolvedValue(chats(3));
    await socketReopened();
    expect(shown(tree)).toBe(3);
  });
});

describe('when the network fails', () => {
  it('keeps the number when the chats cannot be read, and still updates activity', async () => {
    mockListConversations.mockResolvedValue(chats(3));
    const tree = await openApp();
    mockListConversations.mockRejectedValue(new Error('Network request failed'));
    mockActivityCount.mockResolvedValue(1);
    await askForRecount();
    expect(shown(tree)).toBe(4);
  });

  it('does not re-write the icon from half an answer', async () => {
    mockListConversations.mockResolvedValue(chats(3));
    await openApp();
    mockSetBadgeCount.mockClear();
    mockListConversations.mockRejectedValue(new Error('Network request failed'));
    await appState('active');
    expect(mockSetBadgeCount).not.toHaveBeenCalled();
  });

  it('still shows friend requests when nothing else loads at sign-in', async () => {
    mockListConversations.mockRejectedValue(new Error('Network request failed'));
    mockActivityCount.mockRejectedValue(new Error('Network request failed'));
    mockPending = 2;
    expect(shown(await openApp())).toBe(2);
  });
});

describe('signing out', () => {
  it('stops listening, so the next account starts clean', async () => {
    const tree = await openApp();
    await act(async () => { tree.unmount(); });
    expect(mockRemoved.sort()).toEqual([activityTopic(), messagesTopic()].sort());

    mockListConversations.mockClear();
    requestBadgeRefresh();
    await appState('active');
    expect(mockListConversations).not.toHaveBeenCalled();
  });

  it("a re-count still running cannot write the old account's number on the icon", async () => {
    const tree = await openApp();
    let finish!: (value: unknown) => void;
    mockListConversations.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await act(async () => { requestBadgeRefresh(); });
    await act(async () => { tree.unmount(); });

    mockSetBadgeCount.mockClear();
    await act(async () => { finish(chats(7)); });
    await settle();
    expect(mockSetBadgeCount).not.toHaveBeenCalled();
  });
});
