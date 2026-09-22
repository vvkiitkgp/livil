/**
 * Pushing a badge announcement to the holder's phone.
 *
 * WHY THIS LIVES IN THE DASHBOARD AT ALL. Every other push in Livil is dispatched from the
 * SENDER's device — you like a post, your phone calls send-push. A badge has no such
 * device: it is awarded by an operator on the web, and the recipient's phone has no idea
 * anything happened. So the dashboard is the only client in the loop.
 *
 * FAIL-SAFE, ALWAYS. The grant is the thing the operator asked for, and it has already
 * committed by the time this runs. The in-app notification is written by the database and
 * is not affected either way. A push that does not send is a lost buzz; an error surfaced
 * here would read as "the grant failed", which would be false. Logged, never thrown.
 *
 * WHAT THIS IS NOT: a guarantee. The holder may have no device token (nobody who has only
 * used the web has one), may have notifications switched off, or may be on iOS before its
 * push entitlement ships. Any of those is a silent no-op by design — which is exactly why
 * the operator-facing copy says the notice will appear in their activity feed, and does not
 * promise their phone rang.
 */
import { supabase } from '../supabase';
import { VERIFIED } from './profileBadges';

export async function sendBadgePush(
  recipientUserId: string,
  badge: string,
  badgeLabel: string,
): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('send-push', {
      body: {
        recipientUserId,
        kind: 'badge_granted',
        // The server authorizes on WHO is sending and whether the recipient really holds a
        // badge; it does not read these strings for anything but display, and clamps them.
        title: 'Livil',
        // Branch on the badge KEY, never on the label. This compared `badgeLabel ===
        // 'Verified'` until the badge was renamed to "Verified Artist", at which point the
        // comparison would have quietly stopped matching and the verified branch would have
        // died with nothing failing — a display string is not an identifier.
        body: badge === VERIFIED
          ? 'Your account is now verified ✓'
          : `You received the ${badgeLabel} badge 🎉`,
        data: { route: 'ActivityCenter' },
      },
    });
    if (error) {
      console.warn('[push] badge notification was not sent', error.message);
    }
  } catch (e) {
    console.warn('[push] badge notification threw', e);
  }
}
