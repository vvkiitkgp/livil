import { supabase } from '../../lib/supabase';
import { listRecentTracksPage, type LibraryRecentTrack } from './tracks';
import { artistLine, getSpotifyTrack } from './spotify';
import { SPOTIFY_ID_RE } from '../utils/spotifyLinks';

type SpotifyOpenRow = { spotify_track_id: string; opened_at: string };

/**
 * The caller's Spotify songs, one per song at its latest open (my_recent_spotify_opens,
 * 20261108000000). Fail-safe: before that migration is applied, or on any error, Recently
 * Played is the Livil list alone — `exhausted` so it never holds the paging back.
 */
async function listRecentSpotifyOpens(
  limit: number,
  before?: string,
): Promise<{ rows: SpotifyOpenRow[]; exhausted: boolean }> {
  try {
    const { data, error } = await supabase.rpc(
      'my_recent_spotify_opens',
      before ? { p_limit: limit, p_before: before } : { p_limit: limit },
    );
    if (error || !Array.isArray(data)) { return { rows: [], exhausted: true }; }
    const rows = data.filter((r: SpotifyOpenRow) => SPOTIFY_ID_RE.test(r.spotify_track_id));
    return { rows, exhausted: data.length < limit };
  } catch {
    return { rows: [], exhausted: true };
  }
}

/**
 * Where a merged page must stop: two lists paged by time can only be merged down to the
 * NEWER of their last rows — below that, the list that still has more could hold a row that
 * belongs above what the other one showed. Null = both lists are done.
 */
export function mergeCutoff(
  livilNext: string | null,
  spotify: { lastAt: string | null; exhausted: boolean },
): string | null {
  const frontiers = [livilNext, spotify.exhausted ? null : spotify.lastAt].filter(
    (t): t is string => t !== null,
  );
  if (frontiers.length === 0) { return null; }
  return frontiers.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
}

/**
 * Recently Played with the Spotify songs you played in it, newest first (owner,
 * 2026-10-19). A Spotify song counts once it actually opened in Spotify — that is what
 * spotify_opens logs. Same paging contract as listRecentTracksPage: `nextBefore` null means
 * no more history.
 *
 * Spotify rows carry Spotify's own title, artists and artwork (fetched per app session,
 * never stored — Spotify's terms); a song Spotify no longer has is left out.
 */
export async function listRecentlyPlayedPage(
  limit = 24,
  before?: string,
): Promise<{ items: LibraryRecentTrack[]; nextBefore: string | null }> {
  const [livil, spotify] = await Promise.all([
    listRecentTracksPage(limit, before),
    listRecentSpotifyOpens(limit, before),
  ]);

  const spotifyItems = (
    await Promise.all(
      spotify.rows.map(async (row): Promise<LibraryRecentTrack | null> => {
        const track = await getSpotifyTrack(row.spotify_track_id);
        if (!track) { return null; }
        return {
          trackId: `spotify:${track.id}`,
          postId: null,
          title: track.title,
          artistLabel: artistLine(track),
          coverArtUrl: track.imageUrl,
          playedAt: row.opened_at,
          spotifyTrackId: track.id,
        };
      }),
    )
  ).filter((item): item is LibraryRecentTrack => item !== null);

  const nextBefore = mergeCutoff(livil.nextBefore, {
    lastAt: spotify.rows.length > 0 ? spotify.rows[spotify.rows.length - 1]!.opened_at : null,
    exhausted: spotify.exhausted,
  });
  const cutoffMs = nextBefore === null ? Number.NEGATIVE_INFINITY : Date.parse(nextBefore);
  const items = [...livil.items, ...spotifyItems]
    .filter(item => Date.parse(item.playedAt) >= cutoffMs)
    .sort((a, b) => Date.parse(b.playedAt) - Date.parse(a.playedAt));
  return { items, nextBefore };
}
