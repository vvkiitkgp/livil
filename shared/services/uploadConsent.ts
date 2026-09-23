/**
 * The streaming grant, recorded once per upload.
 *
 * `docs/terms.html` §2 already takes a worldwide, non-exclusive, royalty-free licence to
 * host, store, reproduce and stream anything uploaded, and every account accepted it at
 * signup. So this is not a new right — it is a per-upload reaffirmation, and the
 * difference is entirely evidential:
 *
 *   "they accepted the terms two years ago"
 *   "they confirmed, on THIS track, on THIS date, that they were granting us the right
 *    to stream it"
 *
 * The second is what a rights holder's lawyer asks about, and it is the one Livil could
 * not produce until now.
 *
 * ── WHY IT LIVES IN `terms_acceptances` ────────────────────────────────────
 *
 * Because that table is already the evidential one: versions are pinned by a sha256 of
 * the exact published text, rows are append-only, and UPDATE is blocked by a trigger that
 * binds the OPERATOR as well as the client. A separate table would have meant
 * reimplementing all of that, worse.
 *
 * `source='upload'` was reserved there from the beginning. This is that row.
 *
 * ── WHY THE CLIENT IS A PARAMETER ──────────────────────────────────────────
 *
 * Same reason as `./copyrightScan`: the mobile app has never called
 * `configureLivilClient()`, so a `livil()` call here would throw on the phone. Passing
 * the client keeps one implementation for both uploaders, which is the whole point —
 * a consent captured on web and missed on mobile is not a consent policy.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

// deno-lint-ignore no-explicit-any
export type ConsentClient = SupabaseClient<any, any, any>;

/**
 * Record that the uploader granted the streaming licence for this track.
 *
 * NEVER THROWS. The track is already uploaded and the post is about to exist; failing the
 * publish because a consent row did not land would cost a creator their upload over
 * bookkeeping. It returns whether it landed so the caller can log — and a missing row is
 * visible as an absence in the operator view, which is the honest way for this to fail.
 *
 * Idempotent: a partial unique index on `(user_id, version, track_id) where
 * source='upload'` means a retry or a double-tap writes one row. `23505` is the desired
 * state already holding, so it is success rather than failure — the same reasoning
 * `recordTermsAcceptance` uses for signup.
 *
 * The server pins WHO and WHEN, and a trigger refuses a track the caller does not own, so
 * nothing here is taken on the client's word.
 */
export async function recordUploadConsent(
  db: ConsentClient,
  trackId: string,
  version: string,
  appVersion?: string | null,
): Promise<boolean> {
  if (!trackId || !version) { return false; }
  try {
    const { error } = await db.from('terms_acceptances').insert({
      version,
      source: 'upload',
      track_id: trackId,
      app_version: appVersion ?? null,
    });
    if (!error) { return true; }
    // 23505 = unique_violation: already recorded for this track and version.
    return (error as { code?: string }).code === '23505';
  } catch {
    return false;
  }
}
