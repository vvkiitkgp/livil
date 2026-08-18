/**
 * The buffering contract, which is the part of PROP-0010 phase 1 that runs while somebody
 * is scrolling. What matters here is not that the RPC is called — it is HOW OFTEN, and
 * with what. A per-card request would be a request every few hundred milliseconds during
 * the one interaction on this screen where dropped frames are obvious.
 *
 * The rate limit that decides whether a repeat view counts as a separate occasion lives in
 * the database (`record_post_impressions`), and is asserted in
 * supabase/tests/rls/feed-impressions.test.sql. This suite covers the client half only.
 */

const mockRpc = jest.fn().mockResolvedValue({ data: null, error: null });

// The mock is a METHOD that checks its receiver, mirroring supabase-js. This matters:
// the previous mock was an arrow function on an object literal, so it worked whether or
// not the caller kept `rpc` attached to the client. That let `const rpc = supabase.rpc`
// ship green and take the whole feed down with "Cannot read property 'rpc' of undefined".
// A mock that cannot fail the way the real thing fails is not a test.
jest.mock('../../../lib/supabase', () => {
  const client = {
    rpc(this: unknown, fn: string, args: Record<string, unknown>) {
      if (this !== client) {
        throw new TypeError("Cannot read property 'rpc' of undefined");
      }
      return mockRpc(fn, args);
    },
  };
  return { supabase: client };
});

import {
  recordImpression,
  flushImpressions,
  discardImpressions,
} from '../feedImpressions';

const idsOf = (call: unknown[]): string[] =>
  (call[1] as { p_post_ids: string[] }).p_post_ids;

beforeEach(() => {
  jest.useFakeTimers();
  discardImpressions();
  mockRpc.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

test('a handful of cards is one request, not one per card', () => {
  for (let i = 0; i < 10; i++) { recordImpression(`post-${i}`); }

  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc.mock.calls[0][0]).toBe('record_post_impressions');
  expect(idsOf(mockRpc.mock.calls[0]).sort()).toEqual(
    Array.from({ length: 10 }, (_, i) => `post-${i}`).sort(),
  );
});

test('a slow scroll still sends, once the viewer stops', () => {
  recordImpression('post-a');
  recordImpression('post-b');
  // Below the batch size: nothing has gone out yet.
  expect(mockRpc).not.toHaveBeenCalled();

  jest.advanceTimersByTime(4000);

  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(idsOf(mockRpc.mock.calls[0])).toEqual(['post-a', 'post-b']);
});

test('the idle window restarts on each new card, so one scroll is one request', () => {
  recordImpression('post-a');
  jest.advanceTimersByTime(3000);
  recordImpression('post-b');
  jest.advanceTimersByTime(3000);   // 6s elapsed, but only 3s since the last card
  expect(mockRpc).not.toHaveBeenCalled();

  jest.advanceTimersByTime(1000);
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(idsOf(mockRpc.mock.calls[0])).toEqual(['post-a', 'post-b']);
});

test('the same card twice in one batch is sent once', () => {
  recordImpression('post-a');
  recordImpression('post-a');
  flushImpressions();

  expect(idsOf(mockRpc.mock.calls[0])).toEqual(['post-a']);
});

test('flushing drains the buffer — the next flush does not resend', () => {
  recordImpression('post-a');
  flushImpressions();
  flushImpressions();

  expect(mockRpc).toHaveBeenCalledTimes(1);
});

test('flushing an empty buffer is a no-op, not an empty request', () => {
  flushImpressions();
  expect(mockRpc).not.toHaveBeenCalled();
});

test('a failed write is swallowed and never rejects into the UI', async () => {
  mockRpc.mockRejectedValueOnce(new Error('offline'));
  recordImpression('post-a');

  expect(() => flushImpressions()).not.toThrow();
  // Let the rejected promise settle; an unhandled rejection here would fail the suite.
  await Promise.resolve();
});

test('an empty id is ignored rather than buffered', () => {
  recordImpression('');
  flushImpressions();
  expect(mockRpc).not.toHaveBeenCalled();
});
