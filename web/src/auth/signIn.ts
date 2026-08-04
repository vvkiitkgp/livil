/**
 * Sign-in actions. No sign-up path exists here by design (ADR-0015 decision 3).
 */
import { dbUntyped, supabase } from '../supabase';

/** The public listing. In closed testing this resolves only for enrolled testers. */
export const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.livil';

export type SignInResult = { ok: true } | { ok: false; message: string };

/**
 * Supabase returns a deliberately vague "Invalid login credentials" for both a wrong
 * password and an unknown email, so an attacker cannot enumerate accounts. That is the
 * right behaviour and it is passed through unchanged — but it reads as a dead end on a
 * client with no signup, so the copy points at the app instead.
 */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<SignInResult> {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (!error) return { ok: true };

  if (/invalid login credentials/i.test(error.message)) {
    return {
      ok: false,
      message:
        "That email and password don't match an account. If you haven't made one yet, " +
        'sign up in the Livil app first.',
    };
  }
  if (/email not confirmed/i.test(error.message)) {
    return { ok: false, message: 'Confirm your email address first — check your inbox.' };
  }
  return { ok: false, message: error.message };
}

/**
 * Redirects to Google. Returns only on failure — success navigates away.
 *
 * `redirectTo` must be allow-listed in Supabase → Auth → URL Configuration. The mobile app
 * uses the custom scheme `livil://auth`, which a browser cannot use, so this is a second
 * entry rather than a replacement.
 */
export async function signInWithGoogle(): Promise<SignInResult> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/` },
  });
  return error ? { ok: false, message: error.message } : { ok: true };
}

/**
 * Waitlist capture for visitors without an account.
 *
 * `waitlist` grants anon INSERT only — no select, update or delete — so the list cannot be
 * read back or enumerated. A duplicate email hits the UNIQUE constraint; that is reported
 * as success because "you're already on the list" and "you're on the list" are the same
 * outcome to the visitor, and distinguishing them would leak membership.
 */
export async function joinWaitlist(email: string): Promise<SignInResult> {
  // `waitlist` is absent from the generated types — see `dbUntyped` in ../supabase.
  const { error } = (await dbUntyped
    .from('waitlist')
    .insert({ email: email.trim() })) as { error: { code?: string } | null };

  if (!error) return { ok: true };
  if (error.code === '23505') return { ok: true };
  return { ok: false, message: 'Could not add you just now. Try again in a moment.' };
}
