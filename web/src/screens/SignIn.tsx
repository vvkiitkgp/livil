import { useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { ResendButton } from '../components/ResendButton';
import { PasswordField, TextField } from '../components/TextField';
import {
  PLAY_STORE_URL,
  joinWaitlist,
  resendConfirmation,
  signInWithGoogle,
  signInWithPassword,
  signUpWithPassword,
} from '../auth/signIn';
import {
  normalizeUsername,
  useUsernameAvailability,
  usernameHint,
} from '../auth/useUsernameAvailability';

/** Web-only. Mobile still accepts 6; see the note on the password field below. */
const MIN_PASSWORD = 8;

/**
 * Sign-in and sign-up, plus the two exits for anyone without an account.
 *
 * THE SIGNUP FORM MATCHES THE MOBILE ONE FIELD FOR FIELD — display name, handle, email,
 * password — and that is not cosmetic. The handle is what makes an account usable and it is
 * PERMANENT, so the two clients must agree on when it is chosen. Collecting it here puts it
 * in the signUp metadata, where `handle_new_user()` claims it and flips `username_set`;
 * `ChooseUsername` is then only what it was built for — the OAuth path, where the provider
 * gives us no handle to use.
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
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState<null | 'password' | 'google'>(null);
  const [error, setError] = useState<string | null>(null);
  const { cleaned: cleanedUsername, status: usernameStatus } =
    useUsernameAvailability(username);

  // Only once the second field has something in it — flagging a mismatch against an empty
  // box means shouting at someone who is still typing.
  const mismatch = signingUp && confirm.length > 0 && password !== confirm;

  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistDone, setWaitlistDone] = useState(false);
  const [waitlistBusy, setWaitlistBusy] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy('password');

    if (signingUp) {
      // Checked here as well as on the button: the browser can submit a form with Enter
      // before a disabled state has been re-rendered, and creating the account with the
      // wrong password is unrecoverable without a reset.
      if (password !== confirm) {
        setBusy(null);
        setError('Those two passwords don’t match.');
        return;
      }
      const created = await signUpWithPassword({
        email,
        password,
        displayName,
        username: cleanedUsername,
      });
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
            Confirm {email.trim()} and @{cleanedUsername} is yours.
          </p>
        </header>
        <section className="card">
          <p className="hint">
            The link brings you straight back here. Check spam if it doesn&apos;t arrive.
          </p>
          {/* `resend`, not a second `signUp`: signing up again with the same address hits
              Supabase's anti-enumeration path and returns a success that sends nothing. */}
          <ResendButton onResend={() => resendConfirmation(email).then(() => undefined)} />
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              // Clearing this is what actually leaves the screen — `confirmSent` is checked
              // before `mode`, so flipping the mode alone would change nothing visible.
              setConfirmSent(false);
              onToggleMode();
            }}
          >
            Back to sign in
          </Button>
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
        {signingUp && (
          <>
            <TextField
              label="Display name"
              autoComplete="name"
              required
              // Matches `profiles_display_name_len`. Without it the constraint fires inside
              // handle_new_user(), which aborts the whole signup transaction and surfaces as
              // an opaque 500 — a dead end with no clue which field caused it.
              maxLength={80}
              placeholder="What people see"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
            />
            <TextField
              label="Username"
              autoComplete="off"
              autoCapitalize="none"
              required
              maxLength={30}
              placeholder="yourname"
              value={username}
              // Normalised on the way in, so the field can never show a handle that differs
              // from the one the database will store.
              onChange={e => setUsername(normalizeUsername(e.target.value))}
            />
            {/* Permanence stated BEFORE the fact. A trigger refuses any later change, so
                discovering it afterwards means discovering it too late. */}
            <p className="hint" data-status={usernameStatus}>
              {usernameStatus === 'idle'
                ? 'Your permanent handle — it can’t be changed later.'
                : usernameHint(usernameStatus, cleanedUsername)}
            </p>
          </>
        )}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        <PasswordField
          label="Password"
          autoComplete={signingUp ? 'new-password' : 'current-password'}
          required
          minLength={signingUp ? MIN_PASSWORD : undefined}
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
        {signingUp && (
          <PasswordField
            label="Confirm password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
          />
        )}
        {/* Mobile still asks for 6. Deliberately NOT matched downward — this is the client
            that holds unreleased masters, and loosening a password floor to make two forms
            look alike is the wrong direction to resolve a mismatch. Raising mobile to 8 is
            a separate change in propose-only code. */}
        {signingUp && (
          <p className="hint" data-status={mismatch ? 'taken' : undefined}>
            {mismatch ? 'Those two don’t match.' : `At least ${MIN_PASSWORD} characters.`}
          </p>
        )}

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <Button
          type="submit"
          size="lg"
          busy={busy === 'password'}
          // Submitting mid-check would race the availability RPC; submitting on a known-bad
          // handle wastes a round trip to be told what the field already says.
          disabled={
            signingUp &&
            (mismatch ||
              usernameStatus === 'checking' ||
              usernameStatus === 'taken' ||
              usernameStatus === 'invalid')
          }
        >
          {signingUp ? 'Create account' : 'Sign in'}
        </Button>

        {/* Privacy Policy only, and linked for real. Mobile's signup shows "Terms of
            Service and Privacy Policy" as styled text with NO press handler, and there is
            no terms.html in docs/ — so the mobile copy promises two documents, links
            neither, and one of them does not exist. Naming only what we actually publish is
            the honest version until a Terms page is written. */}
        {signingUp && (
          <p className="hint hint--center">
            By creating an account you agree to our{' '}
            <a href="/privacy-policy.html" target="_blank" rel="noopener noreferrer">
              Privacy Policy
            </a>
            .
          </p>
        )}

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

        {/* Livil is in closed testing, so the Play listing above resolves ONLY for enrolled
            testers — for everyone else it reads "app not available". That makes this the
            only working path for a new visitor, which is why it is set apart and carries a
            primary button rather than sitting as a ghost-weight afterthought under the
            store link. The loud control must not be the one that dead-ends. */}
        {waitlistDone ? (
          <div className="waitlist waitlist--done">
            <p className="waitlist__lede">
              <strong>You're on the list.</strong> The invite is already on its way — check
              your inbox, and spam if it isn't there in a minute.
            </p>
          </div>
        ) : (
          <form className="waitlist" onSubmit={onWaitlist}>
            <p className="waitlist__lede">
              <strong>Not a tester yet?</strong> Livil is in closed testing, so the store
              link above only opens for enrolled testers. Leave your email and the invite
              lands in your inbox straight away.
            </p>
            <TextField
              label="Email"
              type="email"
              required
              placeholder="you@example.com"
              value={waitlistEmail}
              onChange={e => setWaitlistEmail(e.target.value)}
            />
            <Button type="submit" busy={waitlistBusy}>
              Join the waitlist
            </Button>
          </form>
        )}
      </section>
    </main>
  );
}
