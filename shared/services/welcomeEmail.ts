/**
 * The client half of the welcome email, shared by both clients.
 *
 * Livil sends one welcome email per account, on the account's FIRST CONFIRMED,
 * AUTHENTICATED SESSION rather than when `auth.signUp` returns — the address is
 * unverified at signup, and the confirmation email is the one the person has to act on.
 * The reasoning is written out in
 * `supabase/migrations/20260807000000_welcome_email_on_signup.sql`.
 *
 * WHAT THIS FUNCTION IS AND IS NOT. It is a nudge, not a decision. The `welcome-email`
 * edge function takes no input and derives everything from the caller's JWT; the
 * database decides — atomically, once — whether this particular call is the one that
 * sends. So calling it twice, from two devices, or on every launch forever is harmless
 * by construction. The guards below exist to avoid pointless round trips, NOT to
 * establish correctness. Never move the once-per-account logic into a client.
 *
 * WHY IT TAKES THE CLIENT AS A PARAMETER, against rule 2 in `shared/README.md`. Modules
 * here normally call `livil()`, but the mobile app has never called
 * `configureLivilClient()` — it consumes only the pure shared modules (`waveformDsp`,
 * `constants/roles`) — and installing a process-wide client at app startup is a far
 * larger change than this feature earns. An explicit parameter costs one argument at two
 * call sites and drags nothing into the mobile bundle. Switch to `livil()` if and when
 * mobile installs a client for real.
 */
import type { Session, SupabaseClient } from '@supabase/supabase-js';

/**
 * Accepts any Supabase client rather than `LivilClient`, because the two apps build
 * theirs differently and this only reaches `functions.invoke` — no table, no generated
 * type. Widening here keeps the mobile client (untyped against `Database`) from needing
 * a cast at the call site.
 */
type AnyClient = Pick<SupabaseClient, 'functions'>;

/**
 * Accounts nudged in this process. Purely a de-duplicator for the several times a
 * session resolves during one run — cold start, token refresh, a second tab. It is
 * intentionally in memory and not persisted: persistence would imply the client is
 * responsible for not sending twice, and it is not.
 */
const nudged = new Set<string>();

/**
 * Ask the server whether this account is owed a welcome email, and let it send one.
 *
 * Fire-and-forget: never throws, never reports. Someone who does not receive a welcome
 * email has lost nothing they can act on, so there is nothing worth interrupting a
 * sign-in to tell them. Failures are recorded server-side in `welcome_emails.error`,
 * which is where they are actually actionable.
 */
export async function nudgeWelcomeEmail(
  client: AnyClient,
  session: Session | null,
): Promise<void> {
  const user = session?.user;
  if (!user?.id) return;

  // Mirrors the server's own gate. Cheap to check here, and it keeps an unconfirmed
  // account from invoking the function on every launch until it is confirmed.
  if (!user.email || !user.email_confirmed_at) return;

  if (nudged.has(user.id)) return;
  nudged.add(user.id);

  try {
    const { error } = await client.functions.invoke('welcome-email');
    if (error) {
      // WARN, don't throw. The caller is a sign-in path and a missing welcome is not
      // worth interrupting it — but silence is not the same as swallowing.
      //
      // This line exists because of a real outage: the function shipped without CORS
      // handling, so every browser preflight was rejected and the POST was never sent.
      // `functions.invoke` RESOLVES with `{ error }` rather than throwing (D-54's exact
      // shape, verified in FunctionsClient), so the original bare `catch` never ran and
      // the failure produced no email, no ledger row and no console output. It took a
      // database query and a hand-rolled preflight to find. One warn would have named it.
      console.warn('[welcome-email] invoke failed; no welcome sent this session', error);
    }
  } catch (e) {
    // The network layer beneath invoke. Same reasoning: report, never interrupt.
    console.warn('[welcome-email] invoke threw', e);
  }
}

/** Test-only: forget which accounts have been nudged in this process. */
export function resetWelcomeEmailNudgeForTests(): void {
  nudged.clear();
}
