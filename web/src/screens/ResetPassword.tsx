import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { PasswordField } from '../components/TextField';
import { supabase } from '../supabase';

const MIN_LENGTH = 8;

/**
 * Set a new password, having arrived from the emailed link.
 *
 * THE TRAP THIS SCREEN EXISTS AROUND: following a recovery link SIGNS YOU IN. Supabase
 * exchanges the code and emits a session, so the normal auth gate would see `signed-in` and
 * drop the user straight into the dashboard — with their old password still set and no idea
 * the reset never happened. That is why `/reset` is handled BEFORE the gate in App.tsx
 * rather than as a route inside it.
 *
 * The session is also what makes `updateUser` work: there is no token to pass here, because
 * the caller is already authenticated by the time this renders.
 */
export function ResetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The code exchange happens asynchronously after the redirect, so a session may not exist
  // on first render. Waiting for it distinguishes "link still processing" from "link dead".
  useEffect(() => {
    let cancelled = false;
    const check = () =>
      supabase.auth.getSession().then(({ data }) => {
        if (!cancelled) setReady(data.session !== null);
      });
    check();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!cancelled && session) setReady(true);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = password.length >= MIN_LENGTH && password === confirm && !busy;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setBusy(false);
      return;
    }

    // Sign out everywhere rather than continuing in place. Whoever reset the password may
    // be recovering from someone else having had access, and leaving other sessions alive
    // would leave the intruder signed in on a password the user just changed.
    await supabase.auth.signOut({ scope: 'global' }).catch(() => {});
    setBusy(false);
    onDone();
  }

  if (ready === false) {
    return (
      <main className="auth bg-stage">
        <header className="auth__head">
          <p className="kicker">Backstage door</p>
          <h1 className="display auth__title">That link has expired</h1>
          <p className="tagline">Reset links are short-lived and single-use.</p>
        </header>
        <section className="card">
          <Button size="lg" onClick={onDone}>
            Start again
          </Button>
        </section>
      </main>
    );
  }

  return (
    <main className="auth bg-stage">
      <header className="auth__head">
        <p className="kicker">Backstage door</p>
        <h1 className="display auth__title">Set a new password</h1>
      </header>

      <form className="card" onSubmit={onSubmit}>
        <PasswordField
          label="New password"
          autoComplete="new-password"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
        <PasswordField
          label="Confirm password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
        />

        {tooShort && <p className="hint">At least {MIN_LENGTH} characters.</p>}
        {mismatch && <p className="hint">Those don&apos;t match.</p>}

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" disabled={!canSubmit} busy={busy}>
          Save new password
        </Button>
        <p className="hint">
          You&apos;ll be signed out everywhere and can sign in again with the new password.
        </p>
      </form>
    </main>
  );
}
