import { useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import {
  PLAY_STORE_URL,
  joinWaitlist,
  signInWithGoogle,
  signInWithPassword,
} from '../auth/signIn';

/**
 * Sign-in, plus the two exits for anyone without an account.
 *
 * There is no signup form and no password-reset flow here. Reset is deliberately deferred
 * rather than half-built: it needs its own allow-listed redirect URL and a reset screen,
 * and shipping a "check your email" that lands on a route which does not exist is worse
 * than pointing at the app. Tracked as a Phase 1 follow-up.
 */
export function SignIn({ onForgotPassword }: { onForgotPassword: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<null | 'password' | 'google'>(null);
  const [error, setError] = useState<string | null>(null);

  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistDone, setWaitlistDone] = useState(false);
  const [waitlistBusy, setWaitlistBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy('password');
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
          autoComplete="current-password"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
        />

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" busy={busy === 'password'}>
          Sign in
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

        <button type="button" className="linkbtn" onClick={onForgotPassword}>
          Forgot your password?
        </button>
      </form>

      <section className="card card--muted">
        <h2 className="card__title">New to Livil?</h2>
        <p className="hint">
          Accounts are created in the app. Once you've signed up there, sign in here to
          upload.
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
