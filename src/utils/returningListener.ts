import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Whether anyone has ever been signed in on THIS install — lets the signed-out
 * onboarding say "welcome back" to a returning listener instead of greeting them
 * like a stranger.
 *
 * Deliberately NOT under the `@livil:` prefix: `messageCache.clearAll()` wipes
 * every `@livil:` key on sign-out, and sign-out is exactly when this must survive.
 * Stores a bare flag — no name or user id outlives the session on a shared phone.
 * Every call is fail-safe; storage errors only cost the greeting.
 */
export const RETURNING_LISTENER_KEY = 'livil.has_signed_in';

export async function markSignedInHere(): Promise<void> {
  try {
    await AsyncStorage.setItem(RETURNING_LISTENER_KEY, '1');
  } catch {
    // ignore — first-time copy is the safe fallback
  }
}

export async function wasSignedInHere(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(RETURNING_LISTENER_KEY)) === '1';
  } catch {
    return false;
  }
}
