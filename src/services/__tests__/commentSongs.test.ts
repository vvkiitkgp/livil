/**
 * Songs in comments (migration 20261029000000). Two things are pinned here:
 *
 *  - The body always says what was shared. Apps that predate songs in comments read only
 *    `body`, so the song's label is its last line; this app strips exactly that line back
 *    off to draw the card instead, and shows the body whole once the song is gone.
 *  - The app works before the migration is applied: a missing song column makes the
 *    request retry without the song columns — never an empty comment sheet, never a
 *    comment that fails to post.
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
  composeCommentBody,
  createComment,
  fetchPostComments,
  songLabelFor,
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
const missingColumn = (code: string) => ({
  data: null,
  error: { code, message: code === '42703'
    ? 'column post_comments.song_post_id does not exist'
    : "Could not find the 'song_label' column of 'post_comments' in the schema cache" },
});

beforeEach(() => {
  __resetSongColumnsMissingForTest();
  mockCommentQueries.length = 0;
  mockInserts.length = 0;
  mockSelectResults = [];
  mockInsertResults = [];
});

describe('the label line', () => {
  it('names the song and its artist', () => {
    expect(songLabelFor('Kesariya', 'Arijit Singh')).toBe('🎵 Kesariya — Arijit Singh');
    expect(songLabelFor('Kesariya', '  ')).toBe('🎵 Kesariya');
    expect(songLabelFor('  ', null)).toBe('🎵 A song');
  });

  it('fits the column (200 characters at most)', () => {
    expect(songLabelFor('x'.repeat(300), 'y').length).toBe(200);
  });

  it('goes on the last line, or is the whole body when nothing was typed', () => {
    const label = '🎵 Kesariya — Arijit Singh';
    expect(composeCommentBody('  this one  ', label)).toBe(`this one\n${label}`);
    expect(composeCommentBody('   ', label)).toBe(label);
    expect(composeCommentBody(' just words ', null)).toBe('just words');
  });
});

describe('commentDisplayText', () => {
  const label = '🎵 Kesariya — Arijit Singh';
  const livil = { kind: 'livil' as const, postId: 'p9' };

  it('drops the label line where the card is drawn instead', () => {
    expect(commentDisplayText({ body: `this one\n${label}`, song: livil, songLabel: label })).toBe('this one');
    expect(commentDisplayText({ body: label, song: livil, songLabel: label })).toBe('');
  });

  it('keeps the whole body once the song is gone, so it still says what was shared', () => {
    expect(commentDisplayText({ body: `this one\n${label}`, song: null, songLabel: label })).toBe(`this one\n${label}`);
  });

  it('never cuts words that are not exactly the label', () => {
    expect(commentDisplayText({ body: 'edited by hand', song: livil, songLabel: label })).toBe('edited by hand');
  });
});

describe('fetchPostComments', () => {
  it('reads the song columns and maps each source', async () => {
    mockSelectResults = [{
      data: [
        row({ id: 'c1', song_post_id: 'p9', song_label: '🎵 Kesariya — Arijit Singh' }),
        row({ id: 'c2', song_spotify_track_id: '4uLU6hMCjMI75M1A2tKUQC', song_label: '🎵 Song — Artist' }),
        row({ id: 'c3' }),
      ],
      error: null,
    }];
    const nodes = await fetchPostComments('p1');
    expect(mockCommentQueries[0].select).toContain('song_post_id');
    expect(nodes.map(n => n.song)).toEqual([
      { kind: 'livil', postId: 'p9' },
      { kind: 'spotify', trackId: '4uLU6hMCjMI75M1A2tKUQC' },
      null,
    ]);
    expect(nodes[0].songLabel).toBe('🎵 Kesariya — Arijit Singh');
    expect(nodes[2].songLabel).toBeNull();
  });

  it('before the migration: retries without the song columns, and stays that way', async () => {
    mockSelectResults = [missingColumn('42703'), { data: [row()], error: null }, { data: [row()], error: null }];
    const nodes = await fetchPostComments('p1');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].song).toBeNull();
    expect(mockCommentQueries[1].select).not.toContain('song_');
    await fetchPostComments('p1');
    expect(mockCommentQueries).toHaveLength(3);
    expect(mockCommentQueries[2].select).not.toContain('song_');
  });

  it('any other failure is still an error', async () => {
    mockSelectResults = [{ data: null, error: { code: '42501', message: 'permission denied' } }];
    await expect(fetchPostComments('p1')).rejects.toThrow('permission denied');
    expect(mockCommentQueries).toHaveLength(1);
  });
});

describe('createComment with a song', () => {
  const song = { song: { kind: 'livil' as const, postId: 'p9' }, label: '🎵 Kesariya — Arijit Singh' };

  it('stores the song and writes its label into the body', async () => {
    mockInsertResults = [{ data: row({ body: `this one\n${song.label}`, song_post_id: 'p9', song_label: song.label }), error: null }];
    const node = await createComment('p1', ' this one ', null, song);
    expect(mockInserts[0].row).toEqual({
      post_id: 'p1',
      author_id: 'me',
      body: `this one\n${song.label}`,
      parent_comment_id: null,
      song_post_id: 'p9',
      song_spotify_track_id: null,
      song_label: song.label,
    });
    expect(node.song).toEqual({ kind: 'livil', postId: 'p9' });
  });

  it('posts a song with no words', async () => {
    mockInsertResults = [{ data: row({ body: song.label }), error: null }];
    await createComment('p1', '', null, song);
    expect(mockInserts[0].row.body).toBe(song.label);
  });

  it('a Spotify song is stored by its track id', async () => {
    mockInsertResults = [{ data: row(), error: null }];
    await createComment('p1', '', null, {
      song: { kind: 'spotify', trackId: '4uLU6hMCjMI75M1A2tKUQC' },
      label: '🎵 Song — Artist',
    });
    expect(mockInserts[0].row).toMatchObject({ song_post_id: null, song_spotify_track_id: '4uLU6hMCjMI75M1A2tKUQC' });
  });

  it('before the migration: posts it as its body, label line and all', async () => {
    mockInsertResults = [missingColumn('PGRST204'), { data: row({ body: `this one\n${song.label}` }), error: null }];
    const node = await createComment('p1', 'this one', null, song);
    expect(mockInserts).toHaveLength(2);
    expect(mockInserts[1].row).toEqual({
      post_id: 'p1',
      author_id: 'me',
      body: `this one\n${song.label}`,
      parent_comment_id: null,
    });
    expect(mockInserts[1].select).not.toContain('song_');
    // No song column came back, so this app shows the body whole — the label says it.
    expect(node.song).toBeNull();
    expect(commentDisplayText(node)).toBe(`this one\n${song.label}`);
  });

  it('a comment without a song sends exactly what it always did', async () => {
    mockInsertResults = [{ data: row(), error: null }];
    await createComment('p1', ' love this ');
    expect(mockInserts[0].row).toEqual({
      post_id: 'p1',
      author_id: 'me',
      body: 'love this',
      parent_comment_id: null,
    });
  });

  it('nothing typed and no song is still refused', async () => {
    await expect(createComment('p1', '   ')).rejects.toThrow('Comment cannot be empty.');
  });
});
