import { useState } from 'react';
import { Button } from './Button';
import { joinWaitlist } from '../auth/signIn';

const WELCOME_URL = 'https://livil-music.com/welcome.html';
const STORAGE_KEY = 'livil.earlyAccess.state';

/**
 * The gap this closes: someone who signs up on the web can PUBLISH but cannot LISTEN.
 * The app is in closed testing, so the Play listing resolves only for enrolled testers,
 * and nothing in the studio previously told a new creator that a path even existed. They
 * would upload a track and then find the store link dead, with no explanation.
 *
 * Deliberately reuses `joinWaitlist` rather than adding an authenticated variant. The
 * public `waitlist-join` function already inserts the row, sends the invite and records
 * `email_source: 'auto'` — so a creator asking from here appears in /ops exactly like a
 * marketing-page signup, and there is one send path to keep working instead of two.
 *
 * WHY IT CANNOT KNOW IF YOU ARE ALREADY A TESTER: no API reports Play opt-in state, and
 * consumer Google Groups have no membership API. So this shows to everyone and is
 * dismissible, rather than pretending to a knowledge it does not have. Asking twice is
 * harmless — `waitlist_request` returns NULL for an address already on the list, so a
 * repeat never sends a second email.
 */
type State = 'idle' | 'busy' | 'done' | 'error' | 'dismissed';

function initialState(): State {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'done' || saved === 'dismissed') return saved;
  } catch {
    /* private mode — the card simply shows again next visit */
  }
  return 'idle';
}

export function EarlyAccessCard({ email }: { email: string | undefined }) {
  const [state, setState] = useState<State>(initialState);

  // No address means no invite to send. Rendering a button that cannot work is worse than
  // rendering nothing.
  if (!email || state === 'dismissed') return null;

  function remember(next: State) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  async function onRequest() {
    setState('busy');
    const result = await joinWaitlist(email!);
    if (result.ok) {
      setState('done');
      remember('done');
    } else {
      setState('error');
    }
  }

  function onDismiss() {
    setState('dismissed');
    remember('dismissed');
  }

  return (
    <section className="panel early-access">
      <button
        type="button"
        className="early-access__close"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        ×
      </button>

      {state === 'done' ? (
        <>
          <h2 className="early-access__title">Check your inbox</h2>
          <p className="hint">
            We&apos;ve sent {email} everything you need to get Livil on your phone. It takes
            about two minutes.
          </p>
          <a
            className="btn btn--secondary btn--md"
            href={WELCOME_URL}
            target="_blank"
            rel="noopener"
          >
            Open the steps now
          </a>
        </>
      ) : (
        <>
          <h2 className="early-access__title">See how your music looks in the app</h2>
          <p className="hint">
            This is where you publish. The app is where it actually lands — your profile,
            your tracks in the feed, people playing and reacting to them. It&apos;s in closed
            testing, so the Play link only opens for enrolled testers. We&apos;ll email you
            the two-minute setup.
          </p>
          {state === 'error' && (
            <p className="hint">
              That didn&apos;t go through. Try again in a moment — your account is fine.
            </p>
          )}
          <Button type="button" busy={state === 'busy'} onClick={onRequest}>
            Get early access
          </Button>
        </>
      )}
    </section>
  );
}
