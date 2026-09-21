/**
 * Granting and revoking profile badges, and knowing how many slots are left.
 *
 * Every call goes through a SECURITY DEFINER function that checks `is_ops()` itself, so the
 * same posture as the rest of the dashboard holds: a non-ops visitor loading /studio/ops
 * sees an empty status and a grant button that refuses, not a privileged surface guarded by
 * the UI. No service_role key is involved (ADR-0008 §4).
 *
 * THE CAP IS THE DATABASE'S JOB, NOT THIS FILE'S. `grant_badge` takes a transaction-scoped
 * advisory lock and counts before it inserts, so two operators clicking at the same moment
 * cannot both pass a stale check. Do not add a "remaining > 0" guard here and treat it as
 * the enforcement — it is a hint for the button's label, and the button is allowed to be
 * wrong.
 *
 * GENERIC OVER BADGES BY DESIGN. A new badge is a row in `badge_kinds` plus a renderer on
 * the client; nothing in this file changes. Which is also why `remaining` is nullable —
 * an uncapped badge has no slots to run out of.
 */
import { supabase } from '../supabase';

/**
 * The badges this dashboard can grant, in the order the roster shows them.
 *
 * Adding one is an entry here plus a row in `badge_kinds`; the ops table builds its columns
 * from this list, so nothing else changes. `label` is what the operator reads — it appears
 * in the column header AND inside the button ("Grant First 100"), because a button reading
 * just "Grant" in a table with two badge columns tells you nothing without counting across.
 */
export const FIRST_100 = 'first_100';
export const VERIFIED = 'verified';

export type OpsBadge = { badge: string; label: string };

export const OPS_BADGES: OpsBadge[] = [
  { badge: FIRST_100, label: 'First 100' },
  { badge: VERIFIED, label: 'Verified' },
];

export type GrantResult = 'granted' | 'already' | 'full';
export type RevokeResult = 'revoked' | 'not_held';

export type BadgeStatus = {
  /** Null when the badge is uncapped. */
  slotLimit: number | null;
  /** Grants ever made. Only ever goes up. */
  grantedEver: number;
  /** Badges currently visible on a profile: granted, minus revoked and deleted accounts. */
  live: number;
  /**
   * Slots currently held — what the cap is actually measured against.
   *
   * For First 100 this is live holders PLUS the grants of people who deleted their
   * accounts, because those slots are never given back. So `occupied` can exceed `live`,
   * and the gap between them is exactly the number of departed holders.
   */
  occupied: number;
  /** Null when uncapped. Otherwise slot_limit - occupied. */
  remaining: number | null;
};

/**
 * Turn a provider error into something an operator can act on.
 *
 * PostgREST answers a call to a function it has never heard of with "Could not find the
 * function public.grant_badge(...) in the schema cache" — accurate, unreadable, and about a
 * cache rather than the actual situation. There is one realistic cause here and it has a
 * two-minute fix, so say that. Everything else passes through rather than being flattened
 * into a generic apology.
 */
function badgeError(error: { message?: string; code?: string } | null): Error {
  const message = error?.message ?? 'Unknown error';
  if (error?.code === 'PGRST202' || /schema cache/i.test(message)) {
    return new Error(
      'The badge migration has not been applied to this database yet — run '
      + 'supabase/migrations/20260919000000_profile_badges_first_100.sql, then reload.',
    );
  }
  if (/not_authorized/i.test(message)) {
    return new Error('Your account is not in ops_users, so it cannot grant or revoke badges.');
  }
  if (/no_such_badge/i.test(message)) {
    return new Error('That badge does not exist in badge_kinds.');
  }
  return new Error(message);
}

export async function fetchBadgeStatus(badge: string): Promise<BadgeStatus | null> {
  const { data, error } = await supabase.rpc('badge_status', { p_badge: badge });
  if (error) throw badgeError(error);
  const row = (data ?? [])[0];
  // Empty means either a non-ops caller or an unknown badge. Null rather than a fabricated
  // zero: "no slots left" and "we are not allowed to know" must not render the same.
  if (!row) return null;
  return {
    slotLimit: row.slot_limit === null ? null : Number(row.slot_limit),
    grantedEver: Number(row.granted_ever ?? 0),
    live: Number(row.live ?? 0),
    occupied: Number(row.occupied ?? 0),
    remaining: row.remaining === null ? null : Number(row.remaining),
  };
}

/**
 * Which of these accounts currently hold the badge.
 *
 * Reads the same function the app reads, which returns `(user_id, badge)` and nothing else
 * — so this dashboard cannot show award order either. Deliberate: an operator screenshot is
 * as good a leak as an API response.
 */
export async function fetchBadgeHolders(userIds: string[], badge: string): Promise<Set<string>> {
  const byBadge = await fetchAllBadgeHolders(userIds);
  return byBadge[badge] ?? new Set();
}

/**
 * Every badge, for every given profile, in ONE call.
 *
 * `badges_for_profiles` already returns all of a person's badges, so asking per badge would
 * be N round trips for data one request carries — and the roster asks about every account
 * on the page at once.
 */
export async function fetchAllBadgeHolders(
  userIds: string[],
): Promise<Record<string, Set<string>>> {
  const byBadge: Record<string, Set<string>> = {};
  for (const { badge } of OPS_BADGES) { byBadge[badge] = new Set(); }
  if (userIds.length === 0) return byBadge;

  const { data, error } = await supabase.rpc('badges_for_profiles', { p_user_ids: userIds });
  if (error) throw badgeError(error);

  for (const row of (data ?? []) as { user_id: string; badge: string }[]) {
    // A badge the server knows and this dashboard does not still gets an entry here — it
    // simply never surfaces, because the table builds its columns from OPS_BADGES rather
    // than from this map.
    (byBadge[row.badge] ??= new Set()).add(row.user_id);
  }
  return byBadge;
}

export async function grantBadge(userId: string, badge: string): Promise<GrantResult> {
  const { data, error } = await supabase.rpc('grant_badge', { p_user_id: userId, p_badge: badge });
  if (error) throw badgeError(error);
  return data as GrantResult;
}

export async function revokeBadge(userId: string, badge: string): Promise<RevokeResult> {
  const { data, error } = await supabase.rpc('revoke_badge', { p_user_id: userId, p_badge: badge });
  if (error) throw badgeError(error);
  return data as RevokeResult;
}
