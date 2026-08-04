import { useEffect } from 'react';
import { Button } from '../components/Button';
import { PLAY_STORE_URL } from '../auth/signIn';
import { signOut } from '../auth/session';

/**
 * Shown when a signed-in account has never claimed a username.
 *
 * This is the enforcement point for "sign-in only" (ADR-0015 decision 3). Google OAuth
 * creates the account whether or not one existed, so the dashboard cannot rely on simply
 * having no signup form. The account is real and keeps its placeholder handle; the app's
 * `ChooseUsernameScreen` picks it up on first mobile sign-in.
 *
 * The session is dropped on mount rather than behind the button, so closing the tab cannot
 * leave a half-onboarded session sitting in localStorage.
 */
export function FinishInApp() {
  useEffect(() => {
    signOut();
  }, []);

  return (
    <main className="auth">
      <header className="auth__head">
        <h1 className="wordmark">Almost there</h1>
        <p className="tagline">
          Your account still needs a username, and that's chosen in the app.
        </p>
      </header>

      <section className="card">
        <p className="hint">
          Usernames are permanent, so Livil asks for yours on your first sign-in in the
          app. Once it's set, come back here and sign in to upload.
        </p>
        <Button
          type="button"
          size="lg"
          onClick={() => window.open(PLAY_STORE_URL, '_blank', 'noopener,noreferrer')}
        >
          Open the Livil app
        </Button>
      </section>
    </main>
  );
}
