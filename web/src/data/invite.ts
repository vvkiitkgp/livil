/**
 * Invite delivery — the client half.
 *
 * The mail is sent by the `waitlist-invite` edge function, not from here, for one reason:
 * the Resend API key. A key shipped to a browser bundle is a public key, and anyone holding
 * it can send mail as livil-music.com. The function holds it; this file holds nothing.
 *
 * The function verifies the caller's JWT and re-checks `is_ops()` server-side. That check is
 * NOT a duplicate of the RLS policy protecting the table — this call sends an email, which
 * no row policy governs. Without it, any signed-in user could invoke the function and use
 * the sending domain as an open relay.
 */
import { supabase } from '../supabase';

export type SendResult = { ok: true } | { ok: false; error: string };

/**
 * Never throws. The caller records whatever comes back as the attempt's outcome, and a
 * thrown exception would lose the reason — which is the only thing that makes a failed row
 * actionable in the dashboard.
 */
export async function sendInvite(email: string): Promise<SendResult> {
  try {
    const { data, error } = await supabase.functions.invoke('waitlist-invite', {
      body: { email },
    });

    if (error) return { ok: false, error: error.message ?? 'Edge function call failed.' };
    if (data && typeof data === 'object' && 'error' in data) {
      return { ok: false, error: String((data as { error: unknown }).error) };
    }
    return { ok: true };
  } catch (e) {
    // A network failure or a function that is not deployed yet lands here. Reported rather
    // than swallowed so the dashboard shows "failed: …" instead of a silent no-op.
    return { ok: false, error: e instanceof Error ? e.message : 'Could not reach the sender.' };
  }
}
