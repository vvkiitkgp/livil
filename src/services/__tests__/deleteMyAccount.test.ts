/**
 * The property under test is sequence, not queries: storage must be emptied
 * while a session still exists, because the RPC removes the auth user and
 * nothing can reach those files afterwards. See kb/debt/proposals/0008.
 */

type Entry = { name: string; id: string | null };

// Everything the jest.mock factory closes over must be `mock`-prefixed, or
// babel-plugin-jest-hoist rejects the file at transform time.
const mockEnv = {
  calls: [] as string[],
  bucket: '',
  listResponses: new Map<string, Entry[]>(),
  listError: null as string | null,
  removeError: null as string | null,
  removeShortBy: 0,
  rpcError: null as string | null,
  userError: null as string | null,
};

const mockList = jest.fn(async (prefix: string, opts: { limit: number; offset: number }) => {
  mockEnv.calls.push(`list:${mockEnv.bucket}:${prefix}:${opts.offset}`);
  if (mockEnv.listError) { return { data: null, error: { message: mockEnv.listError } }; }
  const all = mockEnv.listResponses.get(`${mockEnv.bucket}/${prefix}`) ?? [];
  return { data: all.slice(opts.offset, opts.offset + opts.limit), error: null };
});

const mockRemove = jest.fn(async (paths: string[]) => {
  mockEnv.calls.push(`remove:${mockEnv.bucket}:${paths.join(',')}`);
  if (mockEnv.removeError) { return { data: null, error: { message: mockEnv.removeError } }; }
  const kept = paths.slice(0, paths.length - mockEnv.removeShortBy);
  return { data: kept.map(p => ({ name: p })), error: null };
});

// Both are native modules imported at module scope by the service graph.
jest.mock('react-native-image-crop-picker', () => ({ openPicker: jest.fn(), openCamera: jest.fn() }));
jest.mock('@react-native-documents/picker', () => ({ keepLocalCopy: jest.fn() }));

jest.mock('../../../lib/supabase', () => ({
  SUPABASE_URL: 'https://example.test',
  SUPABASE_ANON_KEY: 'anon',
  supabase: {
    auth: {
      getUser: jest.fn(async () => {
        mockEnv.calls.push('getUser');
        return mockEnv.userError
          ? { data: { user: null }, error: { message: mockEnv.userError } }
          : { data: { user: { id: 'me' } }, error: null };
      }),
      signOut: jest.fn(async () => {
        mockEnv.calls.push('signOut');
        return { error: null };
      }),
    },
    rpc: jest.fn(async (name: string) => {
      mockEnv.calls.push(`rpc:${name}`);
      return { data: null, error: mockEnv.rpcError ? { message: mockEnv.rpcError } : null };
    }),
    storage: {
      from: (bucket: string) => {
        mockEnv.bucket = bucket;
        return { list: mockList, remove: mockRemove };
      },
    },
  },
}));

import { deleteMyAccount } from '../profileService';

/** Only file entries carry an id; folders come back with id: null. */
const file = (name: string): Entry => ({ name, id: `id-${name}` });
const folder = (name: string): Entry => ({ name, id: null });

const calls = () => mockEnv.calls;
const firstIndexMatching = (re: RegExp) => mockEnv.calls.findIndex(c => re.test(c));

beforeEach(() => {
  mockEnv.calls.length = 0;
  mockEnv.bucket = '';
  mockEnv.listResponses.clear();
  mockEnv.listError = null;
  mockEnv.removeError = null;
  mockEnv.removeShortBy = 0;
  mockEnv.rpcError = null;
  mockEnv.userError = null;
  mockList.mockClear();
  mockRemove.mockClear();
});

describe('deleteMyAccount — ordering', () => {
  beforeEach(() => {
    mockEnv.listResponses.set('avatars/me', [file('avatar_1.jpg')]);
    mockEnv.listResponses.set('tracks-media/me', [folder('t1')]);
    mockEnv.listResponses.set('tracks-media/me/t1', [file('audio.mp3')]);
  });

  it('empties storage before calling the RPC', async () => {
    await deleteMyAccount();
    const lastRemove = calls().map(c => /^remove:/.test(c)).lastIndexOf(true);
    const rpc = firstIndexMatching(/^rpc:delete_my_account$/);
    expect(lastRemove).toBeGreaterThanOrEqual(0);
    expect(rpc).toBeGreaterThan(lastRemove);
  });

  it('signs out only after the RPC has succeeded', async () => {
    await deleteMyAccount();
    expect(firstIndexMatching(/^signOut$/))
      .toBeGreaterThan(firstIndexMatching(/^rpc:delete_my_account$/));
  });

  it('removes files from both buckets', async () => {
    await deleteMyAccount();
    expect(calls()).toContain('remove:avatars:me/avatar_1.jpg');
    expect(calls()).toContain('remove:tracks-media:me/t1/audio.mp3');
  });
});

describe('deleteMyAccount — a storage failure aborts', () => {
  it('does not call the RPC when listing fails', async () => {
    mockEnv.listError = 'network down';
    await expect(deleteMyAccount()).rejects.toThrow(/network down/);
    expect(calls().some(c => c.startsWith('rpc:'))).toBe(false);
    expect(calls()).not.toContain('signOut');
  });

  it('does not call the RPC when removal errors', async () => {
    mockEnv.listResponses.set('avatars/me', [file('avatar_1.jpg')]);
    mockEnv.removeError = 'permission denied';
    await expect(deleteMyAccount()).rejects.toThrow(/permission denied/);
    expect(calls().some(c => c.startsWith('rpc:'))).toBe(false);
    expect(calls()).not.toContain('signOut');
  });

  it('does not call the RPC when removal silently drops files', async () => {
    mockEnv.listResponses.set('avatars/me', [file('a.jpg'), file('b.jpg')]);
    mockEnv.removeShortBy = 1;
    await expect(deleteMyAccount()).rejects.toThrow(/Only some of your files/);
    expect(calls().some(c => c.startsWith('rpc:'))).toBe(false);
  });

  it('leaves the second bucket untouched when the first fails', async () => {
    mockEnv.listResponses.set('avatars/me', [file('a.jpg')]);
    mockEnv.listResponses.set('tracks-media/me', [folder('t1')]);
    mockEnv.listResponses.set('tracks-media/me/t1', [file('audio.mp3')]);
    mockEnv.removeError = 'denied';
    await expect(deleteMyAccount()).rejects.toThrow();
    expect(calls().some(c => c.includes('tracks-media'))).toBe(false);
  });

  it('does not touch storage or the RPC without a session', async () => {
    mockEnv.userError = 'no session';
    await expect(deleteMyAccount()).rejects.toThrow(/not signed in/);
    expect(mockList).not.toHaveBeenCalled();
    expect(calls().some(c => c.startsWith('rpc:'))).toBe(false);
  });
});

describe('deleteMyAccount — the nested tracks-media layout', () => {
  it('descends into per-track folders instead of trying to remove them', async () => {
    mockEnv.listResponses.set('avatars/me', []);
    mockEnv.listResponses.set('tracks-media/me', [folder('t1'), folder('t2')]);
    mockEnv.listResponses.set('tracks-media/me/t1', [file('audio.mp3'), file('cover.jpg')]);
    mockEnv.listResponses.set('tracks-media/me/t2', [file('video.mp4')]);

    await deleteMyAccount();

    const removed = calls()
      .filter(c => c.startsWith('remove:tracks-media:'))
      .flatMap(c => c.slice('remove:tracks-media:'.length).split(','));
    expect(removed.sort()).toEqual([
      'me/t1/audio.mp3',
      'me/t1/cover.jpg',
      'me/t2/video.mp4',
    ]);
  });

  it('pages past the 100-row list default', async () => {
    const many = Array.from({ length: 150 }, (_, i) => file(`avatar_${i}.jpg`));
    mockEnv.listResponses.set('avatars/me', many);
    mockEnv.listResponses.set('tracks-media/me', []);

    await deleteMyAccount();

    const removed = calls()
      .filter(c => c.startsWith('remove:avatars:'))
      .flatMap(c => c.slice('remove:avatars:'.length).split(','));
    expect(removed).toHaveLength(150);
    expect(removed).toContain('me/avatar_149.jpg');
    expect(calls()).toContain('list:avatars:me:100');
  });
});

describe('deleteMyAccount — the caller cannot name a victim', () => {
  it('lists only the signed-in user’s own prefix', async () => {
    mockEnv.listResponses.set('avatars/me', [file('a.jpg')]);
    mockEnv.listResponses.set('tracks-media/me', []);
    await deleteMyAccount();
    const listed = calls().filter(c => c.startsWith('list:'));
    expect(listed.length).toBeGreaterThan(0);
    for (const c of listed) {
      expect(c.split(':')[2]).toMatch(/^me(\/|$)/);
    }
  });

  it('takes no argument, so no path can be supplied', () => {
    expect(deleteMyAccount).toHaveLength(0);
  });
});

describe('deleteMyAccount — the rest of the sequence', () => {
  it('still deletes the account when the user has no files', async () => {
    mockEnv.listResponses.set('avatars/me', []);
    mockEnv.listResponses.set('tracks-media/me', []);
    await deleteMyAccount();
    expect(mockRemove).not.toHaveBeenCalled();
    expect(calls()).toContain('rpc:delete_my_account');
    expect(calls()).toContain('signOut');
  });

  it('does not sign out when the RPC fails, so the user can retry', async () => {
    mockEnv.listResponses.set('avatars/me', []);
    mockEnv.listResponses.set('tracks-media/me', []);
    mockEnv.rpcError = 'not_authenticated';
    await expect(deleteMyAccount()).rejects.toThrow(/not_authenticated/);
    expect(calls()).not.toContain('signOut');
  });
});
