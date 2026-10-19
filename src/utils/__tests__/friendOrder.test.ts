import { orderByRecentChat } from '../friendOrder';

// listFriends hands them over alphabetically.
const friends = [{ id: 'arjun' }, { id: 'kabir' }, { id: 'meera' }, { id: 'riya' }, { id: 'sam' }];
const ids = (list: { id: string }[]) => list.map(f => f.id);

it('puts the most recent chat first, like the inbox', () => {
  const chats = [
    { kind: 'dm', otherUserId: 'sam', lastMessageAt: '2026-10-19T08:00:00Z' },
    { kind: 'dm', otherUserId: 'riya', lastMessageAt: '2026-10-19T12:30:00Z' },
    { kind: 'dm', otherUserId: 'kabir', lastMessageAt: '2026-10-01T09:00:00Z' },
  ];
  expect(ids(orderByRecentChat(friends, chats))).toEqual(['riya', 'sam', 'kabir', 'arjun', 'meera']);
});

it('keeps friends with no messages in their incoming order, after the chats', () => {
  const chats = [
    { kind: 'dm', otherUserId: 'meera', lastMessageAt: '2026-10-19T08:00:00Z' },
    // A DM opened on friend-accept with nothing sent yet.
    { kind: 'dm', otherUserId: 'kabir', lastMessageAt: null },
  ];
  expect(ids(orderByRecentChat(friends, chats))).toEqual(['meera', 'arjun', 'kabir', 'riya', 'sam']);
});

it('ignores group chats and unparseable times', () => {
  const chats = [
    { kind: 'group', otherUserId: null, lastMessageAt: '2026-10-19T12:00:00Z' },
    { kind: 'group', otherUserId: 'sam', lastMessageAt: '2026-10-19T12:00:00Z' },
    { kind: 'dm', otherUserId: 'riya', lastMessageAt: 'not a date' },
  ];
  expect(ids(orderByRecentChat(friends, chats))).toEqual(ids(friends));
});

it('falls back to the incoming order with no chats at all', () => {
  expect(ids(orderByRecentChat(friends, []))).toEqual(ids(friends));
});
