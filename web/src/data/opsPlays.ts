/**
 * Play stats for /studio/ops — "played on Livil" vs "opened on Spotify" (ADR-0027).
 *
 * Behind four ops-only SECURITY DEFINER functions (migration 20261014000000) that check
 * `is_ops()` themselves and return empty for anyone else, like the rest of /studio/ops.
 *
 * TOTALS, NOT PEOPLE: nothing here can say who played what. `people` is a distinct count,
 * and "recent" lists the song and the time, never the listener.
 *
 * Spotify titles are not stored (Spotify's terms allow only temporary caching), so they are
 * resolved live through the `spotify` edge function, the same one the app uses.
 */
import { supabase } from '../supabase';

export type PlaySummary = {
  livilPlays: number;
  livilPeople: number;
  spotifyOpens: number;
  spotifyPeople: number;
};

export type PlayDay = { day: string; livil: number; spotify: number };

export type TopPlayed = {
  id: string;
  title: string | null;
  subtitle: string | null;
  people: number;
  plays: number;
};

export type RecentPlay = {
  at: string;
  source: 'livil' | 'spotify';
  /** Spotify only: where the hand-off started — feed, chat or search. */
  via: string | null;
  title: string | null;
  subtitle: string | null;
  spotifyTrackId: string | null;
};

export async function fetchPlaySummary(days: number): Promise<PlaySummary | null> {
  const { data, error } = await supabase.rpc('ops_play_summary', { p_days: days });
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) return null;
  return {
    livilPlays: Number(row.livil_plays) || 0,
    livilPeople: Number(row.livil_people) || 0,
    spotifyOpens: Number(row.spotify_opens) || 0,
    spotifyPeople: Number(row.spotify_people) || 0,
  };
}

export async function fetchPlayDaily(days: number): Promise<PlayDay[]> {
  const { data, error } = await supabase.rpc('ops_play_daily', { p_days: Math.min(days, 365) });
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    day: r.day,
    livil: Number(r.livil_plays) || 0,
    spotify: Number(r.spotify_opens) || 0,
  }));
}

export async function fetchTopPlayed(
  source: 'livil' | 'spotify',
  days: number,
  limit = 10,
): Promise<TopPlayed[]> {
  const { data, error } = await supabase.rpc('ops_top_played', {
    p_source: source,
    p_days: days,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    id: r.entity_id,
    title: r.title,
    subtitle: r.subtitle,
    people: Number(r.people) || 0,
    plays: Number(r.plays) || 0,
  }));
}

export async function fetchRecentPlays(limit = 25): Promise<RecentPlay[]> {
  const { data, error } = await supabase.rpc('ops_recent_plays', { p_limit: limit });
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    at: r.at,
    source: r.source === 'spotify' ? 'spotify' : 'livil',
    via: r.via,
    title: r.title,
    subtitle: r.subtitle,
    spotifyTrackId: r.spotify_track_id,
  }));
}

/**
 * Title + artists for Spotify track ids, via the `spotify` edge function. Fail-safe: any
 * failure leaves ids untitled, and the dashboard shows the id instead.
 */
export async function resolveSpotifyTitles(
  ids: string[],
): Promise<Record<string, { title: string; artists: string } | null>> {
  const unique = [...new Set(ids)].slice(0, 20);
  if (unique.length === 0) return {};
  try {
    const { data, error } = await supabase.functions.invoke('spotify', {
      body: { action: 'tracks', ids: unique },
    });
    if (error || !data?.tracks) return {};
    const out: Record<string, { title: string; artists: string } | null> = {};
    for (const [id, t] of Object.entries(data.tracks as Record<string, { title: string; artists: string[] } | null>)) {
      out[id] = t ? { title: t.title, artists: t.artists?.join(', ') || 'Spotify' } : null;
    }
    return out;
  } catch {
    return {};
  }
}
