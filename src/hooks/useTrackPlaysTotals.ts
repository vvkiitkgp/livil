import { useEffect, useState } from 'react';
import { fetchTrackPlaysTotals, type FeedPost } from '../services/posts';

/**
 * Each upload's song total plays, for the Uploads grid's cards — keyed by track id.
 *
 * Re-fetched whenever the post list itself changes (first page, next page, pull to
 * refresh), so the numbers are as fresh as the list. The previous totals stay on screen
 * while a fetch is out, and a failed fetch keeps them: a card without its number is fine,
 * a flicker to nothing is not. Only the newest request may land.
 */
export function useTrackPlaysTotals(posts: FeedPost[], enabled: boolean): Record<string, number> {
  const [totals, setTotals] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!enabled) { return; }
    const ids = posts
      .filter(p => p.kind === 'upload' && !p.spotifyTrackId && p.track.id)
      .map(p => p.track.id);
    if (ids.length === 0) { return; }
    let current = true;
    fetchTrackPlaysTotals(ids)
      .then(next => { if (current) { setTotals(next); } })
      .catch(() => {});
    return () => { current = false; };
  }, [posts, enabled]);

  return totals;
}
