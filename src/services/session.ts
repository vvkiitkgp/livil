import { supabase } from '../../lib/supabase';

/**
 * The signed-in user's id, from the session saved on the phone — no network call, so it
 * works offline. `supabase.auth.getUser()` asks the server instead: offline it fails, and
 * screens that read that failure as "signed out" told people "You must be signed in" when
 * they only had no internet (owner report, 2026-10-19).
 *
 * The server still checks the token on every request (RLS), so a local id grants nothing.
 * Null only when there is no session. If the saved session has expired and refreshing it
 * failed (offline), that error is thrown — so it reads as a connection problem, not as
 * signed out.
 */
export async function getMyUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  const id = data?.session?.user?.id;
  if (id) { return id; }
  if (error) { throw error; }
  return null;
}

/** A request that never reached the server — offline, or the connection dropped. */
export function isConnectionFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') { return false; }
  const { name, message } = error as { name?: unknown; message?: unknown };
  return (
    name === 'AuthRetryableFetchError' ||
    /network request failed|failed to fetch|networkerror/i.test(typeof message === 'string' ? message : '')
  );
}

/**
 * The error to throw when `supabase.auth.getUser()` (a server call) found no user: the
 * connection error itself when it never reached the server — so the person reads "Check your
 * connection", not a wrong "You must be signed in" — else `signedOutMessage`.
 */
export function noUserError(error: unknown, signedOutMessage: string): Error {
  if (isConnectionFailure(error)) {
    return error instanceof Error ? error : new Error('Network request failed');
  }
  return new Error(signedOutMessage);
}
