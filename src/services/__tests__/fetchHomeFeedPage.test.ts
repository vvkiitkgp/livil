/**
 * The home feed's single round-trip.
 *
 * WHY THIS FILE EXISTS. `fetchHomeFeedPage` shipped with `const rpc = supabase.rpc`,
 * which detaches the method from the client. supabase-js's rpc() uses `this`, so the
 * detached call threw "Cannot read property 'rpc' of undefined" and the Home tab showed
 * "Couldn't load the feed" for every user. Nothing caught it: this function had no test,
 * and the neighbouring impressions mock was an arrow function that worked detached.
 *
 * So the mock below is a METHOD that checks its receiver, exactly like the real client.
 * A mock that cannot fail the way the real thing fails is not a test.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@react-native-documents/picker', () => ({ keepLocalCopy: jest.fn() }));
jest.mock('react-native-audio-api', () => ({ decodeAudioData: jest.fn() }));

const mockRpc = jest.fn();
jest.mock('../../../lib/supabase', () => {
  const client = {
    rpc(this: unknown, fn: string, args: Record<string, unknown>) {
      if (this !== client) {
        throw new TypeError("Cannot read property 'rpc' of undefined");
      }
      return mockRpc(fn, args);
    },
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
    from: jest.fn(),
  };
  return { supabase: client };
});

import { fetchHomeFeedPage, newHomeFeedSession } from '../posts';

const row = (id: string, over: Record<string, unknown> = {}) => ({
  feed_bucket: 1,
  sort_key: 3.5,
  post_id: id,
  post: {
    id,
    kind: 'upload',
    caption: null,
    created_at: '2026-08-16T10:00:00Z',
    views_count: 0,
    likes_count: 0,
    reposts_count: 0,
    comments_count: 0,
    author_id: 'a1',
    original_post_id: null,
    clip_start_sec: null,
    clip_end_sec: null,
    track: {
      id: 't1', title: 'Gehra', media_kind: 'audio',
      audio_url: 'https://example.invalid/g.mp3', video_url: null,
      cover_art_url: null, thumbnail_url: null, duration_seconds: 180,
    },
    author: { id: 'a1', username: 'riya', display_name: 'Riya', avatar_url: null },
    original_author: null,
    viewer_has_liked: false,
    ...over,
  },
});

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: [], error: null });
});

test('the RPC is called with the method still attached to the client', async () => {
  // THE REGRESSION. Detaching rpc() makes this reject before any assertion below runs.
  await expect(fetchHomeFeedPage({ limit: 12 })).resolves.toBeDefined();
  expect(mockRpc).toHaveBeenCalledWith('fetch_home_feed', expect.any(Object));
});

test('the session travels with every page, so the ranking stays put mid-scroll', async () => {
  const session = newHomeFeedSession();
  await fetchHomeFeedPage({ limit: 12, session });

  expect(mockRpc.mock.calls[0][1]).toMatchObject({
    p_limit: 12,
    p_seed: session.seed,
    p_session_started_at: session.startedAt,
  });
});

test('a fresh session is a new seed — this is what makes refresh re-rank', () => {
  const seeds = new Set(Array.from({ length: 50 }, () => newHomeFeedSession().seed));
  expect(seeds.size).toBeGreaterThan(40);
  // Seed 0 is reserved by the RPC to mean "no jitter", so a session must never roll it.
  expect(seeds.has(0)).toBe(false);
});

test('the cursor is sent on later pages and omitted on the first', async () => {
  await fetchHomeFeedPage({ limit: 12 });
  expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_cursor_id: undefined });

  await fetchHomeFeedPage({ limit: 12, cursor: { bucket: 1, sortKey: 2.25, id: 'p9' } });
  expect(mockRpc.mock.calls[1][1]).toMatchObject({
    p_cursor_bucket: 1, p_cursor_sort_key: 2.25, p_cursor_id: 'p9',
  });
});

test('rows map to feed posts', async () => {
  mockRpc.mockResolvedValue({ data: [row('p1')], error: null });

  const { posts } = await fetchHomeFeedPage({ limit: 12 });

  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    id: 'p1',
    track: { title: 'Gehra', mediaKind: 'audio' },
    author: { username: 'riya' },
  });
});

test('a full page hands back a cursor, a short page ends the feed', async () => {
  mockRpc.mockResolvedValue({ data: [row('p1'), row('p2')], error: null });
  const full = await fetchHomeFeedPage({ limit: 2 });
  expect(full.nextCursor).toMatchObject({ id: 'p2' });

  mockRpc.mockResolvedValue({ data: [row('p1')], error: null });
  const short = await fetchHomeFeedPage({ limit: 2 });
  expect(short.nextCursor).toBeNull();
});

test('a database error surfaces rather than rendering an empty feed', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
  await expect(fetchHomeFeedPage({ limit: 12 })).rejects.toThrow('permission denied');
});
