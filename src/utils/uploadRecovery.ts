/**
 * What an upload does when the connection, not the server, is what failed.
 *
 * WHY THIS EXISTS
 *
 * An upload that sat at 0% with no way forward was reported after the phone's network got
 * bad / switched from Wi-Fi to mobile data (2026-11-02). React Native's Android networking
 * has NO time limits at all (`OkHttpClientProvider`: connect, read and write timeouts are
 * all 0), and supabase-js sets none either — so any request made over a dead connection
 * can wait for many minutes. The XHR upload had its own stall watchdog, but the requests
 * around it (the sign-in check, creating the track row, and the clean-up AFTER a stall)
 * did not, and the screen cannot be left mid-upload. So:
 *
 *   - every network step around an upload is time-boxed (`withTimeout`);
 *   - a failure the connection caused is told apart from one the server answered with
 *     (`UploadNetworkError`), because only the first is worth retrying by itself;
 *   - and that retry happens ONCE, when the phone is online (`autoRetryDelay`).
 */

/** A failure the connection caused — retrying on a working connection can fix it. */
export class UploadNetworkError extends Error {
  /** Which step it stopped at, for the `[LIVIL][upload]` log. */
  readonly step: string;
  constructor(step: string, message: string) {
    super(message);
    this.name = 'UploadNetworkError';
    this.step = step;
  }
}

/**
 * Compared by name, not `instanceof`: Jest's isolated module registries (and a Metro reload)
 * can hand back a second copy of this class, and the screen must still recognise it.
 */
export function isUploadNetworkError(err: unknown): err is UploadNetworkError {
  return !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'UploadNetworkError';
}

/** The user-facing line for a step that could not reach Livil at all. */
export const NO_CONNECTION_MESSAGE = "Couldn't reach Livil. Check your connection and try again.";

/**
 * Whether an error object returned by supabase-js came from the CONNECTION — no answer from
 * the server at all — rather than from the server refusing something.
 *
 * - auth-js wraps a failed `fetch` in `AuthRetryableFetchError` (status 0).
 * - postgrest-js turns it into `{ message: 'TypeError: Network request failed' }` (React
 *   Native's wording), `'AbortError: …'` for an aborted request, or `'FetchError: …'`.
 */
export function isFetchFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') { return false; }
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === 'AuthRetryableFetchError' || name === 'UploadNetworkError') { return true; }
  if (typeof message !== 'string') { return false; }
  return /network request failed|failed to fetch|fetch failed|networkerror|^aborterror\b|^fetcherror\b/i.test(message);
}

/**
 * `promise`, or a rejection with `onTimeout()` if it has not settled within `ms`.
 *
 * The request itself is NOT cancelled — supabase-js gives no handle on the auth calls — so it
 * may still land later. `onLate` receives what it resolved with then, so a write that lands
 * after we gave up on it (a track row) can be undone instead of left behind.
 */
export function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  onTimeout: () => Error,
  onLate?: (value: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(onTimeout());
    }, ms);
    promise.then(
      value => {
        if (timedOut) { onLate?.(value); return; }
        clearTimeout(timer);
        resolve(value);
      },
      err => {
        if (timedOut) { return; }
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** How long after the phone is back online the one automatic retry starts. */
export const AUTO_RETRY_DELAY_MS = 3_000;

/**
 * When to retry a failed upload by itself: in `AUTO_RETRY_DELAY_MS`, or `null` for "not now".
 *
 * Only a network failure, only once, and only while online — offline it waits, and the
 * screen calls this again when the connection comes back. The short delay lets a phone that
 * has just switched from Wi-Fi to mobile data finish bringing the new network up; retrying
 * the same instant fails again on the half-ready connection.
 */
export function autoRetryDelay(s: {
  network: boolean;
  offline: boolean;
  autoRetryUsed: boolean;
}): number | null {
  if (!s.network || s.autoRetryUsed || s.offline) { return null; }
  return AUTO_RETRY_DELAY_MS;
}

/** What the screen shows for an upload the connection stopped. */
export type InterruptionCopy = {
  title: string;
  body: string;
  /** False while the automatic retry is about to start: nothing to press. */
  showTryAgain: boolean;
};

export function interruptionCopy(s: {
  offline: boolean;
  autoRetryUsed: boolean;
  /** The error's own line ("The connection stalled…"). */
  reason: string;
}): InterruptionCopy {
  if (!s.autoRetryUsed) {
    return s.offline
      ? {
          title: 'Waiting for connection…',
          body: "The upload stopped when the connection dropped. It starts again by itself when you're back online.",
          showTryAgain: true,
        }
      : {
          title: 'Connection dropped — trying again…',
          body: 'The upload starts again in a moment.',
          showTryAgain: false,
        };
  }
  return {
    title: 'Upload interrupted',
    body: s.offline ? "You're offline. Tap Try again once you're connected." : s.reason,
    showTryAgain: true,
  };
}
