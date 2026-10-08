/**
 * Why people deleted their accounts — the optional question on the way out (mobile,
 * DeleteAccountScreen → ExitFeedbackModal).
 *
 * ACCESS IS THE DATABASE'S DECISION, NOT THIS FILE'S — same posture as `teamMessages.ts`.
 * `account_exit_feedback` has a SELECT policy gated on `is_ops()` and no write policy at all
 * (migration 20261012000000), so a non-ops caller gets an empty array, not an error.
 *
 * A plain table read, not an RPC: unlike team messages there is no one to join to. The
 * row is anonymous by design once the account is gone — `user_id` is SET NULL by the
 * deletion — so a NULL user_id is the "they went through with it" signal, and a non-NULL
 * one means they answered and then backed out (or the deletion failed).
 */
import { supabase } from '../supabase';
import { EXIT_REASONS, type ExitReasonId } from '@shared/constants/exitFeedback';

export type ExitFeedback = {
  id: string;
  reason: ExitReasonId | null;
  note: string | null;
  platform: string | null;
  accountAgeDays: number | null;
  createdAt: string;
  /** False when the person answered but their account still exists. */
  accountDeleted: boolean;
};

const LABELS = new Map<string, string>(EXIT_REASONS.map(r => [r.id, r.label]));

/** The reason as people saw it on the phone. An id this build does not know is shown raw. */
export function exitReasonLabel(reason: string | null): string {
  if (!reason) return 'No reason picked';
  return LABELS.get(reason) ?? reason;
}

/**
 * Everything, newest first. Unpaginated on purpose, matching `fetchTeamMessages`: one row
 * per deleted account is a small list. Add a range when scrolling it becomes a chore.
 */
export async function fetchExitFeedback(): Promise<ExitFeedback[]> {
  const { data, error } = await supabase
    .from('account_exit_feedback')
    .select('id, reason, note, platform, account_age_days, created_at, user_id')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []).map(row => ({
    id: row.id,
    reason: row.reason as ExitReasonId | null,
    note: row.note,
    platform: row.platform,
    accountAgeDays: row.account_age_days,
    createdAt: row.created_at,
    accountDeleted: row.user_id === null,
  }));
}
