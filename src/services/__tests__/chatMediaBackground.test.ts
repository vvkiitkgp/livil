/**
 * Disappearing chat photos (PROP-0011): no copy stays on the phone while Livil is in the
 * background. Leaving the app deletes every downloaded photo; coming back fetches the ones
 * still in their 20 minutes again, so they keep opening instantly while the app is in use.
 */

const mockInvoke = jest.fn();
const mockRemove = jest.fn(async (_rel: string) => true);

jest.mock('../../../lib/supabase', () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) } },
}));
jest.mock('../messages', () => ({ sendMessage: jest.fn() }));
jest.mock('../uploads', () => ({ uploadChatMediaObject: jest.fn() }));
jest.mock('../studioFiles', () => ({
  studioFiles: {
    available: true,
    root: async () => '/phone',
    writeBase64: async () => {},
    writeText: async () => {},
    readText: async () => '{}',
    listDirs: async () => [],
    remove: (rel: string) => mockRemove(rel),
  },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {} },
}));

import { AppState } from 'react-native';
import {
  localChatMedia,
  pinChatMedia,
  prefetchChatMedia,
  startChatMediaHousekeeping,
} from '../chatMedia';
import { chatMediaMetadata } from '../../utils/chatMedia';
import type { ChatMessage } from '../messages';

const CONV = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';

function photoFromRiya(id: string): ChatMessage {
  return {
    id,
    conversationId: CONV,
    senderId: 'riya',
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
    senderUsername: 'riya',
    senderDisplayName: 'Riya',
    senderAvatarUrl: null,
    reactions: [],
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function setState(state: 'active' | 'background'): void {
  (AppState as { currentState: unknown }).currentState = state;
}

let onChange: (next: string) => void;

beforeAll(() => {
  setState('active');
  startChatMediaHousekeeping();
  const calls = (AppState.addEventListener as jest.Mock).mock.calls;
  onChange = calls[calls.length - 1][1];
});

beforeEach(() => {
  jest.clearAllMocks();
  setState('active');
  mockInvoke.mockImplementation(async () => ({
    data: {
      url: 'https://storage.example/riya.jpg',
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      now: new Date().toISOString(),
    },
    error: null,
  }));
  (global as any).fetch = jest.fn(async () => ({ ok: true, blob: async () => ({}) }));
  (global as any).FileReader = class {
    result: string | null = null;
    onloadend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL() {
      this.result = 'data:image/jpeg;base64,/9j/AAAA';
      this.onloadend?.();
    }
  };
});

afterEach(() => {
  // Leave nothing held (and no expiry timer running) for the next test.
  setState('background');
  onChange('background');
});

function leave(): void {
  setState('background');
  onChange('background');
}

async function comeBack(): Promise<void> {
  setState('active');
  onChange('active');
  for (let i = 0; i < 5; i++) { await flush(); }
}

it('deletes every downloaded photo when Livil is left, and fetches the live ones again on return', async () => {
  const msg = photoFromRiya('11111111-2222-4333-8444-555555555555');
  expect(await prefetchChatMedia(msg)).toBe(`file:///phone/chat-media/${msg.id}/media.jpg`);
  expect(localChatMedia(msg.id)).not.toBeNull();

  leave();
  expect(localChatMedia(msg.id)).toBeNull();
  expect(mockRemove).toHaveBeenCalledWith(`chat-media/${msg.id}`);

  // Nothing is fetched while away.
  mockInvoke.mockClear();
  expect(await prefetchChatMedia(msg)).toBeNull();
  expect(mockInvoke).not.toHaveBeenCalled();

  await comeBack();
  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect(localChatMedia(msg.id)).toBe(`file:///phone/chat-media/${msg.id}/media.jpg`);
});

it('deletes a download that finishes after Livil was left, instead of keeping it', async () => {
  const msg = photoFromRiya('22222222-3333-4444-8555-666666666666');
  let answer: (v: unknown) => void = () => {};
  mockInvoke.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
  const pending = prefetchChatMedia(msg);

  leave();
  answer({
    data: { url: 'https://storage.example/late.jpg', expires_at: new Date(Date.now() + 15 * 60_000).toISOString() },
    error: null,
  });

  expect(await pending).toBeNull();
  expect(localChatMedia(msg.id)).toBeNull();
  expect(mockRemove).toHaveBeenCalledWith(`chat-media/${msg.id}`);
});

it('keeps a photo being saved through the wipe, and deletes it once released while still away', async () => {
  const msg = photoFromRiya('33333333-4444-4555-8666-777777777777');
  await prefetchChatMedia(msg);

  // Android 7–9: the storage-permission dialog reports the app as in the background.
  const release = pinChatMedia(msg.id);
  leave();
  expect(localChatMedia(msg.id)).not.toBeNull();

  release();
  expect(localChatMedia(msg.id)).toBeNull();
});

it('keeps a photo being saved when the dialog closes first', async () => {
  const msg = photoFromRiya('44444444-5555-4666-8777-888888888888');
  await prefetchChatMedia(msg);

  const release = pinChatMedia(msg.id);
  leave();
  setState('active');
  onChange('active');
  release();
  expect(localChatMedia(msg.id)).not.toBeNull();
});
