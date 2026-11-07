const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mockStore.get(k) ?? null,
    setItem: async (k: string, v: string) => { mockStore.set(k, v); },
  },
}));

import { getRecentReactions, noteRecentReaction, withRecent } from '../recentReactions';

beforeEach(() => mockStore.clear());

describe('withRecent', () => {
  it('puts the newest first, without a second copy', () => {
    expect(withRecent(['😂', '🔥'], '🔥')).toEqual(['🔥', '😂']);
  });

  it('keeps at most 24', () => {
    const many = Array.from({ length: 30 }, (_, i) => `e${i}`);
    expect(withRecent(many, 'new')).toHaveLength(24);
    expect(withRecent(many, 'new')[0]).toBe('new');
  });
});

it('remembers across reads', async () => {
  await noteRecentReaction('😂');
  await noteRecentReaction('🔥');
  await expect(getRecentReactions()).resolves.toEqual(['🔥', '😂']);
});

it('reads as empty when nothing or something unreadable is saved', async () => {
  await expect(getRecentReactions()).resolves.toEqual([]);
  mockStore.set('livil.recentReactions.v1', 'not json');
  await expect(getRecentReactions()).resolves.toEqual([]);
  mockStore.set('livil.recentReactions.v1', '{"a":1}');
  await expect(getRecentReactions()).resolves.toEqual([]);
});
