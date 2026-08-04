import { useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { signOut } from '../auth/session';
import { supabase } from '../supabase';
import { useUsernameAvailability, usernameHint } from '../auth/useUsernameAvailability';

/**
 * Claim a permanent username.
 *
 * THE OAUTH PATH ONLY, now. Password signups collect the handle on the signup form itself
 * and pass it in the signUp metadata, where `handle_new_user()` claims it — so they arrive
 * with `username_set = true` and never reach this screen. What is left here is exactly the
 * case that cannot be handled up front: `signInWithOAuth` creates the account during a
 * redirect to Google, with no opportunity to ask for anything, so it lands with a
 * `user_xxxxxxxx` placeholder and `username_set = false`.
 *
 * PERMANENT, AND THE COPY SAYS SO BEFORE THE FACT. A database trigger refuses any later
 * change, so "you can fix it later" would be a lie the user only discovers when they try.
 *
 * The claim goes through `claim_username`, never a direct update: the RPC lowercases,
 * validates, checks the deleted-accounts ledger and flips `username_set` atomically. A
 * direct write would skip the ledger check.
 */
export function ChooseUsername({ onClaimed }: { onClaimed: () => void }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shared with the signup form: both screens claim a permanent handle, so they must agree
  // on what a valid one is.
  const { cleaned, status } = useUsernameAvailability(username);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const { error: rpcError } = await supabase.rpc('claim_username', {
      p_username: cleaned,
      p_display_name: displayName.trim() || undefined,
    });

    setBusy(false);

    if (rpcError) {
      setError(
        /taken|23505/i.test(rpcError.message)
          ? 'That username was just taken. Try another.'
          : rpcError.message,
      );
      return;
    }
    onClaimed();
  }

  const canSubmit = status === 'free' && !busy;

  return (
    <main className="auth bg-stage">
      <header className="auth__head">
        <p className="kicker">Lamination station</p>
        <h1 className="display auth__title">Choose your handle</h1>
        <p className="tagline">This is permanent — it can&apos;t be changed later.</p>
      </header>

      <form className="card" onSubmit={onSubmit}>
        <TextField
          label="Username"
          value={username}
          autoFocus
          autoComplete="off"
          placeholder="yourname"
          onChange={e => setUsername(e.target.value)}
        />
        <p className="hint" data-status={status}>
          {usernameHint(status, cleaned)}
        </p>

        <TextField
          label="Display name (optional)"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          placeholder="What people see"
        />

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" disabled={!canSubmit} busy={busy}>
          Claim it
        </Button>
        <Button type="button" variant="ghost" onClick={signOut}>
          Sign out
        </Button>
      </form>
    </main>
  );
}
