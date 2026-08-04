/**
 * Did this page load land on a password-recovery link?
 *
 * WHY THIS IS A MODULE-LEVEL CONSTANT AND NOT A HOOK. With `flowType: 'pkce'` and
 * `detectSessionInUrl: true`, supabase-js consumes `?code=…` and strips it from the URL
 * during CLIENT CONSTRUCTION — which happens at import time, before React renders anything.
 * A `useState` initialiser in a component would therefore read a URL that has already been
 * cleaned, and always conclude "no recovery link". Reading `location` here, in a module that
 * imports nothing, and importing it FIRST in main.tsx is what guarantees we look before
 * supabase-js has been evaluated.
 *
 * WHAT IT DEFENDS. `/reset` is matched on path alone, ahead of the auth gate. Without this,
 * the only condition the screen checked was "is there a session" — so anyone at an
 * already-signed-in browser could type the URL and set a new password with no knowledge of
 * the current one, and the `signOut({ scope: 'global' })` that follows would lock the real
 * owner out of their phone too. Session access should not silently convert into a permanent
 * credential. Found by security review of PR #127.
 *
 * Not a substitute for server-side reauthentication on password change — that is a Supabase
 * Auth setting and the belt-and-braces half of this. This closes the path that exists today.
 */

/** True only when this document was opened by following a recovery link. */
export const ARRIVED_FROM_RECOVERY_LINK: boolean = (() => {
  try {
    // PKCE puts the exchange code in the query string.
    if (new URLSearchParams(window.location.search).has('code')) return true;
    // Implicit / older links put the grant in the fragment. Checked too, because the mobile
    // client uses implicit and a link generated for it can be opened in a browser.
    return /(^|[#&])type=recovery(&|$)/.test(window.location.hash);
  } catch {
    // Fail CLOSED: an unreadable location means we cannot prove a recovery arrival, and the
    // safe answer to "may this session change the password" is no.
    return false;
  }
})();
