/**
 * Did the player fail because there is no connection? Then every other track will fail too,
 * and skipping on would race through the queue (owner report, 2026-10-19: offline, a new
 * song every second with an error buzz each).
 *
 * The shapes react-native-video sends to onError:
 *   iOS      { error: { domain, code, localizedDescription, … } } — offline is
 *            NSURLErrorDomain (-1009 not connected, -1005 connection lost, -1001 timed out,
 *            -1020 data not allowed, …); AVFoundation wraps some of these, so the text is
 *            checked too.
 *   Android  { error: { errorString, errorException, errorCode } } — ExoPlayer's
 *            2001 IO_NETWORK_CONNECTION_FAILED / 2002 IO_NETWORK_CONNECTION_TIMEOUT.
 */
const NETWORK_TEXT = /offline|internet|network|connection|timed out|could not connect|unable to connect|host/i;
const ANDROID_NETWORK_CODES = new Set(['2001', '2002']);

export function isNetworkPlaybackError(event: unknown): boolean {
  const err = (event as { error?: unknown } | null | undefined)?.error;
  if (typeof err === 'string') { return NETWORK_TEXT.test(err); }
  if (!err || typeof err !== 'object') { return false; }
  const e = err as Record<string, unknown>;
  if (e.domain === 'NSURLErrorDomain') { return true; }
  if (typeof e.errorCode === 'string' && ANDROID_NETWORK_CODES.has(e.errorCode)) { return true; }
  if (typeof e.errorCode === 'number' && ANDROID_NETWORK_CODES.has(String(e.errorCode))) { return true; }
  return [e.localizedDescription, e.localizedFailureReason, e.errorString, e.errorException]
    .some(v => typeof v === 'string' && NETWORK_TEXT.test(v));
}
