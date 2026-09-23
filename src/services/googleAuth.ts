import { Linking, Platform } from 'react-native';
import { supabase } from '../../lib/supabase';
import {
  isAuthSessionAvailable,
  isAuthSessionCancellation,
  openAuthSession,
} from './authSession';

const REDIRECT_SCHEME = 'livil';
const REDIRECT_URL = `${REDIRECT_SCHEME}://auth`;

/** Thrown when the user closes the iOS sign-in sheet. Callers stay silent on it. */
export class GoogleSignInCancelled extends Error {
  constructor() {
    super('Google sign-in was cancelled.');
    this.name = 'GoogleSignInCancelled';
  }
}

export async function signInWithGoogle(): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // After Google auth, Supabase redirects here with the session in the URL
      // fragment (implicit flow — see lib/supabase.ts).
      redirectTo: REDIRECT_URL,
      // Prevent Supabase from calling window.location (N/A in RN); returns the URL instead.
      skipBrowserRedirect: true,
    },
  });
  if (error) { throw error; }
  if (!data.url) { throw new Error('No OAuth URL returned from Supabase.'); }

  // iOS: App Review rejects leaving the app for Safari to sign in (guideline 4),
  // so the page runs in the in-app sheet and the redirect comes back to us here.
  if (Platform.OS === 'ios' && isAuthSessionAvailable()) {
    let redirect: string;
    try {
      redirect = await openAuthSession(data.url, REDIRECT_SCHEME);
    } catch (e) {
      if (isAuthSessionCancellation(e)) { throw new GoogleSignInCancelled(); }
      throw e;
    }
    await setSessionFromRedirect(redirect);
    return;
  }

  // Android: the browser redirects to livil://auth, and RootNavigator's Linking
  // listener picks it up and sets the session.
  await Linking.openURL(data.url);
}

/**
 * Establish the session from the `livil://auth#access_token=…` redirect.
 *
 * Mirrors the implicit-flow branch of RootNavigator's deep-link handler, which
 * this path bypasses. NEVER log `url`: it carries the access and refresh tokens.
 */
async function setSessionFromRedirect(url: string): Promise<void> {
  const fragment = new URLSearchParams(url.split('#')[1] ?? '');
  const query = new URLSearchParams(url.split('?')[1]?.split('#')[0] ?? '');

  const authError =
    fragment.get('error_description') ?? query.get('error_description') ??
    fragment.get('error') ?? query.get('error');
  if (authError) { throw new Error(authError.replace(/\+/g, ' ')); }

  const accessToken = fragment.get('access_token');
  const refreshToken = fragment.get('refresh_token');
  if (!accessToken || !refreshToken) {
    throw new Error('Google sign-in did not return a session. Please try again.');
  }
  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) { throw error; }
}
