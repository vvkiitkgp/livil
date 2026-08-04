import { useEffect, useState } from 'react';
import { Button } from './Button';

/**
 * "Didn't get it? Send again" — with the cooldown the server is going to enforce anyway.
 *
 * WHY THE COUNTDOWN IS NOT DECORATION. Supabase's SMTP settings carry a "Minimum interval
 * per user" (60s for us), and a resend inside that window is REFUSED. A plain button would
 * therefore fail for the most impatient user in the most confusing way: they press it
 * because the first mail has not arrived, and get an error implying they did something
 * wrong. Showing the wait turns a rejection into an expectation.
 *
 * Deliberately reports success without saying whether an email was actually sent — the
 * password-reset flow must not become an account-existence oracle, and the copy on these
 * screens is already careful about that. The button confirms the ACTION, not the delivery.
 */
export function ResendButton({
  onResend,
  cooldownSeconds = 60,
  idleLabel = 'Send it again',
}: {
  onResend: () => Promise<void>;
  cooldownSeconds?: number;
  idleLabel?: string;
}) {
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sentOnce, setSentOnce] = useState(false);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRemaining(s => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);

  async function onClick() {
    setBusy(true);
    // Start the clock regardless of outcome. The server counts the attempt either way, so a
    // failed-looking resend that leaves the button live just invites a second rejection.
    try {
      await onResend();
    } finally {
      setBusy(false);
      setSentOnce(true);
      setRemaining(cooldownSeconds);
    }
  }

  return (
    <>
      <Button variant="ghost" busy={busy} disabled={remaining > 0} onClick={onClick}>
        {remaining > 0 ? `Send again in ${remaining}s` : idleLabel}
      </Button>
      {sentOnce && remaining > 0 && (
        <p className="hint" role="status">
          Sent. If it still doesn&apos;t arrive, check spam — and confirm the address above is
          the one you signed up with.
        </p>
      )}
    </>
  );
}
