/**
 * Re-linking to a jam after an app restart (findMyActiveJam).
 *
 * The "which jam am I in" pointer lived only in memory, so a host who swiped the app
 * away came back to a live jam with no Jam pill. These pin that a live membership is
 * found, and that a dead or heartbeat-less stale jam is NOT re-linked.
 */

type Row = {
  jam_room_id: string;
  jam_rooms: { conversation_id: string; host_clock_at: string | null; started_at: string };
};
let mockRows: Row[] = [];
let mockStale = false;
const mockRpc = jest.fn();

jest.mock('../../../lib/supabase', () => {
  const chain = () => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order']) { q[m] = () => q; }
    q.limit = () => Promise.resolve({ data: mockRows, error: null });
    return q;
  };
  return {
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'me' } } }) },
      from: () => chain(),
      rpc: (fn: string, args: unknown) => {
        mockRpc(fn, args);
        return Promise.resolve({ data: mockStale, error: null });
      },
    },
  };
});
jest.mock('../messages', () => ({ sendMessage: jest.fn() }));
jest.mock('../jamRealtime', () => ({ broadcastJamEnded: jest.fn() }));
jest.mock('../pushDispatch', () => ({ sendPush: jest.fn() }));
jest.mock('../../utils/authorDisplay', () => ({ resolveAuthorById: jest.fn() }));

import { findMyActiveJam } from '../jamRooms';

const recent = () => new Date(Date.now() - 60_000).toISOString();
const old = () => new Date(Date.now() - 60 * 60_000).toISOString();

beforeEach(() => {
  mockRows = [];
  mockStale = false;
  mockRpc.mockClear();
});

it('finds the live jam you are still a member of', async () => {
  mockRows = [{ jam_room_id: 'jam-1', jam_rooms: { conversation_id: 'c-1', host_clock_at: recent(), started_at: old() } }];
  await expect(findMyActiveJam()).resolves.toEqual({ jamRoomId: 'jam-1', conversationId: 'c-1' });
  expect(mockRpc).toHaveBeenCalledWith('jam_end_if_stale', { p_jam_room_id: 'jam-1' });
});

it('returns nothing when you are in no active jam', async () => {
  await expect(findMyActiveJam()).resolves.toBeNull();
});

it('does not re-link a jam the server just ended as stale', async () => {
  mockRows = [{ jam_room_id: 'jam-1', jam_rooms: { conversation_id: 'c-1', host_clock_at: old(), started_at: old() } }];
  mockStale = true;
  await expect(findMyActiveJam()).resolves.toBeNull();
});

it('does not re-link an old jam that never recorded a heartbeat', async () => {
  mockRows = [{ jam_room_id: 'jam-1', jam_rooms: { conversation_id: 'c-1', host_clock_at: null, started_at: old() } }];
  await expect(findMyActiveJam()).resolves.toBeNull();
  expect(mockRpc).not.toHaveBeenCalled();
});
