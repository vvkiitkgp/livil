import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { signOut } from '../auth/session';
import { supabase } from '../supabase';

/** Mirrors the database check in `enforce_username_reservation` exactly. */
const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

type Availability = 'idle' | 'checking' | 'free' | 'taken' | 'invalid';

/**
 * Claim a permanent username.
 *
 * This screen replaces the one that used to sign these accounts out and send them to the
 * mobile app. It exists because web signup exists: `signUp` and `signInWithOAuth` both create
 * an account with a `user_xxxxxxxx` placeholder and `username_set = false`, and an account
 * left in that state is unusable — it has a handle its owner never chose.
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
  const [status, setStatus] = useState<Availability>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleaned = username.trim().toLowerCase().replace(/^@/, '');

  // Debounced, because this fires per keystroke and each one is a round trip. 400ms is long
  // enough that typing a whole handle costs one check, short enough to feel immediate.
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
    const timer = setTimeout(() => {
      supabase
        .rpc('is_username_available', { p_username: cleaned })
        .then(({ data, error: rpcError }) => {
          if (cancelled) return;
          // A failed check must not read as "free" — that would send the user into a claim
          // that then fails at the database with a worse message.
          if (rpcError) setStatus('idle');
          else setStatus(data ? 'free' : 'taken');
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cleaned]);

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
          {status === 'invalid' && '3–30 characters: lowercase letters, numbers, underscore.'}
          {status === 'checking' && 'Checking…'}
          {status === 'free' && `@${cleaned} is yours.`}
          {status === 'taken' && 'That one is taken.'}
          {status === 'idle' && 'Lowercase letters, numbers and underscore.'}
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
