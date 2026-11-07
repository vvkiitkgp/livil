/**
 * "Liked Indie Vibes" holds likes on UPLOADS. A repost of a Livil song carries a track too, so
 * filtering on the track let every liked repost in: one song once per reposter, and a count of
 * 33 where 19 were uploads (owner, 2026-11-07). The number and the list must use the same rule.
 */
let mockCalls: unknown[][] = [];
let mockResult: { data?: unknown[]; count?: number; error: { message: string } | null } = { error: null };

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'me' } }, error: null }) },
    from: (table: string) => {
      mockCalls.push(['from', table]);
      const chain: unknown = new Proxy({}, {
        get: (_t, method: string) =>
          method === 'then'
            ? (resolve: (r: unknown) => void) => resolve(mockResult)
            : (...args: unknown[]) => {
                mockCalls.push([method, ...args]);
                return chain;
              },
      });
      return chain;
    },
  },
}));

import { fetchLikedPosts, getLikedPostCount } from '../playlists';

const selectText = () => String(mockCalls.find(c => c[0] === 'select')?.[1]);

beforeEach(() => {
  mockCalls = [];
  mockResult = { error: null };
});

it('counts only likes on uploads', async () => {
  mockResult = { count: 19, error: null };
  await expect(getLikedPostCount()).resolves.toBe(19);
  expect(mockCalls).toContainEqual(['from', 'post_likes']);
  expect(selectText()).toContain('posts!inner');
  expect(mockCalls).toContainEqual(['eq', 'user_id', 'me']);
  expect(mockCalls).toContainEqual(['eq', 'posts.kind', 'upload']);
});

it('lists only likes on uploads, filtered in the query so reposts do not use up the limit', async () => {
  mockResult = {
    data: [{
      post_id: 'p-1',
      post: {
        id: 'p-1',
        track: {
          id: 't-1',
          title: 'Tum Se',
          media_kind: 'audio',
          audio_url: 'https://cdn/t-1.mp3',
          video_url: null,
          cover_art_url: null,
          thumbnail_url: null,
        },
        author: { id: 'u-1', display_name: 'Aravind Jakkani', username: 'aravind', avatar_url: null },
      },
    }],
    error: null,
  };

  const items = await fetchLikedPosts(30);

  expect(selectText()).toContain('post:posts!inner');
  expect(mockCalls).toContainEqual(['eq', 'post.kind', 'upload']);
  expect(mockCalls).toContainEqual(['limit', 30]);
  expect(items.map(i => [i.postId, i.title, i.artistName])).toEqual([['p-1', 'Tum Se', 'Aravind Jakkani']]);
});
