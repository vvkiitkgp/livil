/**
 * Disappearing chat photos (PROP-0011): saving someone's photo to your phone tells the chat.
 * In a DM the sender hears it; in a group every other member does — the sender as "your
 * photo", everyone else as "@arjun's photo". Sent as a chat `message` push, so every shipped
 * app shows it and opens the chat.
 */

const mockSendPush = jest.fn(async (_args: unknown) => ({ ok: true }));
let mockConversation: { kind: 'dm' | 'group'; name: string | null } | null = null;
let mockOthers: Array<{ user_id: string }> = [];

jest.mock('../pushDispatch', () => ({ sendPush: (args: unknown) => mockSendPush(args) }));
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'conversations') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mockConversation, error: null }) }) }) };
      }
      return { select: () => ({ eq: () => ({ neq: async () => ({ data: mockOthers, error: null }) }) }) };
    },
    functions: { invoke: jest.fn() },
  },
}));
jest.mock('../messages', () => ({ sendMessage: jest.fn() }));
jest.mock('../uploads', () => ({ uploadChatMediaObject: jest.fn() }));
jest.mock('../studioFiles', () => ({ studioFiles: { available: false } }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {} },
}));

import { notifyChatMediaSaved } from '../chatMedia';
import { chatMediaMetadata } from '../../utils/chatMedia';
import type { ChatMessage } from '../messages';

const CONV = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';

function photoFromArjun(): ChatMessage {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    conversationId: CONV,
    senderId: 'arjun',
    kind: 'text',
    body: '📷 Photo · Update Livil to view',
    metadata: chatMediaMetadata({
      type: 'photo',
      object: `${CONV}/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.jpg`,
      mime: 'image/jpeg',
      w: 1200,
      h: 1600,
      bytes: 240_000,
    }),
    replyToId: null,
    createdAt: new Date().toISOString(),
    deletedAt: null,
    senderUsername: 'arjun',
    senderDisplayName: 'Arjun',
    senderAvatarUrl: null,
    reactions: [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('tells the sender of a DM photo that Riya saved it, in a chat push that opens the DM', async () => {
  mockConversation = { kind: 'dm', name: null };
  mockOthers = [{ user_id: 'arjun' }];

  await notifyChatMediaSaved(photoFromArjun(), 'riya', 'Riya');

  expect(mockSendPush).toHaveBeenCalledTimes(1);
  expect(mockSendPush).toHaveBeenCalledWith({
    recipientUserId: 'arjun',
    kind: 'message',
    body: '📸 Saved your photo',
    data: { route: 'Conversation', params: { conversationId: CONV, title: 'Riya' } },
  });
});

it('tells everyone else in a group: the sender "your photo", the rest "@arjun\'s photo"', async () => {
  mockConversation = { kind: 'group', name: 'Weekend crew' };
  mockOthers = [{ user_id: 'arjun' }, { user_id: 'sam' }];

  await notifyChatMediaSaved(photoFromArjun(), 'riya', 'Riya');

  const sent = mockSendPush.mock.calls.map(([a]) => a as { recipientUserId: string; body: string; data: unknown });
  expect(sent).toHaveLength(2);
  expect(sent.find(p => p.recipientUserId === 'arjun')?.body).toBe('📸 Saved your photo');
  expect(sent.find(p => p.recipientUserId === 'sam')?.body).toBe("📸 Saved @arjun's photo");
  for (const p of sent) {
    expect(p.data).toEqual({ route: 'Conversation', params: { conversationId: CONV, title: 'Weekend crew' } });
  }
});

it('sends nothing for a message that is not a photo or video', async () => {
  mockConversation = { kind: 'dm', name: null };
  mockOthers = [{ user_id: 'arjun' }];

  await notifyChatMediaSaved({ ...photoFromArjun(), metadata: null }, 'riya', 'Riya');

  expect(mockSendPush).not.toHaveBeenCalled();
});
