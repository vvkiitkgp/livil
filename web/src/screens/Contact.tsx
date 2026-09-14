import { useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { TextArea } from '../components/TextField';
import { MESSAGE_MAX, sendTeamMessage } from '../data/teamMessages';

/**
 * Write to the Livil team.
 *
 * REPLACES A `mailto:`, AND THAT IS THE POINT. Mobile's Settings → Contact support opens the
 * OS mail client, which drops everything on the way: who is writing, whether they ever
 * finished, whether they gave up when a compose window covered the app. A row in Postgres
 * costs nothing and is observable in /studio/ops.
 *
 * NO REPLY THREAD, deliberately. Replies happen by email from the operator's own client. A
 * threaded inbox for a handful of messages a week would be more product than the problem
 * needs, and every unanswered thread would then be visible to the sender as silence.
 *
 * The send is one-way in the UI too: there is no "your messages" list, because the SELECT
 * policy is ops-only and a screen showing a sender their own message would need a policy
 * that exists purely to serve it.
 */
export function Contact() {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = body.trim();
  const tooLong = trimmed.length > MESSAGE_MAX;
  const canSend = trimmed.length > 0 && !tooLong && !busy;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendTeamMessage(body);
      setSent(true);
      setBody('');
    } catch (err) {
      // Surfaced, not swallowed. This screen exists because the previous path lost messages
      // silently; a send that fails quietly would reproduce the exact fault it replaces.
      setError(err instanceof Error ? err.message : 'Could not send that. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page fade-up">
      <header className="page__head">
        <div>
          <p className="kicker">Backstage door</p>
          <h1 className="display page__title">Message the team</h1>
        </div>
      </header>

      <section className="panel formcol">
        {sent ? (
          <>
            <p className="dropzone__title">Sent — thank you.</p>
            <p className="hint">
              It goes straight to the founder, not a queue. If it needs a reply you&apos;ll get
              one by email, at the address on your account.
            </p>
            <div className="filerow">
              <Button variant="secondary" onClick={() => setSent(false)}>
                Write another
              </Button>
            </div>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <p className="hint">
              Bugs, things that feel wrong, features you wish existed, or what nearly made you
              give up. Livil is built by one person and read by the same person.
            </p>

            <TextArea
              label="Your message"
              rows={9}
              autoFocus
              required
              placeholder="What's on your mind?"
              value={body}
              onChange={e => setBody(e.target.value)}
            />

            <p className="counter" data-over={tooLong || undefined}>
              {trimmed.length} / {MESSAGE_MAX}
            </p>

            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}

            <div className="filerow">
              <Button type="submit" size="lg" disabled={!canSend} busy={busy}>
                Send
              </Button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
