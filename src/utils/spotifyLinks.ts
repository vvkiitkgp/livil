/**
 * Spotify link helpers for Spotify reposts (ADR-0027).
 *
 * Pure — no React Native imports — so the edge function's test suite can import this file
 * and assert that the app and the server agree on what counts as a Spotify track link
 * (supabase/functions/spotify/index.test.ts).
 */

/** Spotify's base-62 track id. Mirrors posts_spotify_track_id_format in the database. */
export const SPOTIFY_ID_RE = /^[A-Za-z0-9]{22}$/;

/** spotify:track:<id> */
const TRACK_URI_RE = /^spotify:track:([A-Za-z0-9]{22})$/;
/**
 * open.spotify.com/track/<id>, optionally with a locale segment (/intl-de/) and any query or
 * fragment (?si=…). A regex rather than `new URL()`, so the app and the edge function parse
 * identically — React Native's URL is a polyfill, Deno's is the WHATWG one.
 */
const TRACK_LINK_RE =
  /^(?:https?:\/\/)?open\.spotify\.com\/(?:intl-[A-Za-z-]+\/)?track\/([A-Za-z0-9]{22})(?:[/?#].*)?$/i;

/**
 * The track id in a pasted link, or null. Accepts:
 *   https://open.spotify.com/track/<id>?si=…
 *   https://open.spotify.com/intl-de/track/<id>
 *   spotify:track:<id>
 *   a bare 22-character id
 * Anything else — an album, a playlist, another site — is null, never a guess.
 *
 * Kept identical to parseSpotifyTrackId in supabase/functions/spotify/app.ts.
 */
export function parseSpotifyTrackId(input: string): string | null {
  const text = input.trim();
  if (SPOTIFY_ID_RE.test(text)) {return text;}
  const match = TRACK_URI_RE.exec(text) ?? TRACK_LINK_RE.exec(text);
  return match?.[1] ?? null;
}

/**
 * True when the text looks like any Spotify link — including the short spotify.link form,
 * which needs the server to resolve. Used to decide "treat as a link" vs "search for it".
 */
export function looksLikeSpotifyLink(input: string): boolean {
  const text = input.trim().toLowerCase();
  return (
    text.startsWith('spotify:') ||
    /^https?:\/\/(open\.spotify\.com|spotify\.link)\//.test(text)
  );
}

/** The public web URL for a track — opens the Spotify app when installed (universal link). */
export function spotifyTrackUrl(id: string): string {
  return `https://open.spotify.com/track/${id}`;
}

/**
 * A Spotify song link somewhere inside free text (a chat message), or null. The first one
 * wins. `match` is the exact substring, so the caller can drop it from the text it shows.
 *
 *   { id }        open.spotify.com/track/<id> or spotify:track:<id> — usable as is;
 *   { shortUrl }  https://spotify.link/<code> — needs resolveSpotifyLink (server) first.
 *
 * The link must start the text or follow whitespace or an opening bracket/quote, so a
 * Spotify-looking fragment inside some other URL is not mistaken for a share. Only the id
 * is ever used — the app builds its own Spotify URL from it — so nothing the sender typed
 * is ever opened as a link.
 */
export type SpotifyLinkInText =
  | { id: string; shortUrl?: undefined; match: string }
  | { id?: undefined; shortUrl: string; match: string };

const TRACK_IN_TEXT_RE =
  /(^|[\s(<"'])((?:https?:\/\/)?open\.spotify\.com\/(?:intl-[A-Za-z-]+\/)?track\/([A-Za-z0-9]{22})(?:[?#][^\s)>"']*)?|spotify:track:([A-Za-z0-9]{22}))/i;
const SHORT_IN_TEXT_RE = /(^|[\s(<"'])(https:\/\/spotify\.link\/([A-Za-z0-9]{4,32}))(?=$|[\s)>"'?#])/i;

export function findSpotifyLinkInText(text: string): SpotifyLinkInText | null {
  const track = TRACK_IN_TEXT_RE.exec(text);
  if (track) {
    const id = track[3] ?? track[4];
    if (id) {return { id, match: track[2] ?? '' };}
  }
  const short = SHORT_IN_TEXT_RE.exec(text);
  if (short && short[2]) {return { shortUrl: short[2], match: short[2] };}
  return null;
}
