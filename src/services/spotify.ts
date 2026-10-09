/**
 * Spotify reposts — the app side of the `spotify` edge function (ADR-0027).
 *
 * Everything here is FAIL-SAFE by contract: a missing function, a switched-off feature,
 * Spotify being down or rate-limiting us all resolve to "not available" / null, never a
 * thrown error. The UI hides what it cannot show; Livil itself keeps working.
 *
 * Livil never PLAYS a Spotify track. The only thing this module does with a song is
 * describe it (title, artists, artwork) and open it in the Spotify app.
 */
import { useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { supabase } from '../../lib/supabase';
import { SPOTIFY_ID_RE, spotifyTrackUrl } from '../utils/spotifyLinks';

/** What the edge function returns for a track. Nothing else from Spotify reaches the app. */
export type SpotifyTrack = {
  id: string;
  title: string;
  artists: string[];
  album: string | null;
  imageUrl: string | null;
  durationMs: number | null;
};

export type SpotifyAvailability = {
  /** The server switch: may people create Spotify reposts? */
  reposts: boolean;
  /** Is Spotify search configured? Without it, only pasting a link works. */
  search: boolean;
};

const UNAVAILABLE: SpotifyAvailability = { reposts: false, search: false };

async function call<T>(body: Record<string, unknown>): Promise<T | null> {
  try {
    const { data, error } = await supabase.functions.invoke('spotify', { body });
    if (error) {
      console.warn('[spotify] function returned an error', body.action, error.message ?? error);
      return null;
    }
    return (data ?? null) as T | null;
  } catch (e) {
    console.warn('[spotify] call failed', body.action, e);
    return null;
  }
}

// ── Availability ────────────────────────────────────────────────────────────
//
// Two independent answers, asked in parallel:
//   reposts — the switch, which lives in the DATABASE (spotify_reposts_enabled()), where it
//             also refuses the insert. A missing function (migration not applied) is "off".
//   search  — whether the edge function has Spotify credentials. Missing function → off.
//
// Cached for a few minutes and re-asked when the app returns to the foreground, so the
// owner flipping the switch reaches open apps without a restart — in either direction.

const AVAILABILITY_TTL_MS = 5 * 60 * 1000;
let availability: { value: SpotifyAvailability; at: number } | null = null;
let availabilityInFlight: Promise<SpotifyAvailability> | null = null;

async function fetchAvailability(): Promise<SpotifyAvailability> {
  const [repostsRes, statusRes] = await Promise.all([
    Promise.resolve(supabase.rpc('spotify_reposts_enabled')).catch(() => null),
    call<{ search?: boolean }>({ action: 'status' }),
  ]);
  const reposts = repostsRes && !repostsRes.error ? repostsRes.data === true : false;
  return { reposts, search: statusRes?.search === true };
}

export function getSpotifyAvailability(): Promise<SpotifyAvailability> {
  if (availability && Date.now() - availability.at < AVAILABILITY_TTL_MS) {
    return Promise.resolve(availability.value);
  }
  if (!availabilityInFlight) {
    availabilityInFlight = fetchAvailability()
      .then(value => {
        availability = { value, at: Date.now() };
        return value;
      })
      .catch(() => UNAVAILABLE)
      .finally(() => { availabilityInFlight = null; });
  }
  return availabilityInFlight;
}

/**
 * React wrapper. Starts from the cached answer (or "unavailable") and re-asks whenever the
 * app comes back to the foreground — the TTL above keeps that to one request per few minutes.
 */
export function useSpotifyAvailability(): SpotifyAvailability {
  const [value, setValue] = useState<SpotifyAvailability>(availability?.value ?? UNAVAILABLE);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getSpotifyAvailability().then(v => {
        if (!cancelled) {
          setValue(prev => (prev.reposts === v.reposts && prev.search === v.search ? prev : v));
        }
      });
    };
    refresh();
    const sub = AppState.addEventListener('change', next => { if (next === 'active') { refresh(); } });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);
  return value;
}

// ── Search ──────────────────────────────────────────────────────────────────

/**
 * Spotify tracks for a query. Resolves to [] when search is not configured, the query is
 * too short, or anything goes wrong — callers render "no Spotify section", never an error.
 */
export async function searchSpotify(query: string, limit = 5): Promise<SpotifyTrack[]> {
  return (await searchSpotifyOrFail(query, limit)) ?? [];
}

/**
 * The same search, but a FAILED search resolves to `null` instead of `[]`.
 *
 * For the one screen where Spotify search is the whole point (Repost from Spotify). There,
 * "no matches" and "Spotify refused" must read differently: the function answers 502 when
 * Spotify turns a search down (e.g. the developer account's Premium lapsing), and showing
 * `Nothing on Spotify for "Taylor Swift"` for that looks like a broken feature — exactly
 * what an App Reviewer would report. The Search tab and the chat picker keep `searchSpotify`
 * and simply hide their Spotify section.
 */
export async function searchSpotifyOrFail(
  query: string,
  limit = 5,
): Promise<SpotifyTrack[] | null> {
  const q = query.trim();
  if (q.length < 2) {return [];}
  const res = await call<{ enabled?: boolean; tracks?: SpotifyTrack[] }>({
    action: 'search',
    q: q.slice(0, 100),
    limit,
  });
  if (res === null) {return null;}
  const tracks = res.tracks ?? [];
  for (const t of tracks) { trackCache.set(t.id, t); }
  return tracks;
}

// ── Link resolution ─────────────────────────────────────────────────────────

/** A pasted link (including spotify.link short links) → track id, or null. */
export async function resolveSpotifyLink(url: string): Promise<string | null> {
  const res = await call<{ id?: string | null }>({ action: 'resolve', url: url.trim().slice(0, 500) });
  const id = res?.id ?? null;
  return id && SPOTIFY_ID_RE.test(id) ? id : null;
}

/**
 * The same, remembered for the app session — chat re-renders a message many times, and a
 * short link only ever points at one song. Only real answers are kept: a failed call is
 * retried the next time the message is drawn.
 */
const resolvedLinks = new Map<string, string | null>();
export async function resolveSpotifyLinkCached(url: string): Promise<string | null> {
  if (resolvedLinks.has(url)) {return resolvedLinks.get(url) ?? null;}
  const res = await call<{ id?: string | null }>({ action: 'resolve', url: url.trim().slice(0, 500) });
  if (!res) {return null;}
  const id = res.id && SPOTIFY_ID_RE.test(res.id) ? res.id : null;
  resolvedLinks.set(url, id);
  return id;
}

// ── Track metadata (feed cards) ─────────────────────────────────────────────
//
// Cards ask one at a time as they mount; requests made within the same short window are
// sent as ONE call. Answers are cached for the app session only (Spotify allows temporary
// caching, not storage), and `null` — Spotify has no such track — is cached too, so a dead
// link does not refetch on every scroll.

const trackCache = new Map<string, SpotifyTrack | null>();
const waiters = new Map<string, Array<(t: SpotifyTrack | null) => void>>();
let pending = new Set<string>();
/** Ids whose call is in flight — a second card asking for one waits on that call. */
const inflight = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const BATCH_WINDOW_MS = 40;
const MAX_IDS_PER_CALL = 20;

async function flush(): Promise<void> {
  flushTimer = null;
  const ids = Array.from(pending);
  pending = new Set();
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_CALL) {
    const chunk = ids.slice(i, i + MAX_IDS_PER_CALL);
    chunk.forEach(id => inflight.add(id));
    const res = await call<{ tracks?: Record<string, SpotifyTrack | null> }>({
      action: 'tracks',
      ids: chunk,
    });
    for (const id of chunk) {
      const answered = res?.tracks && id in res.tracks;
      const track = answered ? res!.tracks![id] ?? null : null;
      // A failed CALL is not an answer: leave it uncached so the next mount retries.
      if (answered) { trackCache.set(id, track); }
      inflight.delete(id);
      const list = waiters.get(id) ?? [];
      waiters.delete(id);
      list.forEach(resolve => resolve(track));
    }
  }
}

/** Metadata for one track; batched with other requests made in the same moment. */
export function getSpotifyTrack(id: string): Promise<SpotifyTrack | null> {
  if (!SPOTIFY_ID_RE.test(id)) {return Promise.resolve(null);}
  if (trackCache.has(id)) {return Promise.resolve(trackCache.get(id) ?? null);}
  return new Promise(resolve => {
    const list = waiters.get(id) ?? [];
    list.push(resolve);
    waiters.set(id, list);
    if (!inflight.has(id)) { pending.add(id); }
    if (!flushTimer) { flushTimer = setTimeout(() => { void flush(); }, BATCH_WINDOW_MS); }
  });
}

export type SpotifyTrackState =
  | { status: 'loading'; track: null }
  | { status: 'ready'; track: SpotifyTrack }
  | { status: 'unavailable'; track: null };

function stateFromCache(id: string | null): SpotifyTrackState {
  if (!id) {return { status: 'unavailable', track: null };}
  if (!trackCache.has(id)) {return { status: 'loading', track: null };}
  const cached = trackCache.get(id) ?? null;
  return cached ? { status: 'ready', track: cached } : { status: 'unavailable', track: null };
}

/**
 * React wrapper for a card or the repost preview. Keyed by id: when the id changes the
 * answer is re-derived from the cache (or "loading") in the same render, so a newly picked
 * song never shows the previous song's — or no song's — state, not even for a frame.
 */
export function useSpotifyTrack(id: string | null): SpotifyTrackState {
  const [entry, setEntry] = useState<{ id: string | null; state: SpotifyTrackState }>(() => ({
    id,
    state: stateFromCache(id),
  }));
  const current = entry.id === id ? entry.state : stateFromCache(id);

  useEffect(() => {
    if (!id) {return;}
    let cancelled = false;
    getSpotifyTrack(id).then(track => {
      if (cancelled) {return;}
      // `null` here is either a real "no such track" or a failed call; only the former is
      // cached (see flush), so a later mount retries the latter.
      setEntry({ id, state: track ? { status: 'ready', track } : { status: 'unavailable', track: null } });
    });
    return () => { cancelled = true; };
  }, [id]);

  return current;
}

/** Seed the cache from a search result, so the repost screen and card render instantly. */
export function rememberSpotifyTrack(track: SpotifyTrack): void {
  trackCache.set(track.id, track);
}

// ── Opening Spotify ─────────────────────────────────────────────────────────

/**
 * Open the track in the Spotify app. The https URL is a universal link / app link: the
 * Spotify app opens it when installed, the browser (with a "get Spotify" prompt) when not.
 * The URL is built from a validated id — never from text a user typed.
 */
export async function openInSpotify(id: string): Promise<boolean> {
  if (!SPOTIFY_ID_RE.test(id)) {return false;}
  try {
    await Linking.openURL(spotifyTrackUrl(id));
    return true;
  } catch (e) {
    console.warn('[spotify] could not open Spotify', e);
    return false;
  }
}

/** Where a hand-off to Spotify started — mirrors spotify_opens_source_check. */
export type SpotifyOpenSource = 'feed' | 'chat' | 'search';

/**
 * Log a confirmed hand-off for the ops play stats (migration 20261014000000). Fire and
 * forget: a missing table, no session or a network error must never stand between the
 * listener and the song, so every failure is swallowed.
 */
export function recordSpotifyOpen(spotifyTrackId: string, source: SpotifyOpenSource): void {
  if (!SPOTIFY_ID_RE.test(spotifyTrackId)) {return;}
  void (async () => {
    try {
      const { data } = await supabase.auth.getUser();
      const me = data?.user?.id;
      if (!me) {return;}
      await supabase
        .from('spotify_opens')
        .insert({ spotify_track_id: spotifyTrackId, source, user_id: me });
    } catch {
      // Stats are a nice-to-have; the hand-off already happened.
    }
  })();
}

/** "The Weeknd, ROSALÍA" — or the fallback when Spotify gave no artist (oEmbed). */
export function artistLine(track: SpotifyTrack | null, fallback = 'Spotify'): string {
  const names = track?.artists?.filter(Boolean) ?? [];
  return names.length > 0 ? names.join(', ') : fallback;
}
