/**
 * The open chat keeps its messages newest first, in server order, however they arrive —
 * realtime, a catch-up fetch, or a send's own reply. Each used to be put on top, so an older
 * message arriving late jumbled the chat until it was reopened (Android, 2026-11-03).
 */

import { mergeNewestFirst, settlePending } from '../chatOrder';

const msg = (id: string, createdAt: string) => ({ id, createdAt });

// Newest first, as the chat holds them.
const onScreen = [
  msg('hello', '2026-11-02T19:10:21.000+00:00'),
  msg('hey', '2026-11-02T19:10:12.000+00:00'),
];

it('puts a newer message on top', () => {
  const next = mergeNewestFirst(onScreen, [msg('yo', '2026-11-02T19:10:25.000+00:00')]);
  expect(next.map(m => m.id)).toEqual(['yo', 'hello', 'hey']);
});

it('slots an older message that arrives late into its place, not on top', () => {
  const next = mergeNewestFirst(onScreen, [msg('ssup', '2026-11-02T19:10:15.000+00:00')]);
  expect(next.map(m => m.id)).toEqual(['hello', 'ssup', 'hey']);
});

it('skips messages already on screen, and returns the same list when nothing is new', () => {
  expect(mergeNewestFirst(onScreen, [msg('hello', '2026-11-02T19:10:21.000+00:00')])).toBe(onScreen);
});

it('keeps an unsent message on top until it is sent', () => {
  const pending = [msg('opt-1', '2026-11-02T19:10:24.000Z'), ...onScreen];
  const next = mergeNewestFirst(pending, [msg('from-riya', '2026-11-02T19:10:30.000+00:00')]);
  expect(next.map(m => m.id)).toEqual(['opt-1', 'from-riya', 'hello', 'hey']);
});

it('places a sent message by server time when its send comes back', () => {
  // Riya's message landed while mine was still sending; the server stamped mine first.
  const pending = [msg('opt-1', '2026-11-02T19:10:24.000Z'), msg('from-riya', '2026-11-02T19:10:26.000+00:00'), ...onScreen];
  const next = settlePending(pending, 'opt-1', msg('yo', '2026-11-02T19:10:25.000+00:00'));
  expect(next.map(m => m.id)).toEqual(['from-riya', 'yo', 'hello', 'hey']);
});

it('does not show a message twice when a catch-up brought it in before its send came back', () => {
  const pending = [msg('opt-1', '2026-11-02T19:10:24.000Z'), msg('yo', '2026-11-02T19:10:25.000+00:00'), ...onScreen];
  const next = settlePending(pending, 'opt-1', msg('yo', '2026-11-02T19:10:25.000+00:00'));
  expect(next.map(m => m.id)).toEqual(['yo', 'hello', 'hey']);
});
