import notifee from '@notifee/react-native';
import { Platform } from 'react-native';

/**
 * The number on the app's home-screen / launcher icon.
 *
 * ── The two platforms do NOT work the same way, and cannot be made to ─────────
 *
 * iOS  — the badge is a real, app-settable integer. `setBadgeCount(n)` puts `n`
 *        on the icon immediately, whatever is or isn't in Notification Center.
 *        This is the only platform where the number is authoritative.
 *
 * Android — THERE IS NO API TO SET AN APP'S BADGE. Android derives the badge
 *        from the notifications currently in the tray: each one contributes its
 *        own `badgeCount` (`Notification.setNumber()`, set in
 *        `displayPushNotification`), and the launcher sums them. Consequently:
 *
 *          • `notifee.setBadgeCount()` is a documented NO-OP on Android — it
 *            returns early before touching native. Calling it here would look
 *            like it worked and silently do nothing.
 *          • The only thing this module can do on Android is CLEAR: when the
 *            unread total reaches zero, the notifications still sitting in the
 *            tray are stale, so we cancel them and the badge goes with them.
 *          • Stock Android (Pixel launcher) renders a DOT, never a number, no
 *            matter what we set — that is Google's deliberate design. Samsung
 *            One UI, MIUI, OxygenOS and most third-party launchers do render
 *            the number. Do not "fix" a missing number on a Pixel; it is the
 *            platform, and long-pressing the icon shows the count.
 *
 * ── Where the number comes from ──────────────────────────────────────────────
 * While the app is running, HomeScreen owns the live total (unread messages +
 * incoming friend requests + unread livil Bot activity) and pushes it here on
 * every change. When the app is NOT running, only the server can know the
 * total, so `send-push` computes it and ships it in the APNs payload — see
 * `supabase/functions/send-push/app.ts` and the `unread_badge_count_for` SQL
 * function. Those two must agree; each points at the other.
 */

/**
 * Every notification this app posts through notifee carries this id prefix.
 *
 * It exists so we can clear OUR notifications without touching anyone else's.
 * That matters more than it looks: `react-native-video`'s media3 session posts
 * the lock-screen player card from the same app, under the raw player's
 * `hashCode` as its id. A blanket `cancelAll()` would kill the user's music
 * notification — the exact failure the playback notes in CLAUDE.md warn about,
 * in reverse. Filtering on this prefix makes that impossible.
 */
export const LIVIL_NOTIFICATION_ID_PREFIX = 'livil:';

/**
 * Cancel only the notifications WE posted, leaving the media player card (and
 * anything else the app or OS has in the tray) alone.
 */
async function cancelOurNotifications(): Promise<void> {
  const displayed = await notifee.getDisplayedNotifications();
  const ids = displayed
    .map(entry => entry.id)
    .filter(
      (id): id is string =>
        typeof id === 'string' && id.startsWith(LIVIL_NOTIFICATION_ID_PREFIX),
    );

  if (ids.length === 0) { return; }

  // Passing explicit ids — never the no-argument form, which cancels
  // everything notifee can reach.
  await notifee.cancelAllNotifications(ids);
}

/**
 * Set the icon badge to `count`.
 *
 * Fail-safe by design: a wrong badge is a cosmetic bug, but an exception thrown
 * from the render effect that calls this would take a screen down. Every path
 * is wrapped and warns instead of throwing.
 */
export async function setAppBadgeCount(count: number): Promise<void> {
  const safe = Number.isFinite(count) && count > 0 ? Math.round(count) : 0;

  try {
    // Nothing unread → whatever is still in the tray is stale. Clearing it is
    // what removes the badge on Android, and stops iOS's Notification Center
    // showing rows the user has already read in-app.
    if (safe === 0) {
      await cancelOurNotifications();
    }

    if (Platform.OS === 'ios') {
      await notifee.setBadgeCount(safe);
    }
  } catch (e) {
    console.warn('[badge] setAppBadgeCount failed', e);
  }
}

/**
 * Sign-out / account-switch. The next user must not inherit the previous one's
 * number, and their notifications must not be readable from the tray.
 */
export async function clearAppBadge(): Promise<void> {
  await setAppBadgeCount(0);
}
