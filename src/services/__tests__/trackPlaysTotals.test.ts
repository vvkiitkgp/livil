/**
 * `fetchTrackPlaysTotals` — the Uploads grid's numbers. It must add up exactly what
 * `fetchTrackPlaysTotal` adds up for one track (every post of the song this viewer can see:
 * the upload and its reposts), or a card and the full-screen player disagree.
 */
jest.mock('@react-native-documents/picker', () => ({ keepLocalCopy: jest.fn() }));
jest.mock('react-native-audio-api', () => ({ decodeAudioData: jest.fn() }));

const mockIn = jest.fn();
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (cols: string) => ({
        in: (col: string, ids: string[]) => mockIn(table, cols, col, ids),
      }),
    }),
  },
}));

import { fetchTrackPlaysTotals } from '../posts';

beforeEach(() => mockIn.mockReset());

it("sums every visible post of each song — the upload and its reposts", async () => {
  mockIn.mockResolvedValue({
    data: [
      { track_id: 't1', views_count: 1000 }, // the upload
      { track_id: 't1', views_count: 234 },  // a repost
      { track_id: 't2', views_count: 57 },
      { track_id: 't2', views_count: null },
    ],
    error: null,
  });

  const totals = await fetchTrackPlaysTotals(['t1', 't2', 't1']);

  expect(totals).toEqual({ t1: 1234, t2: 57 });
  // One request for the page, each id once.
  expect(mockIn).toHaveBeenCalledTimes(1);
  expect(mockIn).toHaveBeenCalledWith('posts', 'track_id, views_count', 'track_id', ['t1', 't2']);
});

it('asks nothing for an empty page', async () => {
  expect(await fetchTrackPlaysTotals([])).toEqual({});
  expect(mockIn).not.toHaveBeenCalled();
});

it('throws on a failed read, so the hook keeps the numbers it had', async () => {
  mockIn.mockResolvedValue({ data: null, error: { message: 'down' } });
  await expect(fetchTrackPlaysTotals(['t1'])).rejects.toThrow('down');
});
