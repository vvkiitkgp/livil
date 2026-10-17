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
   * The track behind the report, so it can be PLAYED and acted on rather than only read
   * about. Null when there is no track to reach: a deleted post, an expired story, or a
   * comment whose post has gone.
   *
   * For a comment report this is the track the comment sits UNDER — judging a remark
   * without the thing it was a remark about is judging half the exchange.
   */
  trackId: string | null;
  trackTitle: string | null;
  mediaKind: string | null;
  /** A public object URL, the same one a listener's player fetches. */
  mediaUrl: string | null;
  coverUrl: string | null;
  /** Set when this track is ALREADY down — the action button says "Restore" instead. */
  trackTakenDownAt: string | null;
  /**
   * A Spotify repost (ADR-0027) has no Livil track, so every track field above is null
   * and the queue would otherwise call it "unavailable". The id only — title and artwork
   * are resolved live, never stored. For a comment report it is the post the comment is on.
   */
  spotifyTrackId: string | null;
  /**
   * 'upload' or 'repost' — the reported post, or for a comment report the post it is on.
   * A repost can be removed on its own; an upload only through a track takedown. Null
   * when the post is gone, for stories, and before 20261104000000 is applied.
   */
  postKind: 'upload' | 'repost' | null;
  /**
   * The reported post's own caption — usually what a repost is reported for, since the
   * song is somebody else's. Post reports only; null when there is none.
   */
  postCaption: string | null;
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
    trackId: r.track_id,
    trackTitle: r.track_title,
    mediaKind: r.media_kind,
    mediaUrl: r.media_url,
    coverUrl: r.cover_url,
    trackTakenDownAt: r.track_taken_down_at,
    // `?? null`, not a straight copy: before 20261104000000 is applied the column is not
    // returned at all, and the queue must read as it did rather than break.
    spotifyTrackId: r.spotify_track_id ?? null,
    postKind: r.post_kind === 'upload' || r.post_kind === 'repost' ? r.post_kind : null,
    postCaption: r.post_caption ?? null,
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

/**
 * Removes ONE reported repost — Spotify (ADR-0027) or Livil. A track takedown cannot reach
 * a Spotify repost at all, and for a Livil repost it would also remove the uploader's post
 * and every other repost. The database deletes just this post, records the decision with
 * a summary of its reports, and tells its author `reason` verbatim. Not reversible; the
 * author can repost.
 *
 * Raises rather than no-ops, like every ops write: for a non-operator, a blank reason, an
 * upload (that is a takedown), or a post that is already gone.
 */
export async function removeRepost(postId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('ops_remove_repost', {
    p_post_id: postId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}
