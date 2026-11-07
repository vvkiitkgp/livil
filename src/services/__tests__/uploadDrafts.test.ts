const mockFiles = new Map<string, string>();
const mockState = { free: Infinity, failCopy: false, copies: 0 };

jest.mock('react-native-audio-api', () => ({ decodeAudioData: jest.fn() }));
jest.mock('../studioFiles', () => ({
  studioFiles: {
    available: true,
    canCopyIn: true,
    root: async () => '/root',
    freeBytes: async () => mockState.free,
    writeText: async (rel: string, text: string) => { mockFiles.set(rel, text); return true; },
    readText: async (rel: string) => {
      const text = mockFiles.get(rel);
      if (text === undefined) { throw new Error('no such file'); }
      return text;
    },
    copyIn: async (from: string, rel: string) => {
      if (mockState.failCopy) { throw new Error('copy failed'); }
      // As the native side does: a bare path is not a file URI.
      if (!from.startsWith('file://')) { throw new Error('Not a file on this phone'); }
      mockState.copies += 1;
      mockFiles.set(rel, `copy of ${from}`);
      return true;
    },
    remove: async (rel: string) => {
      for (const k of [...mockFiles.keys()]) {
        if (k === rel || k.startsWith(`${rel}/`)) { mockFiles.delete(k); }
      }
      return true;
    },
    listDirs: async (rel: string) => [
      ...new Set([...mockFiles.keys()].filter(k => k.startsWith(`${rel}/`)).map(k => k.slice(rel.length + 1).split('/')[0])),
    ],
    move: async () => true,
  },
}));

import { deleteDraft, listDrafts, loadUploadDraft, saveUploadDraft, type UploadDraftInput } from '../drafts';

const video = { uri: 'file:///caches/abc/IMG_5632.mov', name: 'IMG_5632.mov', type: 'video/quicktime', size: 97_800_000 };
const thumb = { uri: 'file:///caches/def/thumb.jpg', name: 'thumb.jpg', type: 'image/jpeg', size: 39_000 };

const input = (over: Partial<UploadDraftInput> = {}): UploadDraftInput => ({
  id: 'draft1',
  createdAt: '2026-11-06T06:00:00.000Z',
  title: 'Jamming session',
  durationSec: 35,
  mode: 'video',
  description: 'Live at home',
  tags: ['acoustic'],
  uploaderRoles: ['Guitar'],
  collaborators: [],
  album: null,
  media: video,
  picture: thumb,
  ...over,
});

beforeEach(() => {
  mockFiles.clear();
  mockState.free = Infinity;
  mockState.failCopy = false;
  mockState.copies = 0;
});

describe('upload drafts', () => {
  it('reopens with what was filled in and the draft’s own copies of the files', async () => {
    await saveUploadDraft('me', input());
    const { draft, media, picture } = await loadUploadDraft('me', 'draft1');
    expect(draft.title).toBe('Jamming session');
    expect(draft.form).toMatchObject({ mode: 'video', description: 'Live at home', tags: ['acoustic'], uploaderRoles: ['Guitar'] });
    expect(media?.uri).toMatch(/^file:\/\/\/root\/me\/draft1\/media-.+\.mov$/);
    expect(media).toMatchObject({ name: 'IMG_5632.mov', type: 'video/quicktime', size: 97_800_000 });
    expect(picture?.uri).toMatch(/^file:\/\/\/root\/me\/draft1\/picture-.+\.jpg$/);
    expect(mockState.copies).toBe(2);
  });

  it('saves a cropped picture, which the iPhone cropper hands back as a bare path', async () => {
    const cropped = { ...thumb, uri: '/private/var/tmp/react-native-image-crop-picker/A B.jpg' };
    await saveUploadDraft('me', input({ picture: cropped }));
    const { picture } = await loadUploadDraft('me', 'draft1');
    const stored = (picture?.uri ?? '').replace('file:///root/', '');
    expect(mockFiles.get(stored)).toBe('copy of file:///private/var/tmp/react-native-image-crop-picker/A%20B.jpg');
  });

  it('never stores a consent', async () => {
    await saveUploadDraft('me', input());
    const json = mockFiles.get('me/draft1/upload.json') ?? '';
    expect(json).not.toMatch(/grantedStreaming|streaming|declaration|acknowledg/i);
  });

  it('does not copy a file again on a re-save', async () => {
    await saveUploadDraft('me', input());
    const { media, picture } = await loadUploadDraft('me', 'draft1');
    mockState.copies = 0;
    await saveUploadDraft('me', input({ title: 'Renamed', media, picture }));
    expect(mockState.copies).toBe(0);
    const reopened = await loadUploadDraft('me', 'draft1');
    expect(reopened.draft.title).toBe('Renamed');
    expect(reopened.media?.uri).toBe(media?.uri);
    expect(mockFiles.has(media!.uri.replace('file:///root/', ''))).toBe(true);
  });

  it('removes a file the new version replaced', async () => {
    await saveUploadDraft('me', input());
    const first = await loadUploadDraft('me', 'draft1');
    const other = { ...video, uri: 'file:///caches/zzz/other.mp4', name: 'other.mp4' };
    await saveUploadDraft('me', input({ media: other, picture: first.picture }));
    const second = await loadUploadDraft('me', 'draft1');
    expect(second.media?.uri).toMatch(/\.mp4$/);
    expect(mockFiles.has(first.media!.uri.replace('file:///root/', ''))).toBe(false);
    expect(mockFiles.has(second.media!.uri.replace('file:///root/', ''))).toBe(true);
  });

  it('refuses without room for the file, leaving nothing behind', async () => {
    mockState.free = 150 * 1024 * 1024; // 100 MB spare is kept, so a 97.8 MB video does not fit
    await expect(saveUploadDraft('me', input())).rejects.toThrow(/Not enough space/);
    expect(mockFiles.size).toBe(0);
    expect(await listDrafts('me')).toEqual([]);
  });

  it('leaves nothing behind when a first save fails', async () => {
    mockState.failCopy = true;
    await expect(saveUploadDraft('me', input())).rejects.toThrow('copy failed');
    expect(mockFiles.size).toBe(0);
  });

  it('keeps the previous version when a re-save fails', async () => {
    await saveUploadDraft('me', input());
    mockState.failCopy = true;
    const other = { ...video, uri: 'file:///caches/zzz/other.mp4', name: 'other.mp4' };
    await expect(saveUploadDraft('me', input({ title: 'New', media: other }))).rejects.toThrow('copy failed');
    const { draft, media } = await loadUploadDraft('me', 'draft1');
    expect(draft.title).toBe('Jamming session');
    expect(mockFiles.has(media!.uri.replace('file:///root/', ''))).toBe(true);
  });

  it('lists upload drafts for the list to open in Upload, and deletes the whole folder', async () => {
    await saveUploadDraft('me', input());
    await saveUploadDraft('me', input({ id: 'draft2', title: '  ', media: null, picture: null, mode: 'audio' }));
    const list = await listDrafts('me');
    expect(list.map(d => d.uploadKind).sort()).toEqual(['audio', 'video']);
    expect(list.find(d => d.id === 'draft1')?.title).toBe('Jamming session');
    expect(list.find(d => d.id === 'draft2')?.title).toBe('Untitled upload');
    await deleteDraft('me', 'draft1');
    expect([...mockFiles.keys()].some(k => k.startsWith('me/draft1/'))).toBe(false);
  });

  it('titles an unnamed draft after its file', async () => {
    await saveUploadDraft('me', input({ title: '' }));
    expect((await listDrafts('me'))[0].title).toBe('IMG_5632');
  });
});
