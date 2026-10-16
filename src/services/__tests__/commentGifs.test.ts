/**
 * GIFs in comments (migration 20261030000000, ADR-0031). Pinned here:
 *
 *  - The body always says a GIF was shared. Apps that predate GIFs read only `body`, so
 *    the fixed label '🎞 GIF' is its last line; this app strips exactly that line back off
 *    and draws the GIF instead.
 *  - Only the GIF's id, provider and size are stored — never a media URL.
 *  - One attachment per comment: a song or a GIF, never both.
 *  - Before the migration is applied, comment sheets still load, and a GIF comment is
 *    refused with a message rather than posted as a bare '🎞 GIF'.
 */
jest.mock('../activity', () => ({ notifyPostActivity: jest.fn(async () => undefined) }));

type Result = { data: unknown; error: { code?: string; message: string } | null };

const mockCommentQueries: Array<{ select: string }> = [];
const mockInserts: Array<{ row: Record<string, unknown>; select: string }> = [];
let mockSelectResults: Result[] = [];
let mockInsertResults: Result[] = [];

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'me' } }, error: null }) },
    functions: { invoke: async () => ({ data: null, error: { message: 'not used here' } }) },
    from: (table: string) => {
      if (table === 'post_comment_likes') {
        const likes = { select: () => likes, eq: () => likes, in: async () => ({ data: [], error: null }) };
        return likes;
      }
      return {
        select: (cols: string) => {
          mockCommentQueries.push({ select: cols });
          const chain = {
            eq: () => chain,
            order: () => chain,
            limit: async () => mockSelectResults.shift() ?? { data: [], error: null },
          };
          return chain;
        },
        insert: (row: Record<string, unknown>) => ({
          select: (cols: string) => ({
            single: async () => {
              mockInserts.push({ row, select: cols });
              return mockInsertResults.shift() ?? { data: null, error: { message: 'no result queued' } };
            },
          }),
        }),
      };
    },
  },
}));

import {
  __resetSongColumnsMissingForTest,
  commentDisplayText,
  createComment,
  fetchPostComments,
  GIF_LABEL,
  GIFS_NOT_READY_MESSAGE,
  type CommentGif,
} from '../comments';

const author = { id: 'me', username: 'just_vvk', display_name: 'Vamsi', avatar_url: null };
const row = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  post_id: 'p1',
  author_id: 'me',
  body: 'love this',
  parent_comment_id: null,
  created_at: '2026-10-16T09:00:00Z',
  like_count: 0,
  author,
  ...over,
});
const gif: CommentGif = { provider: 'giphy', id: '3o7TKSjRrfIPjeiVyM', width: 200, height: 150 };
const gifColumns = {
  gif_provider: 'giphy',
  gif_id: '3o7TKSjRrfIPjeiVyM',
  gif_width: 200,
  gif_height: 150,
};

beforeEach(() => {
  __resetSongColumnsMissingForTest();
  mockCommentQueries.length = 0;
  mockInserts.length = 0;
  mockSelectResults = [];
  mockInsertResults = [];
});

describe('the GIF label line', () => {
  it('is fixed — comments already posted end with exactly this line', () => {
    expect(GIF_LABEL).toBe('🎞 GIF');
  });

  it('is stripped where the GIF is drawn instead', () => {
    expect(commentDisplayText({ body: `haha\n${GIF_LABEL}`, song: null, songLabel: null, gif })).toBe('haha');
    expect(commentDisplayText({ body: GIF_LABEL, song: null, songLabel: null, gif })).toBe('');
  });

  it('is kept when there is no GIF to draw', () => {
    expect(commentDisplayText({ body: `haha\n${GIF_LABEL}`, song: null, songLabel: null, gif: null }))
      .toBe(`haha\n${GIF_LABEL}`);
  });

  it('never cuts words that are not exactly the label', () => {
    expect(commentDisplayText({ body: 'my fav GIF', song: null, songLabel: null, gif })).toBe('my fav GIF');
  });
});

describe('fetchPostComments', () => {
  it('reads the GIF columns', async () => {
    mockSelectResults = [{
      data: [row({ id: 'c1', body: GIF_LABEL, ...gifColumns }), row({ id: 'c2' })],
      error: null,
    }];
    const nodes = await fetchPostComments('p1');
    expect(mockCommentQueries[0].select).toContain('gif_id');
    expect(nodes.map(n => n.gif)).toEqual([gif, null]);
  });

  it('ignores a GIF it cannot draw (unknown provider, bad id, no size)', async () => {
    mockSelectResults = [{
      data: [
        row({ id: 'c1', ...gifColumns, gif_provider: 'tenor' }),
        row({ id: 'c2', ...gifColumns, gif_id: 'bad id' }),
        row({ id: 'c3', ...gifColumns, gif_width: null }),
      ],
      error: null,
    }];
    const nodes = await fetchPostComments('p1');
    expect(nodes.map(n => n.gif)).toEqual([null, null, null]);
  });

  it('before the GIF migration: retries without the GIF columns, keeps the song ones', async () => {
    mockSelectResults = [
      { data: null, error: { code: '42703', message: 'column post_comments.gif_provider does not exist' } },
      { data: [row()], error: null },
    ];
    const nodes = await fetchPostComments('p1');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].gif).toBeNull();
    expect(mockCommentQueries[1].select).not.toContain('gif_');
    expect(mockCommentQueries[1].select).toContain('song_post_id');
  });

  it('before BOTH migrations: two retries, then a plain select', async () => {
    mockSelectResults = [
      { data: null, error: { code: '42703', message: 'column post_comments.song_post_id does not exist' } },
      { data: null, error: { code: '42703', message: 'column post_comments.gif_provider does not exist' } },
      { data: [row()], error: null },
    ];
    const nodes = await fetchPostComments('p1');
    expect(nodes).toHaveLength(1);
    expect(mockCommentQueries).toHaveLength(3);
    expect(mockCommentQueries[2].select).not.toMatch(/song_|gif_/);
  });
});

describe('createComment with a GIF', () => {
  it('stores the id, provider and size — never a URL — and writes the label into the body', async () => {
    mockInsertResults = [{ data: row({ body: `haha\n${GIF_LABEL}`, ...gifColumns }), error: null }];
    const node = await createComment('p1', ' haha ', null, null, gif);
    expect(mockInserts[0].row).toEqual({
      post_id: 'p1',
      author_id: 'me',
      body: `haha\n${GIF_LABEL}`,
      parent_comment_id: null,
      ...gifColumns,
    });
    expect(node.gif).toEqual(gif);
    expect(commentDisplayText(node)).toBe('haha');
  });

  it('posts a GIF with no words', async () => {
    mockInsertResults = [{ data: row({ body: GIF_LABEL, ...gifColumns }), error: null }];
    await createComment('p1', '   ', null, null, gif);
    expect(mockInserts[0].row.body).toBe(GIF_LABEL);
  });

  it('refuses a song and a GIF together', async () => {
    const song = { song: { kind: 'livil' as const, postId: 'p9' }, label: '🎵 Kesariya — Arijit Singh' };
    await expect(createComment('p1', 'both', null, song, gif)).rejects.toThrow('a song or a GIF, not both');
    expect(mockInserts).toHaveLength(0);
  });

  it('before the GIF migration: refused with a message, never posted as a bare label', async () => {
    mockInsertResults = [{
      data: null,
      error: { code: 'PGRST204', message: "Could not find the 'gif_height' column of 'post_comments' in the schema cache" },
    }];
    await expect(createComment('p1', 'haha', null, null, gif)).rejects.toThrow(GIFS_NOT_READY_MESSAGE);
    expect(mockInserts).toHaveLength(1);
    // And from then on without even trying.
    await expect(createComment('p1', 'haha', null, null, gif)).rejects.toThrow(GIFS_NOT_READY_MESSAGE);
    expect(mockInserts).toHaveLength(1);
  });

  it('before the GIF migration: a plain comment still posts', async () => {
    mockInsertResults = [
      { data: null, error: { code: '42703', message: 'column post_comments.gif_provider does not exist' } },
      { data: row(), error: null },
    ];
    await createComment('p1', 'love this');
    expect(mockInserts).toHaveLength(2);
    expect(mockInserts[1].select).not.toContain('gif_');
    expect(mockInserts[1].row).toEqual({ post_id: 'p1', author_id: 'me', body: 'love this', parent_comment_id: null });
  });
});
