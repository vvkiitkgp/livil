/**
 * What people actually open from search.
 *
 * Behind `ops_top_search_results()`, a SECURITY DEFINER function that checks `is_ops()`
 * itself — same posture as the rest of /studio/ops, so a non-ops caller gets an empty array
 * rather than an error and the route needs no guard.
 *
 * "MOST SEARCHED" MEANS TAPPED, NOT TYPED. A typed query is a guess in progress — someone
 * reaching for one song produces half a dozen prefixes on the way — and a query that found
 * nothing looks identical to one that found exactly the right thing. A tap is the moment the
 * search worked. The query text is never stored at all; see the migration for why.
 *
 * `people` LEADS, `taps` follows, and the order matters: fifty people opening a song once is
 * a stronger signal than one person opening it fifty times, and reading the second number as
 * the headline is how a chart gets gamed by one enthusiast.
 */
import { supabase } from '../supabase';

export type OpsSearchKind = 'track' | 'album' | 'profile';

export type OpsSearchResult = {
  entityId: string;
  /** Track or album title; display name (or handle) for a person. */
  title: string | null;
  /** The uploader's handle, or the person's own. */
  subtitle: string | null;
  /** Distinct people who opened it. The number to rank by. */
  people: number;
  /** Total opens, including repeats by the same person. */
  taps: number;
};

export async function fetchTopSearchResults(
  kind: OpsSearchKind,
  days: number,
  limit = 20,
): Promise<OpsSearchResult[]> {
  const { data, error } = await supabase.rpc('ops_top_search_results', {
    p_kind: kind,
    p_days: days,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map(r => ({
    entityId: r.entity_id,
    title: r.title,
    subtitle: r.subtitle,
    people: Number(r.people) || 0,
    taps: Number(r.taps) || 0,
  }));
}
