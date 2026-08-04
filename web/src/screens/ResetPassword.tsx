import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { PasswordField } from '../components/TextField';
import { supabase } from '../supabase';
import { ARRIVED_FROM_RECOVERY_LINK } from '../auth/recoveryEntry';

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

  /**
   * A SESSION IS NOT ENOUGH. An earlier version accepted any session at all, which meant
   * anyone at an already-signed-in browser could navigate here and set a new password
   * without knowing the current one — and the global sign-out below would then lock the real
   * owner out everywhere. What authorises this form is evidence of arriving from a recovery
   * LINK, not evidence of being signed in.
   *
   * Two accepted proofs, because the code may be consumed before or after this mounts:
   * the URL snapshot taken at module load (see recoveryEntry.ts), or a `PASSWORD_RECOVERY`
   * event — the discriminator the previous version discarded as `_e`.
   *
   * The code exchange is still asynchronous, so the session may lag; waiting distinguishes
   * "link still processing" from "link dead".
   */
  useEffect(() => {
    let cancelled = false;

    if (!ARRIVED_FROM_RECOVERY_LINK) {
      // Wait briefly for a PASSWORD_RECOVERY event before refusing — an implicit-flow link
      // can emit one without ever showing a code we could snapshot.
      const deadline = setTimeout(() => {
        if (!cancelled) setReady(false);
      }, 2000);
      const { data: sub } = supabase.auth.onAuthStateChange(event => {
        if (!cancelled && event === 'PASSWORD_RECOVERY') {
          clearTimeout(deadline);
          setReady(true);
        }
      });
      return () => {
        cancelled = true;
        clearTimeout(deadline);
        sub.subscription.unsubscribe();
      };
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setReady(data.session !== null);
    });
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
