/**
 * A creator's own blocked tracks.
 *
 * These do NOT come back from any post query, and that is not an oversight: a takedown
 * DELETES the posts, and every catalogue, profile and feed is built from posts. Without
 * this read a removed upload simply vanishes from its owner's own profile with no
 * explanation — which is the complaint this whole feature exists to answer.
 *
 * ── WHY THIS NEEDS NO PRIVILEGE ────────────────────────────────────────────
 *
 * `tracks_select_authenticated` reads:
 *
 *   uploader_id = auth.uid()
 *   OR (taken_down_at is null AND not blocked-between)
 *
 * so a blocked row is visible to its uploader and to nobody else — which is exactly what
 * keeps it out of other people's albums, recently-played and queues. The owner reading
 * their own block is the first clause, and needs no operator function.
 *
 * ── WHY IT IS SHARED ───────────────────────────────────────────────────────
 *
 * Both clients show this, and a blocked card that appears on web but not on the phone
 * would leave a creator with two contradictory pictures of their own catalogue. The
 * client is a parameter for the same reason as `./copyrightScan`: the mobile app has
 * never called `configureLivilClient()`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

// deno-lint-ignore no-explicit-any
export type BlockedClient = SupabaseClient<any, any, any>;

export type BlockedTrack = {
  trackId: string;
  title: string;
  mediaKind: string | null;
  coverUrl: string | null;
  durationSeconds: number | null;
  takenDownAt: string;
  /** The operator's own words. Shown verbatim — the point is that they learn why. */
  reason: string | null;
};

/**
 * Resolves to [] on failure rather than throwing.
 *
 * A profile that fails to render because the blocked-track query errored would be a worse
 * outcome than a missing card, and this runs on every profile load for everybody.
 */
export async function fetchMyBlockedTracks(
  db: BlockedClient,
  userId: string,
): Promise<BlockedTrack[]> {
  if (!userId) return [];
  try {
    const { data, error } = await db
      .from('tracks')
      .select(
        'id, title, media_kind, cover_art_url, thumbnail_url, duration_seconds, taken_down_at, taken_down_reason',
      )
      .eq('uploader_id', userId)
      .not('taken_down_at', 'is', null)
      .order('taken_down_at', { ascending: false });
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map(t => ({
      trackId: String(t.id),
      title: String(t.title ?? ''),
      mediaKind: (t.media_kind as string) ?? null,
      // Video carries a thumbnail rather than cover art. Falling back keeps a blocked row
      // from rendering as a bare placeholder beside normal ones.
      coverUrl: (t.cover_art_url as string) ?? (t.thumbnail_url as string) ?? null,
      durationSeconds: (t.duration_seconds as number) ?? null,
      takenDownAt: String(t.taken_down_at),
      reason: (t.taken_down_reason as string) ?? null,
    }));
  } catch {
    return [];
  }
}

/**
 * Delete a blocked track for good.
 *
 * Permitted since the strike moved to `moderation_actions` — a ledger with no foreign
 * keys, which outlives the track. Before that this was blocked, and blocking it only
 * stopped somebody clearing their own blocked upload off their own profile while doing
 * nothing to protect the record.
 *
 * Storage objects are NOT removed: nothing in Livil can delete media yet, and the owner's
 * files go with account deletion. THROWS, unlike the read — a delete that silently did
 * nothing would leave the card on screen with no explanation.
 */
export async function deleteBlockedTrack(
  db: BlockedClient,
  trackId: string,
): Promise<void> {
  const { error } = await db.from('tracks').delete().eq('id', trackId);
  if (error) throw new Error(error.message);
}
