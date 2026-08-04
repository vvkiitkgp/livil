/**
 * Sign-in actions. No sign-up path exists here by design (ADR-0015 decision 3).
 */
import { supabase } from '../supabase';
import { studioUrl } from '../basePath';

/** The public listing. In closed testing this resolves only for enrolled testers. */
export const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.livil';

export type SignInResult = { ok: true } | { ok: false; message: string };

/**
 * Turn whatever came back into something a person can act on.
 *
 * Passing `error.message` straight to the UI assumes Supabase always returns a sentence.
 * It does not: when the confirmation email fails to send — wrong SMTP credentials, provider
 * refusing the sender — auth answers 500 with an opaque body and the message arrives as the
 * literal string `{}`. That rendered as a red box containing `{}`, which tells the artist
 * nothing and tells us nothing either.
 *
 * So: anything 5xx or empty becomes a plain "our end, try again", and the raw error goes to
 * the console where it can actually be read. Deliberately does NOT name email sending as the
 * cause — a 500 is not proof of which subsystem failed, and a confidently wrong explanation
 * is worse than an honest vague one.
 */
function humanize(error: { message?: string; status?: number }): string {
  const raw = (error.message ?? '').trim();
  console.error('[auth]', error);
  if (!raw || raw === '{}' || raw === '[object Object]' || (error.status ?? 0) >= 500) {
    return 'Something went wrong on our end. Nothing was changed — try again in a moment.';
  }
  return raw;
}

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
  return { ok: false, message: humanize(error) };
}

/**
 * Redirects to Google. Returns only on failure — success navigates away.
 *
 * `redirectTo` must be allow-listed in Supabase → Auth → URL Configuration. The mobile app
 * uses the custom scheme `livil://auth`, which a browser cannot use, so this is a second
 * entry rather than a replacement.
 */
/**
 * Create an account.
 *
 * Reverses ADR-0015 decision 3, which made the dashboard sign-in only. That decision existed
 * because `signInWithOAuth` creates accounts and a half-created one — signed in with a
 * `user_xxxxxxxx` placeholder and no claimed username — is unrecoverable for its owner. The
 * answer now is not to forbid signup but to finish it: `ChooseUsername` handles the second
 * half, for password and OAuth signups alike.
 *
 * `emailRedirectTo` must be allow-listed in Supabase → Auth → URL Configuration; the existing
 * wildcards cover it.
 */
export async function signUpWithPassword({
  email,
  password,
  displayName,
  username,
}: {
  email: string;
  password: string;
  displayName: string;
  username: string;
}): Promise<SignInResult & { needsConfirmation?: boolean }> {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    // Base-prefixed — the app is served under `/studio/`, and a confirmation link that
    // lands on the apex hits the marketing page instead of the dashboard.
    options: {
      emailRedirectTo: studioUrl('/'),
      // Matches the mobile signup exactly. `handle_new_user()` reads `username` and
      // `display_name` straight out of this metadata and sets `username_set = true` when a
      // username is present — which is what keeps a password signup out of the
      // `ChooseUsername` gate. Omit them and the account lands with a `user_xxxxxxxx`
      // placeholder, which is the OAuth path, not this one.
      data: { display_name: displayName.trim(), username },
    },
  });

  if (error) {
    if (/already registered|already exists/i.test(error.message)) {
      return { ok: false, message: 'There is already an account with that email. Sign in instead.' };
    }
    // The username is written by the trigger, and `profiles.username` is UNIQUE — so a
    // handle claimed between the availability check and this call surfaces here, not there.
    if (/duplicate key|23505|profiles_username/i.test(error.message)) {
      return { ok: false, message: 'That username was just taken. Try another.' };
    }
    if (/rate limit|too many/i.test(error.message)) {
      return { ok: false, message: 'Too many attempts. Wait a minute and try again.' };
    }
    return { ok: false, message: humanize(error) };
  }

  // Supabase's anti-enumeration behaviour: signing up with an email that is ALREADY
  // registered and confirmed returns 200 with a user whose `identities` array is empty, and
  // sends no email. Without this check the screen says "check your email" for a message that
  // is never sent — a dead end for someone who simply forgot they had an account. Mobile has
  // always handled this; web did not.
  if (data.user && data.user.identities?.length === 0) {
    return { ok: false, message: 'There is already an account with that email. Sign in instead.' };
  }

  // With email confirmation on, signUp returns a user but NO session — the account exists and
  // is unusable until the link is followed. Reporting success here would leave the artist
  // waiting on a dashboard that never loads.
  return { ok: true, needsConfirmation: data.session === null };
}

/**
 * Send the confirmation email again.
 *
 * `resend`, not a second `signUp`. Calling signUp again with the same address hits
 * Supabase's anti-enumeration path — a 200 with an empty `identities` array and no email —
 * so the button would report success and deliver nothing, which is the exact failure the
 * user pressed it to escape.
 *
 * Errors are swallowed by the caller: this is reached from a screen that has deliberately
 * stopped confirming whether an address exists.
 */
export async function resendConfirmation(email: string): Promise<void> {
  await supabase.auth.resend({
    type: 'signup',
    email: email.trim(),
    options: { emailRedirectTo: studioUrl('/') },
  });
}

export async function signInWithGoogle(): Promise<SignInResult> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: studioUrl('/') },
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
  const { error } = await supabase.from('waitlist').insert({ email: email.trim() });

  if (!error) return { ok: true };
  if (error.code === '23505') return { ok: true };
  return { ok: false, message: 'Could not add you just now. Try again in a moment.' };
}
