/**
 * Recording what people open from search.
 *
 * "Most searched" is defined as what people TAPPED, not what they typed — see the migration
 * `20260808000000_search_result_taps.sql` for why, and for what is deliberately not stored
 * (the query text, ever).
 *
 * FIRE AND FORGET, ALWAYS. This runs on the tap that opens a song, so it is racing a
 * navigation or the start of playback. It must never delay either, never surface an error,
 * and never throw into a handler whose real job is to play music. Analytics that can break a
 * feature is a feature with an analytics dependency, which is not a trade anyone agreed to.
 */
import { supabase } from '../../lib/supabase';

export type SearchTapKind = 'track' | 'album' | 'profile';

/**
 * Note the tap. Resolves immediately; the write completes in the background.
 *
 * `user_id` is set from the session rather than passed in, because it is the column the
 * insert policy checks (`user_id = auth.uid()`). Passing it from a caller would give a caller
 * something to get wrong, and the failure mode — rows attributed to the wrong person — is
 * exactly what the aggregate's distinct-user count depends on being right.
 */
export function recordSearchTap(kind: SearchTapKind, entityId: string): void {
  if (!entityId) { return; }

  void (async () => {
    try {
      const { data } = await supabase.auth.getUser();
      const userId = data?.user?.id;
      // Signed out: nothing to attribute, and the insert policy would refuse it anyway.
      if (!userId) { return; }

      await supabase
        .from('search_result_taps')
        .insert({ kind, entity_id: entityId, user_id: userId });
    } catch {
      /* analytics is never worth an error in front of somebody opening a song */
    }
  })();
}

/**
 * How many distinct people opened each of these entities from search.
 *
 * Feeds `rankSearchResults` so the order reflects what people actually choose, not only how
 * well a title matches. Aggregate only — `search_result_popularity` returns counts and never
 * who, when, or what was typed.
 *
 * Fail-safe: an empty map on any error. Ranking already treats a missing count as zero, so a
 * failure here degrades the ORDER slightly and breaks nothing.
 */
export async function fetchSearchPopularity(
  kind: SearchTapKind,
  entityIds: string[],
): Promise<Record<string, number>> {
  if (entityIds.length === 0) { return {}; }
  try {
    const { data, error } = await supabase.rpc('search_result_popularity', {
      p_kind: kind,
      p_ids: entityIds,
    });
    if (error || !data) { return {}; }
    const out: Record<string, number> = {};
    for (const row of data) { out[row.entity_id] = Number(row.people) || 0; }
    return out;
  } catch {
    return {};
  }
}
