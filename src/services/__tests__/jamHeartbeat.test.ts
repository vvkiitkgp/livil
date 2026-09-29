/**
 * The jam host heartbeat must actually be SENT.
 *
 * supabase-js builders are lazy — a query only goes out when something .then()s it — and
 * the first version fired `void db.rpc(...)`, which built the request and never sent it.
 * No heartbeat was ever recorded, so no jam could end as "host away". These pin that the
 * request is subscribed to, and the throttle / no-target rules.
 */

const mockSent: Array<{ fn: string; args: unknown }> = [];

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => ({
      // Lazy, like PostgrestBuilder: recorded only when .then() is called.
      then: (ok: (r: { error: null }) => void) => {
        mockSent.push({ fn, args });
        ok({ error: null });
      },
    }),
  },
}));

import { jamHeartbeatTick, setJamHeartbeatTarget, JAM_HEARTBEAT_MS } from '../jamHeartbeat';

beforeEach(() => {
  mockSent.length = 0;
  jest.useFakeTimers();
  setJamHeartbeatTarget(null);
});
afterEach(() => { jest.useRealTimers(); });

it('sends nothing when this device hosts no jam', () => {
  jamHeartbeatTick(true);
  expect(mockSent).toHaveLength(0);
});

it('actually sends the heartbeat for the hosted jam', () => {
  setJamHeartbeatTarget('jam-1');
  jamHeartbeatTick(true);
  expect(mockSent).toEqual([
    { fn: 'jam_host_heartbeat', args: { p_jam_room_id: 'jam-1', p_is_playing: true } },
  ]);
});

it('sends at most once per interval', () => {
  setJamHeartbeatTarget('jam-1');
  jamHeartbeatTick(true);
  jamHeartbeatTick(true);
  expect(mockSent).toHaveLength(1);
  jest.advanceTimersByTime(JAM_HEARTBEAT_MS + 1);
  jamHeartbeatTick(false);
  expect(mockSent).toHaveLength(2);
});
