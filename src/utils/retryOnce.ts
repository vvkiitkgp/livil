/**
 * Run `fn`; if it rejects, wait `delayMs` and run it exactly once more.
 *
 * For reads fired the instant iOS resumes the app (a notification tap, the
 * app switcher). Its network connections are not usable for a moment, and the
 * first request fails with "Network request failed" — a retry a second later
 * succeeds. The second failure propagates; callers keep their own fallback.
 */
export async function retryOnce<T>(fn: () => Promise<T>, delayMs = 1000): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise<void>(resolve => setTimeout(resolve, delayMs));
    return fn();
  }
}
