/**
 * Session state for the dashboard.
 *
 * More than signed-in/signed-out is needed here. `needs-onboarding` covers an account that
 * exists but has never claimed a username.
 *
 * ADR-0015 decision 3 says the dashboard is sign-in only. Omitting a signup form does NOT
 * achieve that on its own — `signInWithOAuth` creates the user when none exists, and
 * `handle_new_user()` then writes a profile with a `user_xxxxxxxx` placeholder and
 * `username_set = false`. Without this check, a first-time Google user would land in the
 * dashboard holding a handle they never chose, and a username is permanent once claimed.
 *
 * Such a user is signed back out and pointed at the app. The account they just created is
 * not orphaned: `ChooseUsernameScreen` picks them up on their first mobile sign-in, which
 * is the intended flow anyway.
 *
 * FAILURE MODEL — deliberately neither of the two obvious options:
 *
 *   Fail open (mobile's choice in `getUsernameSet`) is right there and wrong here. On the
 *   phone the app itself owns the username gate, so the worst case is a returning user
 *   briefly seeing their own app. On web, failing open lets an un-onboarded account into
 *   the dashboard, which is the exact thing decision 3 forbids.
 *
 *   Fail closed would sign a legitimate artist out over a dropped request.
 *
 * So a read error is its own state: the session is preserved, nothing is decided, and the
 * user can retry. Only a positive `username_set === false` routes to onboarding.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../supabase';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'needs-onboarding' }
  | { status: 'signed-in'; session: Session }
  | { status: 'error'; retry: () => void };

type OnboardingCheck = 'onboarded' | 'not-onboarded' | 'unknown';

async function checkOnboarding(userId: string): Promise<OnboardingCheck> {
  const { data, error } = await supabase
    .from('profiles')
    .select('username_set')
    .eq('id', userId)
    .maybeSingle();

  if (error) return 'unknown';
  // No row is not a read failure — the trigger creates a profile for every auth user, so
  // its absence means something is genuinely wrong with this account. Treat it as
  // un-onboarded rather than waving it through.
  if (!data) return 'not-onboarded';
  return data.username_set === true ? 'onboarded' : 'not-onboarded';
}

export function useAuthState(): AuthState {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt(n => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const resolve = async (session: Session | null): Promise<AuthState> => {
      if (!session) return { status: 'signed-out' };
      const check = await checkOnboarding(session.user.id);
      if (check === 'unknown') return { status: 'error', retry };
      if (check === 'not-onboarded') return { status: 'needs-onboarding' };
      return { status: 'signed-in', session };
    };

    const apply = (next: AuthState) => {
      if (!cancelled) setState(next);
    };

    supabase.auth
      .getSession()
      .then(({ data }) => resolve(data.session))
      .then(apply)
      .catch(() => apply({ status: 'error', retry }));

    // Covers the OAuth redirect landing, token refresh, and sign-out in another tab.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      resolve(session)
        .then(apply)
        .catch(() => apply({ status: 'error', retry }));
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [attempt, retry]);

  return state;
}

/**
 * Fire-and-forget by design, so callers can pass it straight to `onClick`.
 *
 * A failed sign-out is not actionable: supabase-js clears the local session regardless of
 * what the network does, so there is nothing to report and nothing to retry.
 */
export function signOut(): void {
  // LOCAL scope, deliberately. An earlier version used 'global' to make sure the refresh
  // token died server-side — correct instinct, wrong blast radius: global revokes EVERY
  // session, so signing out of the dashboard would silently sign the artist out of their
  // phone too. Sessions are per-device by design and signing out of one device should mean
  // one device.
  //
  // Global revocation still happens where it is actually warranted: after a password reset,
  // where the whole point is that other sessions may not belong to you.
  supabase.auth.signOut({ scope: 'local' }).catch(() => {
    /* the local session is cleared regardless */
  });
}
