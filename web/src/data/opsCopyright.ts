/**
 * Uploads that matched a known recording, and what the uploader said about them.
 *
 * WHAT THIS LIST IS FOR: deciding what to take down. Everything below is shaped around
 * that one question, which is why the rows arrive pre-ranked by concern rather than
 * simply newest-first — a queue ordered by time makes an operator read everything to
 * find the one thing that matters.
 *
 * ACCESS IS THE DATABASE'S DECISION, NOT THIS FILE'S — same posture as `opsReports.ts`.
 * `ops_copyright_scans` is SECURITY DEFINER and checks `is_ops()` in its own body,
 * returning an empty set for anyone else so /studio/ops needs no route guard. No
 * service_role anywhere: the operator's own session is the credential.
 *
 * ── A MATCH IS NOT A VERDICT ────────────────────────────────────────────────
 *
 * Every row here is an upload that RESEMBLES a registered recording. That is all. The
 * uploader may own it, hold a licence, or be the artist — and fingerprinting has real
 * false positives on covers, live takes and sampled material. `concern` below ranks how
 * much a row deserves a human's attention; it does not rank guilt, and nothing in this
 * file should ever be rendered as an accusation.
 */
import { supabase } from '../supabase';

export type ClaimKind = 'self_recorded' | 'owner' | 'permission' | 'disputed' | 'cancelled';

/**
 * How much this row wants a human, most to least.
 *
 * `unanswered` sits at the top because it is the only state where nobody has said
 * anything at all — an upload matched a commercial master and the uploader never
 * explained themselves.
 */
export type Concern =
  | 'unanswered'
  | 'reference_mismatch'
  | 'weak_claim'
  | 'explained'
  /**
   * Already unpublished, so there is nothing for a takedown to remove. Sorted LAST
   * regardless of how the claim reads: a row that cannot be acted on should never sit
   * above one that can, which is exactly how the first real misclick happened.
   */
  | 'nothing_live';

export type OpsCopyrightScan = {
  id: string;
  trackId: string;
  trackTitle: string;
  uploaderId: string | null;
  uploaderUsername: string | null;
  mediaKind: string | null;
  provider: string;
  matchedTitle: string | null;
  matchedArtist: string | null;
  matchedIsrc: string | null;
  /** The URL actually handed to the provider — proof of what was examined. */
  scannedMediaUrl: string | null;
  claim: ClaimKind | null;
  claimBasis: string | null;
  claimGrantor: string | null;
  claimScope: string[] | null;
  claimTerritory: string | null;
  claimTerm: string | null;
  claimReference: string | null;
  claimNote: string | null;
  /**
   * Whether the reference the claimant supplied names the SAME recording the provider
   * matched. Null when either side is absent — which is a different answer from "no" and
   * must stay distinguishable, because most legitimate creators have no ISRC at all.
   */
  referenceMatchesIsrc: boolean | null;
  acceptedResponsibility: boolean | null;
  grantedStreamingLicence: boolean | null;
  /**
   * What a takedown would actually remove, right now.
   *
   * On the row because two identically-titled test uploads once sat next to each other
   * with nothing to tell them apart, and the one with no live posts sorted first. The
   * operator took it down, nothing changed in the app, and the reasonable conclusion was
   * that the feature was broken.
   */
  liveUploads: number;
  liveReposts: number;
  /** Non-null when this track is currently down. Drives Take down vs Restore. */
  takenDownAt: string | null;
  /** How many of this uploader's tracks are down. The repeat-infringer signal. */
  uploaderTakedowns: number;
  answeredAt: string | null;
  createdAt: string;
  concern: Concern;
};

/**
 * Rank a row by how much it wants a human.
 *
 * Deliberately crude and explainable. An operator has to be able to say why a row is near
 * the top, and a score nobody can reconstruct is worse than a rough rule anyone can.
 */
function concernOf(r: {
  claim: ClaimKind | null;
  referenceMatchesIsrc: boolean | null;
  claimGrantor: string | null;
  liveUploads: number;
  liveReposts: number;
  takenDownAt: string | null;
}): Concern {
  // Nothing is serving, so there is nothing to decide. Checked FIRST, before anything
  // about the claim: an unanswered match with no live post is not urgent, it is inert.
  if (!r.takenDownAt && r.liveUploads + r.liveReposts === 0) return 'nothing_live';

  // Nobody has said anything. A commercial master matched and the upload went ahead.
  if (!r.claim || r.claim === 'cancelled') return 'unanswered';

  // They named a reference, and it is for a DIFFERENT recording than the one we matched.
  // Not proof of anything — people mistype, and a licence can cover a re-recording — but
  // it is the single most informative signal on the row.
  if (r.referenceMatchesIsrc === false) return 'reference_mismatch';

  // A licence claim that names a grantor is checkable. One that does not is a sentence.
  if (r.claim === 'permission' && !r.claimGrantor) return 'weak_claim';

  // "I hold the rights" on a track that matched a major-label master deserves a look
  // before "I made this myself", which is the ordinary case for a cover.
  if (r.claim === 'owner') return 'weak_claim';

  return 'explained';
}

const ORDER: Record<Concern, number> = {
  unanswered: 0,
  reference_mismatch: 1,
  weak_claim: 2,
  explained: 3,
  nothing_live: 4,
};

export async function fetchOpsCopyrightScans(
  includeAnswered = true,
): Promise<OpsCopyrightScan[]> {
  const { data, error } = await supabase.rpc('ops_copyright_scans', {
    p_include_answered: includeAnswered,
  });
  if (error) throw new Error(error.message);

  const rows: OpsCopyrightScan[] = (data ?? []).map(r => {
    const base = {
      id: String(r.id),
      trackId: String(r.track_id),
      trackTitle: String(r.track_title ?? ''),
      uploaderId: (r.uploader_id as string) ?? null,
      uploaderUsername: (r.uploader_username as string) ?? null,
      mediaKind: (r.media_kind as string) ?? null,
      provider: String(r.provider ?? ''),
      matchedTitle: (r.matched_title as string) ?? null,
      matchedArtist: (r.matched_artist as string) ?? null,
      matchedIsrc: (r.matched_isrc as string) ?? null,
      scannedMediaUrl: (r.scanned_media_url as string) ?? null,
      claim: (r.acknowledgement as ClaimKind | null) ?? null,
      claimBasis: (r.claim_basis as string) ?? null,
      claimGrantor: (r.claim_grantor as string) ?? null,
      claimScope: (r.claim_scope as string[]) ?? null,
      claimTerritory: (r.claim_territory as string) ?? null,
      claimTerm: (r.claim_term as string) ?? null,
      claimReference: (r.claim_reference as string) ?? null,
      claimNote: (r.claim_note as string) ?? null,
      referenceMatchesIsrc:
        typeof r.reference_matches_isrc === 'boolean' ? r.reference_matches_isrc : null,
      acceptedResponsibility:
        typeof r.accepted_responsibility === 'boolean' ? r.accepted_responsibility : null,
      grantedStreamingLicence:
        typeof r.granted_streaming_licence === 'boolean' ? r.granted_streaming_licence : null,
      liveUploads: Number(r.live_uploads ?? 0),
      liveReposts: Number(r.live_reposts ?? 0),
      takenDownAt: (r.taken_down_at as string) ?? null,
      uploaderTakedowns: Number(r.uploader_takedowns ?? 0),
      answeredAt: (r.acknowledged_at as string) ?? null,
      createdAt: String(r.created_at),
    };
    return { ...base, concern: concernOf(base) };
  });

  // Most concerning first, then newest within a band.
  return rows.sort(
    (a, b) =>
      ORDER[a.concern] - ORDER[b.concern] || b.createdAt.localeCompare(a.createdAt),
  );
}

/** Plain-English label for a claim. The database values are not operator-facing. */
export function claimLabel(claim: ClaimKind | null): string {
  switch (claim) {
    case 'self_recorded': return 'Made it themselves';
    case 'owner': return 'Holds the rights';
    case 'permission': return 'Has permission';
    case 'disputed': return 'Says the match is wrong';
    case 'cancelled': return 'Backed out';
    default: return 'No answer';
  }
}

export function concernLabel(concern: Concern): string {
  switch (concern) {
    case 'unanswered': return 'Never answered';
    case 'reference_mismatch': return 'Reference is for another recording';
    case 'weak_claim': return 'Worth a look';
    case 'explained': return 'Explained';
    case 'nothing_live': return 'Nothing published';
  }
}

/**
 * What a takedown would remove, in words.
 *
 * Says "Nothing published" rather than "0 posts" because zero is easy to skim past, and
 * skimming past it is precisely what went wrong.
 */
export function liveLabel(r: Pick<OpsCopyrightScan, 'liveUploads' | 'liveReposts'>): string {
  const total = r.liveUploads + r.liveReposts;
  if (total === 0) return 'Nothing published';
  const parts: string[] = [];
  if (r.liveUploads > 0) parts.push(`${r.liveUploads} upload${r.liveUploads === 1 ? '' : 's'}`);
  if (r.liveReposts > 0) parts.push(`${r.liveReposts} repost${r.liveReposts === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** First segment of a uuid. Enough to tell two identically-titled rows apart. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** What the claimed licence covers, in words rather than database values. */
export function scopeLabel(scope: string): string {
  switch (scope) {
    case 'streaming': return 'streaming';
    case 'ugc': return 'UGC platforms';
    case 'online_distribution': return 'online distribution';
    case 'commercial': return 'commercial use';
    default: return scope;
  }
}

/**
 * Take a track down.
 *
 * Deletes every post for it — REPOSTS FIRST, because `original_post_id` is ON DELETE SET
 * NULL and deleting the upload post alone would leave reposts alive and still serving the
 * audio — then tombstones the track and records the action.
 *
 * REVERSIBLE BY DESIGN. The track row and the stored files survive, so `restoreTrack`
 * can put the uploader's post back. That is not politeness: India's Copyright Rules
 * expect a 21-day block that can be lifted if no court order follows, and a hard delete
 * makes that impossible.
 *
 * WHAT IT DOES NOT DO: remove the files. They stay at their public URL, reachable by
 * anyone who already has the link, until a purge exists — which is blocked on an unrun
 * storage probe. The screen says so rather than implying the content is gone.
 *
 * THROWS for a non-operator rather than failing quietly. Every ops READ here returns
 * empty so the route needs no guard, but a silent no-op WRITE would tell an operator they
 * had removed something that is still playing.
 *
 * Returns the number of posts that stopped serving.
 */
export async function takeDownTrack(trackId: string, reason: string): Promise<number> {
  const { data, error } = await supabase.rpc('ops_take_down_track', {
    p_track_id: trackId,
    p_reason: reason.trim() || undefined,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/**
 * Reverse a takedown.
 *
 * Re-creates the uploader's OWN post from the snapshot taken at takedown. Likes,
 * comments, views and reposts are NOT restored — they cascaded away when the posts were
 * deleted and are not recoverable. Reposts in particular are left alone deliberately:
 * they were other people's posts, and re-publishing under someone else's name because a
 * later decision went the other way is not ours to do.
 */
export async function restoreTrack(trackId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('ops_restore_track', {
    p_track_id: trackId,
    p_reason: reason.trim() || undefined,
  });
  if (error) throw new Error(error.message);
}
