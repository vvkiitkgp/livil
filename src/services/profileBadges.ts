import { supabase } from '../../lib/supabase';

const db = supabase as any;

/**
 * Badges shown beside a profile avatar.
 *
 * WHAT THIS DELIBERATELY CANNOT TELL YOU: when a badge was awarded, or in what
 * order. `badges_for_profiles` returns `(user_id, badge)` and nothing else, and
 * `profile_badges` is deny-all, so the award order is not merely omitted from
 * this module — it is unreachable from any client. That is a product rule: every
 * First 100 holder is presented identically, so nobody can work out who was 2nd
 * and who was 99th. Do not add an `awardedAt` here; there is nothing to read.
 *
 * ADDING A BADGE: a row in `badge_kinds` server-side, then an entry here and a
 * renderer in ProfileBadgeRail's registry. This list is the CLIENT's registry of
 * badges it can draw, which is why an unrecognised badge is dropped rather than
 * passed through — a badge added server-side and released before the app knows it
 * would otherwise reach the rail, take a slot and a tap target, and render nothing.
 */
export const PROFILE_BADGES = ['first_100'] as const;
export type ProfileBadge = (typeof PROFILE_BADGES)[number];

function isProfileBadge(value: unknown): value is ProfileBadge {
  return typeof value === 'string' && (PROFILE_BADGES as readonly string[]).includes(value);
}

/**
 * Live badges for the given profiles, as a map of user id to badge list.
 *
 * FAIL-SAFE, not throwing. A badge is decoration on a profile that has already
 * loaded; if this call fails the profile should render without it rather than
 * take the screen down. Same treatment as the waveform backfill — see
 * kb/standards/data-access.md on choosing an error mode.
 */
export async function fetchProfileBadges(
  userIds: string[],
): Promise<Record<string, ProfileBadge[]>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) { return {}; }

  try {
    const { data, error } = await db.rpc('badges_for_profiles', { p_user_ids: ids });
    if (error) { throw error; }

    const byUser: Record<string, ProfileBadge[]> = {};
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const userId = row.user_id as string | null;
      const badge = row.badge;
      if (!userId || !isProfileBadge(badge)) { continue; }
      (byUser[userId] ??= []).push(badge);
    }
    return byUser;
  } catch (e) {
    console.warn('[profileBadges] could not load badges', e);
    return {};
  }
}

/** Convenience for the common single-profile case. */
export async function fetchBadgesForUser(userId: string): Promise<ProfileBadge[]> {
  const byUser = await fetchProfileBadges([userId]);
  return byUser[userId] ?? [];
}
