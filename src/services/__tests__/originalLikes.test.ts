/**
 * A repost carries its upload's like count for the cover, on both ways posts load (the feed's
 * RPC and everything else), and a failed lookup never costs the feed.
 */
jest.mock('../activity', () => ({ notifyPostActivity: jest.fn(), notifyMentions: jest.fn() }));
jest.mock('../pushDispatch', () => ({ sendPush: jest.fn() }));
jest.mock('../spotify', () => ({ fetchSpotifyTrackIds: jest.fn(async () => new Map()) }));

const AUTHOR = { id: 'u-1', username: 'sree', display_name: 'Sree Charan', avatar_url: null };
const TRACK = {
  id: 't-1',
  title: 'Anxiety x No Entry',
  media_kind: 'audio',
  audio_url: 'https://cdn/t-1.mp3',
  video_url: null,
  cover_art_url: null,
  thumbnail_url: null,
  duration_seconds: 74,
};
const row = (id: string, kind: 'upload' | 'repost', originalPostId: string | null) => ({
  id,
  kind,
  caption: null,
  created_at: '2026-11-07T00:00:00Z',
  views_count: 0,
  likes_count: 3,
  reposts_count: 0,
  comments_count: 0,
  author: AUTHOR,
  track: TRACK,
  original_post_id: originalPostId,
  original_author: originalPostId ? AUTHOR : null,
  viewer_has_liked: false,
  clip_start_sec: null,
  clip_end_sec: null,
});

let mockRows: unknown[] = [];
let mockFeedRows: unknown[] = [];
let mockLikes: { data: unknown[] | null; error: { message: string } | null } = { data: [], error: null };
let mockLikeLookups = 0;

function mockResultFor(table: string, columns: string) {
  if (table === 'post_likes') { return { data: [], error: null }; }
  if (columns === 'id, likes_count') {
    mockLikeLookups += 1;
    return mockLikes;
  }
  if (columns.includes('kind')) { return { data: mockRows, error: null }; }
  return { data: [{ id: 'upload-1', author: AUTHOR }], error: null };
}

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'me' } }, error: null }) },
    rpc: async () => ({ data: mockFeedRows, error: null }),
    from: (table: string) => {
      let columns = '';
      const chain: unknown = new Proxy({}, {
        get: (_t, method: string) => {
          if (method === 'then') {
            return (resolve: (r: unknown) => void) => resolve(mockResultFor(table, columns));
          }
          return (...args: unknown[]) => {
            if (method === 'select') { columns = String(args[0]).trim(); }
            return chain;
          };
        },
      });
      return chain;
    },
  },
}));

import { feedPostToNowPlaying, fetchHomeFeedPage, fetchPostsByIds } from '../posts';

beforeEach(() => {
  mockRows = [];
  mockFeedRows = [];
  mockLikes = { data: [{ id: 'upload-1', likes_count: 5 }], error: null };
  mockLikeLookups = 0;
});

it('adds the upload\'s likes to a repost and leaves the repost\'s own count alone', async () => {
  mockRows = [row('repost-1', 'repost', 'upload-1')];
  const [post] = await fetchPostsByIds(['repost-1']);
  expect(post!.originalLikesCount).toBe(5);
  expect(post!.likesCount).toBe(3);
});

it('does the same on the home feed', async () => {
  mockFeedRows = [{ post: row('repost-1', 'repost', 'upload-1'), feed_bucket: 0, sort_key: 0, post_id: 'repost-1' }];
  const { posts } = await fetchHomeFeedPage({ limit: 12 });
  expect(posts[0]!.originalLikesCount).toBe(5);
});

it('looks nothing up for uploads or a repost whose original was deleted', async () => {
  mockRows = [row('upload-2', 'upload', null), row('repost-2', 'repost', null)];
  const posts = await fetchPostsByIds(['upload-2', 'repost-2']);
  expect(mockLikeLookups).toBe(0);
  expect(posts.map(p => p.originalLikesCount)).toEqual([undefined, undefined]);
});

it('keeps the feed when the lookup fails, with no number on the cover', async () => {
  mockLikes = { data: null, error: { message: 'network' } };
  mockFeedRows = [{ post: row('repost-1', 'repost', 'upload-1'), feed_bucket: 0, sort_key: 0, post_id: 'repost-1' }];
  const { posts } = await fetchHomeFeedPage({ limit: 12 });
  expect(posts).toHaveLength(1);
  expect(posts[0]!.originalLikesCount).toBeUndefined();
});

it('hands the upload\'s count to the player, so it never starts on the repost\'s', async () => {
  mockRows = [row('repost-1', 'repost', 'upload-1')];
  const [post] = await fetchPostsByIds(['repost-1']);
  expect(feedPostToNowPlaying(post!).originalLikesCount).toBe(5);
});
