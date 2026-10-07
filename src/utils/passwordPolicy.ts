/**
 * Client-side password rules for NEW passwords (sign-up, reset). UX only — the
 * real gate is Supabase Auth's own policy (minimum length, required characters,
 * leaked-password check), which a modified client cannot skip. Keep these no
 * stricter than the dashboard settings, or a password the server would accept is
 * refused here for no reason.
 *
 * Never apply this at SIGN-IN: accounts created under the old 6-character rule
 * must keep working.
 */
export const PASSWORD_MIN_LENGTH = 8;

/** Returns a user-facing reason the password is too weak, or null if it passes. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password needs at least one letter and one number.';
  }
  return null;
}

/**
 * Supabase rejects weak passwords with `code: 'weak_password'` — too short, missing
 * a required character class, or found in a breach list (HaveIBeenPwned). Its raw
 * message is technical; this is the one we show.
 */
export function isWeakPasswordError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) { return false; }
  return err.code === 'weak_password' || /weak|easy to guess|pwned/i.test(err.message ?? '');
}

export const WEAK_PASSWORD_MESSAGE =
  'That password is too easy to guess or has appeared in a data breach. Please choose a different one.';
