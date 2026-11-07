import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';

/** Where supabase keeps the login for this project: its default key, which a test pins. */
export const AUTH_STORAGE_KEY = 'sb-fqzrmqnlgjeuxzinbqvs-auth-token';

/** The login saved on this phone, read directly: no network, no waiting on the auth client. */
export async function readSavedSession(
  storage: { getItem(key: string): Promise<string | null> },
  sessionKey: string,
): Promise<Session | null> {
  try {
    const session = JSON.parse((await storage.getItem(sessionKey)) ?? 'null');
    return typeof session?.access_token === 'string' && typeof session?.user?.id === 'string'
      ? (session as Session)
      : null;
  } catch {
    return null;
  }
}

/** The login saved on this phone, without waiting on the auth client (or the network behind it). */
export const getSavedSession = () => readSavedSession(AsyncStorage, AUTH_STORAGE_KEY);
