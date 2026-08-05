/**
 * Waitlist reads and outreach state, for the ops dashboard.
 *
 * READ ACCESS IS THE DATABASE'S DECISION, NOT THIS FILE'S. `waitlist` has no SELECT policy
 * for anon and one for `authenticated` gated on `is_ops()` (migration 20260805000000). A
 * non-ops user running these functions gets an empty array, not an error — PostgREST filters
 * by policy rather than rejecting. That is why the /ops route can ship publicly: there is
 * nothing to leak by loading the page, and hiding the nav link is cosmetics, not security.
 *
 * No service_role anywhere, per ADR-0008 §4. The dashboard is an ordinary authenticated
 * client and the operator's own session is the credential.
 */
import { supabase } from '../supabase';

export type WaitlistEntry = {
  id: string;
  email: string;
  createdAt: string;
  /** Non-null once Resend accepted the invite. The only reliable "we contacted them". */
  emailSentAt: string | null;
  /** Last failure text, cleared on a later success. */
  emailError: string | null;
  emailAttempts: number;
};

/**
 * Everyone who has ever asked to join, newest first.
 *
 * Unpaginated deliberately: the list is single digits today and the ordering index exists.
 * Add a range once it is long enough that scrolling it is a chore — not before, because a
 * pager on six rows is furniture.
 */
export async function fetchWaitlist(): Promise<WaitlistEntry[]> {
  const { data, error } = await supabase
    .from('waitlist')
    .select('id, email, created_at, email_sent_at, email_error, email_attempts')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map(row => ({
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
    emailSentAt: row.email_sent_at,
    emailError: row.email_error,
    emailAttempts: row.email_attempts,
  }));
}

/**
 * Record the outcome of a send attempt.
 *
 * `attempts` is incremented from the value the caller already holds rather than read back
 * first. A lost increment under concurrent clicks is not worth a round trip — this is a
 * diagnostic counter, and there is exactly one operator.
 *
 * On success `email_error` is explicitly nulled: a stale error next to a green "sent" badge
 * is worse than no error at all, because it makes the operator distrust the badge.
 */
export async function recordSendResult(
  entry: WaitlistEntry,
  result: { ok: true } | { ok: false; error: string },
): Promise<WaitlistEntry> {
  const patch = result.ok
    ? {
        email_sent_at: new Date().toISOString(),
        email_error: null,
        email_attempts: entry.emailAttempts + 1,
      }
    : {
        email_error: result.error.slice(0, 500),
        email_attempts: entry.emailAttempts + 1,
      };

  const { data, error } = await supabase
    .from('waitlist')
    .update(patch)
    .eq('id', entry.id)
    .select('id, email, created_at, email_sent_at, email_error, email_attempts')
    .single();

  if (error) throw error;

  return {
    id: data.id,
    email: data.email,
    createdAt: data.created_at,
    emailSentAt: data.email_sent_at,
    emailError: data.email_error,
    emailAttempts: data.email_attempts,
  };
}
