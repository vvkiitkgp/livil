/**
 * "What happened to my post?"
 *
 * A takedown deletes the posts. That is deliberate and load-bearing: hiding them instead
 * would mean copying a visibility predicate into every privileged function that reads
 * posts — including the one granted to anonymous visitors for share links — and missing
 * one would serve a "hidden" post to the public (ADR-0017 §C).
 *
 * The cost of deleting is that the person who lost the post learns nothing. This is the
 * repair: a record of the removal, with exactly one reader — the author.
 *
 * ── WHAT THIS IS NOT ───────────────────────────────────────────────────────
 *
 * Not a hidden copy of the post, and not a way to get it back. The post is gone. This is
 * a notice: what it was, when it went, and why — in the operator's own words.
 *
 * ── WHY BOTH THE UPLOADER AND THE REPOSTER GET ONE ─────────────────────────
 *
 * A takedown removes the upload AND every repost of it. The reposter did nothing wrong
 * and lost a post with their own caption and their own chosen clip. Telling only the
 * uploader would leave everyone else to notice a gap.
 *
 * The rows are scoped per author, so the uploader cannot read the reposter's notice and
 * vice versa — a repost removal carries somebody else's words.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

// deno-lint-ignore no-explicit-any
export type RemovalClient = SupabaseClient<any, any, any>;

export type PostRemoval = {
  id: string;
  trackId: string;
  kind: 'upload' | 'repost';
  /** Copied at removal time, so it still reads correctly if the track is later deleted. */
  trackTitle: string | null;
  caption: string | null;
  /** The operator's words. Shown verbatim — the point is that the person learns why. */
  reason: string | null;
  removedAt: string;
};

/**
 * Removals for the signed-in user.
 *
 * Row level security scopes this to the caller; there is no parameter for whose to fetch,
 * because there is no legitimate caller who wants somebody else's.
 *
 * Returns an empty array rather than throwing. A profile that fails to load because a
 * notice query errored would be a worse outcome than a missing notice.
 */
export async function fetchMyRemovals(db: RemovalClient): Promise<PostRemoval[]> {
  try {
    const { data, error } = await db
      .from('post_removals')
      .select('id, track_id, kind, track_title, caption, reason, removed_at')
      .order('removed_at', { ascending: false });
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map(r => ({
      id: String(r.id),
      trackId: String(r.track_id),
      kind: r.kind === 'repost' ? 'repost' : 'upload',
      trackTitle: (r.track_title as string) ?? null,
      caption: (r.caption as string) ?? null,
      reason: (r.reason as string) ?? null,
      removedAt: String(r.removed_at),
    }));
  } catch {
    return [];
  }
}

/**
 * Dismiss a notice.
 *
 * This deletes the NOTICE, not the post — the post is already gone — and it does not
 * touch the moderation ledger, so nobody clears a strike by tidying their profile.
 *
 * It is the "delete it" action on the card: the person has read why, and would rather not
 * keep looking at it.
 */
export async function dismissRemoval(db: RemovalClient, id: string): Promise<boolean> {
  if (!id) return false;
  try {
    const { error } = await db.from('post_removals').delete().eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

/** Copy for the card. Kept here so both clients say the same thing. */
export function removalHeadline(r: PostRemoval): string {
  return r.kind === 'repost'
    ? 'Your repost was removed'
    : 'This upload was removed';
}

export function removalBody(r: PostRemoval): string {
  return r.kind === 'repost'
    ? 'The original track is no longer available on Livil, so your repost of it was removed too.'
    : 'Only you can see this. It is hidden from your followers and from everyone else.';
}
