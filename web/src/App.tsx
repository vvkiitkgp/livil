import { useAuthState } from './auth/session';
import { Button } from './components/Button';
import { SignIn } from './screens/SignIn';
import { FinishInApp } from './screens/FinishInApp';
import { Dashboard } from './screens/Dashboard';

/**
 * Session gate. See `auth/session.ts` for why `needs-onboarding` and `error` are distinct
 * states rather than one fail-open or fail-closed default.
 */
export function App() {
  const state = useAuthState();

  switch (state.status) {
    case 'loading':
      // No spinner: the session read is a synchronous localStorage hit in the common
      // case, and a flashed spinner reads worse than a beat of nothing.
      return <main className="auth" aria-busy="true" />;
    case 'signed-out':
      return <SignIn />;
    case 'needs-onboarding':
      return <FinishInApp />;
    case 'signed-in':
      return <Dashboard session={state.session} />;
    case 'error':
      // The session is intact — we simply could not read the profile. Offering a retry
      // is why this is not folded into signed-out.
      return (
        <main className="auth">
          <header className="auth__head">
            <h1 className="wordmark">Can't reach Livil</h1>
            <p className="tagline">Your sign-in is fine — we couldn't load your profile.</p>
          </header>
          <section className="card">
            <Button type="button" size="lg" onClick={state.retry}>
              Try again
            </Button>
          </section>
        </main>
      );
  }
}
