import { useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { supabase } from '../supabase';
import { studioUrl } from '../basePath';

/**
 * Ask for a reset link.
 *
 * This existing at all is the point. The dashboard is sign-in only and the Android app is in
 * closed testing, so before this an artist who forgot their password and was not already an
 * enrolled tester had NO route back into their account — the copy told them to reset in an
 * app they could not install.
 *
 * The response is deliberately identical whether or not the address has an account. Saying
 * "no account with that email" turns this form into an account-existence oracle for anyone
 * who wants to know whether a given person is on Livil.
 */
export function ForgotPassword({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const { error: sendError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      // Base-prefixed, NOT `${origin}/reset`. The app is served under `/studio/`, so an
      // origin-relative link lands outside it — and because the recovery token is consumed
      // by Supabase's /verify BEFORE the redirect, that first dead click burns the link and
      // the next one reports `otp_expired`. See basePath.ts.
      redirectTo: studioUrl('/reset'),
    });

    setBusy(false);

    // Rate limiting is the one thing worth surfacing, because the user CAN act on it —
    // waiting is a real instruction. Everything else reports as sent.
    if (sendError && /rate|too many/i.test(sendError.message)) {
      setError('Too many attempts. Wait a minute and try again.');
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <main className="auth bg-stage">
        <header className="auth__head">
          <p className="kicker">Backstage door</p>
          <h1 className="display auth__title">Check your email</h1>
          <p className="tagline">
            If there&apos;s an account for {email.trim()}, a reset link is on its way.
          </p>
        </header>
        <section className="card">
          <p className="hint">
            The link opens back here and expires shortly. If nothing arrives, check spam
            before trying again.
          </p>
          <Button variant="secondary" onClick={onBack}>
            Back to sign in
          </Button>
        </section>
      </main>
    );
  }

  return (
    <main className="auth bg-stage">
      <header className="auth__head">
        <p className="kicker">Backstage door</p>
        <h1 className="display auth__title">Forgot your password?</h1>
        <p className="tagline">We&apos;ll email you a link to set a new one.</p>
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

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" busy={busy}>
          Send reset link
        </Button>
        <Button type="button" variant="ghost" onClick={onBack}>
          Back to sign in
        </Button>
      </form>
    </main>
  );
}
