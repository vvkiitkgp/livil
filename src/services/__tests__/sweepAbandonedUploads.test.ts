/**
 * Clearing away uploads that never finished.
 *
 * createTrack inserts the track row first and rolls it back on failure — but only while the
 * app is running. Closed mid-upload, the row stayed forever with its `pending://`
 * placeholder (three in production on 2026-10-15). The sweep is a DELETE that runs on every
 * launch, so what it must never do matters more than what it does: touch someone else's
 * track, touch a finished one, or touch an upload still running on another device.
 */
jest.mock('@react-native-documents/picker', () => ({ keepLocalCopy: jest.fn() }));
jest.mock('react-native-audio-api', () => ({ decodeAudioData: jest.fn() }));

type Filter = [op: string, column: string, value: unknown];
/** Every select the sweep made, as its filters; and every delete / storage removal. */
const mockSelects: Filter[][] = [];
const mockDeleted: string[] = [];
const mockRemoved: string[][] = [];
let mockRows: Record<string, { id: string }[]> = {};

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => {
        const filters: Filter[] = [];
        mockSelects.push(filters);
        const q = {
          eq: (c: string, v: unknown) => { filters.push(['eq', c, v]); return q; },
          like: (c: string, v: unknown) => { filters.push(['like', c, v]); return q; },
          lt: (c: string, v: unknown) => {
            filters.push(['lt', c, v]);
            const column = filters.find(f => f[0] === 'like')![1];
            return Promise.resolve({ data: mockRows[column] ?? [], error: null });
          },
        };
        return q;
      },
      delete: () => ({ eq: (_c: string, id: string) => { mockDeleted.push(id); return Promise.resolve({ error: null }); } }),
    }),
    storage: {
      from: () => ({
        list: (prefix: string) => Promise.resolve({ data: [{ name: 'audio.mp3' }], error: null, prefix }),
        remove: (paths: string[]) => { mockRemoved.push(paths); return Promise.resolve({ error: null }); },
      }),
    },
  },
}));

import { sweepAbandonedUploads } from '../tracks';

const ME = 'user-me';

beforeEach(() => {
  mockSelects.length = 0;
  mockDeleted.length = 0;
  mockRemoved.length = 0;
  mockRows = {};
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it('deletes my placeholder rows — audio and video — and their files', async () => {
  mockRows = { audio_url: [{ id: 't-audio' }], video_url: [{ id: 't-video' }] };

  await sweepAbandonedUploads(ME);

  expect(mockDeleted).toEqual(['t-audio', 't-video']);
  expect(mockRemoved).toEqual([[`${ME}/t-audio/audio.mp3`], [`${ME}/t-video/audio.mp3`]]);
});

it('asks only for MY rows that still hold the placeholder and are over a day old', async () => {
  const before = Date.now();
  await sweepAbandonedUploads(ME);

  expect(mockSelects).toHaveLength(2);
  for (const filters of mockSelects) {
    expect(filters).toContainEqual(['eq', 'uploader_id', ME]);
    // A finished upload has a real URL; only the placeholder matches.
    expect(filters.find(f => f[0] === 'like')![2]).toBe('pending:%');
    // Younger than a day may still be uploading on another device.
    const cutoff = Date.parse(filters.find(f => f[0] === 'lt')![2] as string);
    expect(before - cutoff).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
  }
  expect(mockSelects.map(f => f.find(x => x[0] === 'like')![1]).sort()).toEqual(['audio_url', 'video_url']);
});

it('deletes nothing when nothing is stuck', async () => {
  await sweepAbandonedUploads(ME);

  expect(mockDeleted).toEqual([]);
  expect(mockRemoved).toEqual([]);
});

it('does nothing without a user', async () => {
  await sweepAbandonedUploads('');

  expect(mockSelects).toHaveLength(0);
});
