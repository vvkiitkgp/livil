import { useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import {
  PLAY_STORE_URL,
  joinWaitlist,
  signInWithGoogle,
  signInWithPassword,
  signUpWithPassword,
} from '../auth/signIn';

/**
 * Sign-in, plus the two exits for anyone without an account.
 *
 * There is no signup form and no password-reset flow here. Reset is deliberately deferred
 * rather than half-built: it needs its own allow-listed redirect URL and a reset screen,
 * and shipping a "check your email" that lands on a route which does not exist is worse
 * than pointing at the app. Tracked as a Phase 1 follow-up.
 */
export function SignIn({
  mode,
  onToggleMode,
  onForgotPassword,
}: {
  mode: 'signin' | 'signup';
  onToggleMode: () => void;
  onForgotPassword: () => void;
}) {
  const signingUp = mode === 'signup';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<null | 'password' | 'google'>(null);
  const [error, setError] = useState<string | null>(null);

  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistDone, setWaitlistDone] = useState(false);
  const [waitlistBusy, setWaitlistBusy] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy('password');

    if (signingUp) {
      const created = await signUpWithPassword(email, password);
      setBusy(null);
      if (!created.ok) {
        setError(created.message);
        return;
      }
      // With email confirmation on, the account exists but has no session. Saying "done"
      // would leave the artist waiting on a dashboard that never loads.
      if (created.needsConfirmation) setConfirmSent(true);
      return;
    }

    const result = await signInWithPassword(email, password);
    // On success the auth listener swaps the screen out; leaving `busy` set avoids a
    // flash of the enabled form during that handover.
    if (!result.ok) {
      setError(result.message);
      setBusy(null);
    }
  }

  async function onGoogle() {
    setError(null);
    setBusy('google');
    const result = await signInWithGoogle();
    if (!result.ok) {
      setError(result.message);
      setBusy(null);
    }
  }

  async function onWaitlist(event: FormEvent) {
    event.preventDefault();
    setWaitlistBusy(true);
    const result = await joinWaitlist(waitlistEmail);
    setWaitlistBusy(false);
    if (result.ok) setWaitlistDone(true);
    else setError(result.message);
  }

  if (confirmSent) {
    return (
      <main className="auth bg-stage">
        <header className="auth__head">
          <h1 className="wordmark">Check your email</h1>
          <p className="tagline">
            Confirm {email.trim()} and you&apos;ll pick your handle next.
          </p>
        </header>
        <section className="card">
          <p className="hint">
            The link brings you straight back here. Check spam if it doesn&apos;t arrive.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="auth">
      <header className="auth__head">
        <h1 className="wordmark">Livil for Creators</h1>
        <p className="tagline">Upload your music from the machine you made it on.</p>
      </header>

      <form className="card" onSubmit={onSubmit}>
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete={signingUp ? 'new-password' : 'current-password'}
          required
          minLength={signingUp ? 8 : undefined}
          value={password}
          onChange={e => setPassword(e.target.value)}
        />

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" busy={busy === 'password'}>
          {signingUp ? 'Create account' : 'Sign in'}
        </Button>

        <div className="divider">
          <span>or</span>
        </div>

        <Button
          type="button"
          variant="secondary"
          size="lg"
          busy={busy === 'google'}
          onClick={onGoogle}
        >
          Continue with Google
        </Button>

        {!signingUp && (
          <button type="button" className="linkbtn" onClick={onForgotPassword}>
            Forgot your password?
          </button>
        )}
        <button type="button" className="linkbtn" onClick={onToggleMode}>
          {signingUp ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
      </form>

      <section className="card card--muted">
        <h2 className="card__title">Prefer the phone?</h2>
        <p className="hint">
          The app is where you listen, follow and message. The studio is for publishing.
        </p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => window.open(PLAY_STORE_URL, '_blank', 'noopener,noreferrer')}
        >
          Get the Android app
        </Button>

        {waitlistDone ? (
          <p className="hint">You're on the list — we'll email you when a spot opens.</p>
        ) : (
          <form className="waitlist" onSubmit={onWaitlist}>
            {/* Livil is in closed testing, so the Play listing resolves only for enrolled
                testers. Until it opens, this is the only working path for a new visitor. */}
            <TextField
              label="Not a tester yet? Join the waitlist"
              type="email"
              required
              placeholder="you@example.com"
              value={waitlistEmail}
              onChange={e => setWaitlistEmail(e.target.value)}
            />
            <Button type="submit" variant="ghost" busy={waitlistBusy}>
              Join waitlist
            </Button>
          </form>
        )}
      </section>
    </main>
  );
}
