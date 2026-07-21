/**
 * Tests for chat time grouping.
 *
 * Chosen as the first real test in this repository because it is pure logic with
 * no native dependencies — it proves the harness works without needing a dozen
 * modules mocked. It replaces a template test that rendered the whole app and
 * asserted nothing (kb/standards/testing.md).
 *
 * Tests name the behaviour rather than the function, and use fixed timestamps so
 * they cannot drift with the wall clock.
 */

import {
  CHAT_TIME_GAP_MS,
  shouldShowTimeSeparator,
} from '../chatTime';

describe('shouldShowTimeSeparator', () => {
  const t = (iso: string) => iso;

  it('labels the first message in a thread', () => {
    expect(shouldShowTimeSeparator(t('2026-07-21T12:00:00.000Z'), null)).toBe(true);
  });

  it('does not label a message sent within the gap', () => {
    expect(
      shouldShowTimeSeparator(
        t('2026-07-21T12:30:00.000Z'),
        t('2026-07-21T12:00:00.000Z'),
      ),
    ).toBe(false);
  });

  it('labels a message sent after the gap', () => {
    expect(
      shouldShowTimeSeparator(
        t('2026-07-21T13:30:00.000Z'),
        t('2026-07-21T12:00:00.000Z'),
      ),
    ).toBe(true);
  });

  it('treats a gap of exactly the threshold as needing a label', () => {
    const prev = new Date('2026-07-21T12:00:00.000Z');
    const exact = new Date(prev.getTime() + CHAT_TIME_GAP_MS);
    expect(
      shouldShowTimeSeparator(exact.toISOString(), prev.toISOString()),
    ).toBe(true);
  });

  it('is symmetric — out-of-order timestamps still label correctly', () => {
    // Messages can arrive out of order over realtime; the comparison is absolute
    // so an older message following a newer one is still separated.
    expect(
      shouldShowTimeSeparator(
        t('2026-07-21T12:00:00.000Z'),
        t('2026-07-21T13:30:00.000Z'),
      ),
    ).toBe(true);
  });

  it('honours a caller-supplied gap', () => {
    const oneMinute = 60 * 1000;
    expect(
      shouldShowTimeSeparator(
        t('2026-07-21T12:02:00.000Z'),
        t('2026-07-21T12:00:00.000Z'),
        oneMinute,
      ),
    ).toBe(true);
  });
});
