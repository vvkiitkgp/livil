/**
 * The moderation queue — reports from every surface, in one list.
 *
 * WHY THIS FILE EXISTS. `post_reports` shipped in June with an INSERT policy, no SELECT
 * policy, and a comment saying moderation reads would happen "via service role / admin
 * tooling later". Nothing read it for two months. Google Play's UGC policy requires a
 * moderation PROCESS, and a queue nobody can see is not one.
 *
 * ACCESS IS THE DATABASE'S DECISION, NOT THIS FILE'S — same posture as `opsUsers.ts`.
 * Both RPCs are SECURITY DEFINER and check `is_ops()` themselves. The READ returns an
 * empty array for a non-ops caller (so /studio/ops needs no route guard); the WRITE
 * raises. That asymmetry is deliberate: a silently-failing write would let an operator
 * believe they had actioned a report when nothing was recorded.
 *
 * No service_role anywhere, per ADR-0008 §4. The operator's own session is the credential.
 */
import { supabase } from '../supabase';

export type ReportKind = 'post' | 'comment' | 'story';

export type OpsReport = {
  /** Which surface was reported. Also the discriminator markReportReviewed() routes on. */
  kind: ReportKind;
  id: string;
  createdAt: string;
  reason: string;
  details: string | null;
  reporterId: string;
  reporterUsername: string | null;
  /** Who was reported. For stories this is denormalised, so it survives expiry. */
  reportedUserId: string | null;
  reportedUsername: string | null;
  /** The post / comment / story id. Null once a story has expired. */
  targetId: string | null;
  /** Track title, comment excerpt, or story caption — whatever still exists. */
  targetExcerpt: string | null;
  /**
   * False when the reported thing is gone: a deleted post, or a story past its 24 hours.
   * The report is still actionable — the reported USER is still there — so this drives a
   * label rather than hiding the row.
   */
  targetExists: boolean;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewerUsername: string | null;
};

export async function fetchOpsReports(includeReviewed = false): Promise<OpsReport[]> {
  const { data, error } = await supabase.rpc('ops_reports_overview', {
    p_include_reviewed: includeReviewed,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map(r => ({
    kind: r.kind as ReportKind,
    id: r.id,
    createdAt: r.created_at,
    reason: r.reason,
    details: r.details,
    reporterId: r.reporter_id,
    reporterUsername: r.reporter_username,
    reportedUserId: r.reported_user_id,
    reportedUsername: r.reported_username,
    targetId: r.target_id,
    targetExcerpt: r.target_excerpt,
    targetExists: Boolean(r.target_exists),
    reviewedAt: r.reviewed_at,
    reviewedBy: r.reviewed_by,
    reviewerUsername: r.reviewer_username,
  }));
}

/**
 * Marks one report reviewed, or reopens it. Idempotent server-side: re-marking keeps the
 * FIRST review stamp, because when it was first looked at is the fact worth preserving.
 */
export async function markReportReviewed(
  kind: ReportKind,
  id: string,
  reviewed = true,
): Promise<void> {
  const { error } = await supabase.rpc('ops_mark_report_reviewed', {
    p_kind: kind,
    p_id: id,
    p_reviewed: reviewed,
  });
  if (error) throw new Error(error.message);
}
