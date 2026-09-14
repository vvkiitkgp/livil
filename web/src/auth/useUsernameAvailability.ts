import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';

/** Mirrors `claim_username`'s check in the database exactly. */
export const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

/**
 * The single normalisation, applied on every keystroke so the field shows exactly what will
 * be stored.
 *
 * Handles are lowercase-only, and that is settled in the database, not here — the
 * `enforce_username_reservation` trigger assigns `lower(btrim(...))` and
 * `profiles_username_lower_key` is a unique index on `lower(username)`, so `@Vamsi` and
 * `@vamsi` cannot coexist however a client behaves. This function exists so the UI stops
 * disagreeing with that: typing `Vamsi` used to leave `Vamsi` sitting in the box while the
 * account you actually got was `@vamsi`.
 */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, '');
}

export type Availability = 'idle' | 'checking' | 'free' | 'taken' | 'invalid' | 'error';

/**
 * Debounced "is this handle free?", shared by the two screens that claim one.
 *
 * Both signup paths need it — `SignIn` in signup mode (where the handle rides along in the
 * signUp metadata) and `ChooseUsername` (where OAuth accounts claim one afterwards) — and
 * they have to agree on the rules. A handle is PERMANENT once set, so a screen that
 * validated more loosely than the database would hand someone a rejection at the last
 * possible moment, or worse, a handle they cannot then change.
 *
 * This is availability, not a reservation: nothing is held between the check and the claim.
 * The UNIQUE constraint on `profiles.username` is the real arbiter, and both callers report
 * the race when it loses.
 */
export function useUsernameAvailability(raw: string): {
  cleaned: string;
  status: Availability;
} {
  // Still normalised here, not just at the input: callers may seed the field from elsewhere,
  // and the check must never run against something the database would store differently.
  const cleaned = useMemo(() => normalizeUsername(raw), [raw]);
  const [status, setStatus] = useState<Availability>('idle');

  useEffect(() => {
    if (!cleaned) {
      setStatus('idle');
      return;
    }
    if (!USERNAME_RE.test(cleaned)) {
      setStatus('invalid');
      return;
    }

    setStatus('checking');
    let cancelled = false;
    // 400ms: long enough that typing a whole handle costs one round trip, short enough to
    // feel immediate.
    const timer = setTimeout(() => {
      supabase.rpc('is_username_available', { p_username: cleaned }).then(({ data, error }) => {
        if (cancelled) return;
        // A failed check must never read as "free" — that sends the user into a claim that
        // fails at the database with a worse message.
        if (error) setStatus('error');
        else setStatus(data ? 'free' : 'taken');
      });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cleaned]);

  return { cleaned, status };
}

/** The one-line hint under the field. Shared so both screens say the same thing. */
export function usernameHint(status: Availability, cleaned: string): string {
  switch (status) {
    case 'invalid':
      return '3–30 characters: lowercase letters, numbers, underscore.';
    case 'checking':
      return 'Checking…';
    case 'free':
      return `@${cleaned} is yours.`;
    case 'taken':
      return 'That one is taken.';
    case 'error':
      return "Couldn't check that one — try again.";
    default:
      return 'Lowercase letters, numbers and underscore.';
  }
}
