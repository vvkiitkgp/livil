import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
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
 * The session to start the app with, given what `getSession()` answered. It reports a refresh it
 * could not make as "no session", but the login is still saved and is refreshed once it can be:
 * that person is not signed out. Any other "no session" is real.
 */
export async function startupSession(
  loaded: Session | null,
  error: unknown,
  readSaved: () => Promise<Session | null>,
): Promise<Session | null> {
  if (loaded || !isConnectionFailure(error)) { return loaded; }
  return readSaved();
}

/**
 * Whether an auth event should be ignored. A failed refresh also arrives as INITIAL_SESSION with
 * no session; only SIGNED_OUT (a sign-out, or the server refusing the login) ends a login.
 */
export function isFailedRefreshEvent(event: AuthChangeEvent, session: Session | null): boolean {
  return !session && event !== 'SIGNED_OUT';
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
