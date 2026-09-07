/**
 * Terms of Service acceptance.
 *
 * Reads and writes the append-only `terms_acceptances` log. See
 * supabase/migrations/20260907000000_terms_acceptance_log.sql for why that table has
 * no UPDATE or DELETE policy — the value of an acceptance record is entirely in what
 * cannot be done to it afterwards.
 *
 * The version a user accepted is compared against TERMS_VERSION, which is generated
 * from docs/terms.html by scripts/generate-terms.mjs. Publish a new version and every
 * existing user is asked again on next launch, with `source: 'reaccept'`.
 */
import { supabase } from '../../lib/supabase';
import { TERMS_VERSION } from '../constants/termsContent';
import { APP_VERSION_NAME } from '../constants/appVersion';

export type AcceptanceSource = 'signup' | 'reaccept' | 'upload';

/**
 * Has this user accepted the version currently shipping?
 *
 * FAILS CLOSED IS WRONG HERE, so this fails OPEN: on a network error it returns true,
 * letting the user into the app. The alternative — every offline launch dumping people
 * onto a legal wall they cannot dismiss — punishes the wrong person for the wrong
 * reason. A missed prompt is recoverable on the next launch; a lock-out is not.
 */
export async function hasAcceptedCurrentTerms(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('terms_acceptances')
      .select('version')
      .eq('user_id', userId)
      .eq('version', TERMS_VERSION)
      .in('source', ['signup', 'reaccept'])
      .limit(1)
      .maybeSingle();

    if (error) {
      console.log('[LIVIL][terms] acceptance check failed, allowing through:', error.message);
      return true;
    }
    return !!data;
  } catch (e) {
    console.log('[LIVIL][terms] acceptance check threw, allowing through:', (e as Error)?.message);
    return true;
  }
}

/**
 * Record an acceptance. THROWS on failure, deliberately.
 *
 * Unlike the check above, this must not fail silently: if the row does not land there
 * is no evidence, and letting the user through anyway would produce exactly the state
 * this table exists to prevent — someone using the app with no record that they ever
 * agreed. The screen surfaces the error and keeps the button available.
 *
 * `signup` and `reaccept` are unique per (user, version) at the database level, so a
 * double tap or a retry after a timeout that actually succeeded is harmless — the
 * duplicate is swallowed below rather than shown as an error.
 */
export async function recordTermsAcceptance(
  userId: string,
  source: AcceptanceSource,
): Promise<void> {
  const { error } = await supabase.from('terms_acceptances').insert({
    user_id: userId,
    version: TERMS_VERSION,
    source,
    app_version: APP_VERSION_NAME,
  });

  // 23505 = unique_violation: they already accepted this version. The desired state
  // already holds, so this is a success, not a failure.
  if (error && error.code !== '23505') {
    throw error;
  }
}
