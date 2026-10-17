import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

/**
 * A profile's music score (ADR-0032): one number per person, recomputed every night on the
 * server from what they did (refresh_music_scores). The app only reads it.
 *
 * Fail-safe: the table not there yet (this build reached the store before the migration),
 * no row, a network error — all `null`, and the tag hides. Never throws.
 */
export async function getMusicScore(userId: string): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from('music_scores')
      .select('score')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) {return null;}
    const score = data.score;
    return typeof score === 'number' && Number.isFinite(score) ? score : null;
  } catch {
    return null;
  }
}

/** 1284 → "1,284". Hand-rolled so it does not depend on the engine's Intl data. */
export function formatMusicScore(score: number): string {
  return String(Math.max(0, Math.floor(score))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The score for a profile, or null while loading / when there is none to show. */
export function useMusicScore(userId: string | null | undefined): number | null {
  const [score, setScore] = useState<number | null>(null);
  useEffect(() => {
    setScore(null);
    if (!userId) {return;}
    let live = true;
    getMusicScore(userId).then(s => { if (live) {setScore(s);} });
    return () => { live = false; };
  }, [userId]);
  return score;
}
