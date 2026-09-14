/**
 * Merging credits into a row.
 *
 * Small enough to inline, extracted because the batch case is where it gets interesting:
 * "credits for all 12" runs this against twelve different lists, several of which may
 * already have per-row credits somebody added by hand, and getting it wrong silently drops
 * a credit — the exact failure this feature exists to prevent.
 */
import type { PendingCollaborator } from '@shared/constants/roles';

/**
 * Add `incoming` to `existing`, ignoring it if that person already holds that role.
 *
 * Identity is `clientId`, which the picker derives from the person AND the role — so the
 * same drummer credited for both Drums and Production is two credits, which is correct,
 * while adding Drums twice is one.
 *
 * Appends rather than replaces. The cover-art batch control overwrites, because art is one
 * slot; credits are a list, and overwriting would throw away work already done on a row.
 *
 * One person holding several roles is the normal case, not an edge case — the guitarist who
 * also wrote it. The picker briefly hid an already-credited person from its search, which
 * made the second credit impossible to add; it now greys out only the roles they already
 * hold.
 */
export function mergeCredits(
  existing: PendingCollaborator[],
  incoming: PendingCollaborator,
): PendingCollaborator[] {
  if (existing.some(c => c.clientId === incoming.clientId)) return existing;
  return [...existing, incoming];
}
