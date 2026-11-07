/**
 * The server's clock, as seen from this phone.
 *
 * A 5-minute chat photo's countdown (PROP-0011) runs from `messages.created_at`, which the
 * SERVER stamps. A phone whose clock is a minute fast would show a fresh photo as already
 * half gone. So every server timestamp that arrives "now" — a just-sent message's
 * created_at, the chat-media function's `now` — updates one offset, and countdowns read
 * `serverNow()` instead of `Date.now()`.
 */

let offsetMs = 0;
let known = false;

/**
 * A server time observed between two local times (a request's send and receive). The
 * midpoint is the best guess at when the server stamped it. Offsets under a second are
 * noise and ignored, so the countdown does not twitch between messages.
 */
export function noteServerTime(serverIso: string, sentAtMs: number, receivedAtMs: number): void {
  const server = Date.parse(serverIso);
  if (!Number.isFinite(server) || receivedAtMs < sentAtMs) { return; }
  const next = server - (sentAtMs + receivedAtMs) / 2;
  if (!known || Math.abs(next - offsetMs) >= 1000) { offsetMs = next; }
  known = true;
}

export function serverNow(): number {
  return Date.now() + offsetMs;
}

/**
 * The server's clock, or null until a server time has been observed this session. For a
 * caller that must not guess: with no observation, serverNow() is this phone's own clock,
 * which can be minutes off.
 */
export function serverNowIfKnown(): number | null {
  return known ? serverNow() : null;
}

/** For tests. */
export function __resetServerClock(): void {
  offsetMs = 0;
  known = false;
}
