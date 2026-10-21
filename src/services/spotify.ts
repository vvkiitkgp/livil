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
import { SPOTIFY_ID_RE, looksLikeSpotifyLink, parseSpotifyTrackId, spotifyTrackUrl } from '../utils/spotifyLinks';

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
  reposts: boolean | null;
  /** Is Spotify search configured? Without it, only pasting a link works. */
  search: boolean | null;
  /**
   * The kill switch for "Repost the song you copied?" (spotify_copied_links_enabled()).
   * Off: no clipboard check at all, and no "Detect copied Spotify links" row in Settings.
   */
  copiedLinks: boolean | null;
};
// Every answer above is three-way: `true`, `false`, or `null` — NOT KNOWN YET (still
// asking, signed out, offline, a timeout). `null` is falsy, so `if (a.reposts)` keeps
// hiding a feature until the server says yes. An entry point that must never lose a
// working feature to a failed check asks `!== false` instead: Home's "+ Track" used to
// skip the Upload / Spotify chooser whenever the check had failed — and remembered that
// "off" for five minutes (2026-10-21, a relative's phone).

const UNKNOWN: SpotifyAvailability = { reposts: null, search: null, copiedLinks: null };

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
// Three independent answers, asked in parallel:
//   reposts     — the switch, which lives in the DATABASE (spotify_reposts_enabled()), where it
//                 also refuses the insert. A missing function (migration not applied) is "off".
//   search      — whether the edge function has Spotify credentials.
//   copiedLinks — the kill switch for the copied-link check (spotify_copied_links_enabled(),
//                 20261114000000). Same rule: a missing function is "off".
//
// Only a real answer counts. A failed question leaves that answer as it was (`null`, or the
// last real answer) and is asked again in seconds, not minutes — a miss is never cached as
// "off". Signed out, nothing is asked at all (every question would be refused), and signing
// in asks at once.
//
// Real answers are cached for a few minutes and re-asked when the app returns to the
// foreground, so the owner flipping a switch reaches open apps without a restart. Every
// mounted hook hears every new answer, not only the one that asked.

const AVAILABILITY_TTL_MS = 5 * 60 * 1000;
/** How soon an answer with a gap in it is asked again. */
const AVAILABILITY_RETRY_MS = 15 * 1000;
let availability: { value: SpotifyAvailability; at: number; complete: boolean } | null = null;
let availabilityInFlight: Promise<SpotifyAvailability> | null = null;
/** Bumped on sign-in: an answer asked for before it (refused, signed out) is dropped. */
let availabilityEpoch = 0;
const availabilityListeners = new Set<(value: SpotifyAvailability) => void>();

/** A database switch: on/off, or null when the question could not be asked. */
function switchAnswer(res: { data: unknown; error: { code?: string } | null } | null): boolean | null {
  if (!res) {return null;}
  if (!res.error) {return res.data === true;}
  // PGRST202: no such function — the migration is not applied, so the feature is off.
  // Anything else (permission, network, timeout) says nothing about the switch.
  return res.error.code === 'PGRST202' ? false : null;
}

async function fetchAvailability(): Promise<SpotifyAvailability> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {return UNKNOWN;}
  const [repostsRes, statusRes, copiedRes] = await Promise.all([
    Promise.resolve(supabase.rpc('spotify_reposts_enabled')).catch(() => null),
    call<{ search?: boolean }>({ action: 'status' }),
    Promise.resolve(supabase.rpc('spotify_copied_links_enabled')).catch(() => null),
  ]);
  return {
    reposts: switchAnswer(repostsRes),
    search: statusRes ? statusRes.search === true : null,
    copiedLinks: switchAnswer(copiedRes),
  };
}

function sameAvailability(a: SpotifyAvailability, b: SpotifyAvailability): boolean {
  return a.reposts === b.reposts && a.search === b.search && a.copiedLinks === b.copiedLinks;
}

export function getSpotifyAvailability(): Promise<SpotifyAvailability> {
  if (availability) {
    const ttl = availability.complete ? AVAILABILITY_TTL_MS : AVAILABILITY_RETRY_MS;
    if (Date.now() - availability.at < ttl) {return Promise.resolve(availability.value);}
  }
  if (!availabilityInFlight) {
    const epoch = availabilityEpoch;
    const request: Promise<SpotifyAvailability> = fetchAvailability()
      .catch(() => UNKNOWN)
      .then(fresh => {
        if (epoch !== availabilityEpoch) {return availability?.value ?? UNKNOWN;}
        const prev = availability?.value ?? UNKNOWN;
        const value: SpotifyAvailability = {
          reposts: fresh.reposts ?? prev.reposts,
          search: fresh.search ?? prev.search,
          copiedLinks: fresh.copiedLinks ?? prev.copiedLinks,
        };
        const complete = fresh.reposts !== null && fresh.search !== null && fresh.copiedLinks !== null;
        availability = { value, at: Date.now(), complete };
        availabilityListeners.forEach(listener => listener(value));
        return value;
      })
      .finally(() => {
        if (availabilityInFlight === request) {availabilityInFlight = null;}
      });
    availabilityInFlight = request;
  }
  return availabilityInFlight;
}

let watchingAuth = false;
/** Signing in asks again at once: anything asked before it was refused. Registered once. */
function watchAuthForAvailability(): void {
  if (watchingAuth) {return;}
  watchingAuth = true;
  supabase.auth.onAuthStateChange(event => {
    if (event !== 'SIGNED_IN') {return;}
    availabilityEpoch += 1;
    availabilityInFlight = null;
    if (availability) {availability = { ...availability, at: 0 };}
    void getSpotifyAvailability();
  });
}

/**
 * React wrapper. Starts from the cached answer (or "not known yet"), hears every new answer,
 * and re-asks whenever the app comes back to the foreground — the TTL above keeps that to
 * one request per few minutes.
 */
export function useSpotifyAvailability(): SpotifyAvailability {
  const [value, setValue] = useState<SpotifyAvailability>(availability?.value ?? UNKNOWN);
  useEffect(() => {
    watchAuthForAvailability();
    const listener = (next: SpotifyAvailability) => {
      setValue(prev => (sameAvailability(prev, next) ? prev : next));
    };
    availabilityListeners.add(listener);
    // An answer that landed between the first render and this effect.
    if (availability) {listener(availability.value);}
    void getSpotifyAvailability();
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active') {void getSpotifyAvailability();}
    });
    return () => {
      availabilityListeners.delete(listener);
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
 * What every Spotify search box says when Spotify turned the search down (owner's words,
 * 2026-10-20) — not "no results": while Spotify is limiting us, an honest "busy" plus the
 * path that still works (a pasted link, answered without a search) beats a false "nothing".
 */
export const SPOTIFY_SEARCH_BUSY =
  'Spotify search is busy right now. Please try after some time, or paste a Spotify link.';

/**
 * The same search, but a FAILED search resolves to `null` instead of `[]`.
 *
 * For the one screen where Spotify search is the whole point (Repost from Spotify). There,
 * "no matches" and "Spotify refused" must read differently: the function answers 502 when
 * Spotify turns a search down (e.g. the developer account's Premium lapsing), and showing
 * `Nothing on Spotify for "Taylor Swift"` for that looks like a broken feature — exactly
 * what an App Reviewer would report. Every Spotify search box now uses it, and shows
 * SPOTIFY_SEARCH_BUSY for a `null` (2026-10-20: the Search tab said "Nothing matches" while
 * Spotify was limiting us).
 */
export async function searchSpotifyOrFail(
  query: string,
  limit = 5,
): Promise<SpotifyTrack[] | null> {
  const q = query.trim();
  if (q.length < 2) {return [];}
  // A pasted Spotify link is answered as that one song, not searched for — every Spotify
  // search box takes one. It also works while Spotify is limiting our searches: one song's
  // details fall back to Spotify's public preview (title and artwork) instead of failing,
  // which is why SPOTIFY_SEARCH_BUSY can offer it.
  if (looksLikeSpotifyLink(q)) {
    const id = parseSpotifyTrackId(q) ?? await resolveSpotifyLinkCached(q);
    if (!id) {return [];}
    const track = await getSpotifyTrack(id);
    return track ? [track] : [];
  }
  const res = await call<{ enabled?: boolean; tracks?: SpotifyTrack[] }>({
    action: 'search',
    q: q.slice(0, 100),
    limit,
  });
  if (res === null) {return null;}
  const tracks = res.tracks ?? [];
  for (const t of tracks) { cacheTrack(t.id, t); }
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
// link does not refetch on every scroll. An answer without artists is the exception: see
// STAND_IN_TTL_MS.

const trackCache = new Map<string, { track: SpotifyTrack | null; at: number }>();

/**
 * How long an answer WITHOUT artists is kept. That is the server's stand-in (Spotify's oEmbed:
 * title and artwork only) while the Web API is limiting us — kept for the session like a real
 * answer, it stuck on every card ("Spotify" where the artists go) until the app was restarted,
 * long after Spotify had recovered (2026-10-19). Kept briefly, the next mount asks again.
 */
export const STAND_IN_TTL_MS = 2 * 60 * 1000;

function cacheTrack(id: string, track: SpotifyTrack | null): void {
  trackCache.set(id, { track, at: Date.now() });
}

/** The cached answer for `id`, or undefined when there is none (or a stand-in has aged out). */
function cachedTrack(id: string): { track: SpotifyTrack | null } | undefined {
  const entry = trackCache.get(id);
  if (!entry) {return undefined;}
  if (entry.track && entry.track.artists.length === 0 && Date.now() - entry.at > STAND_IN_TTL_MS) {
    trackCache.delete(id);
    return undefined;
  }
  return entry;
}
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
      if (answered) { cacheTrack(id, track); }
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
  const hit = cachedTrack(id);
  if (hit) {return Promise.resolve(hit.track);}
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
  const hit = cachedTrack(id);
  if (!hit) {return { status: 'loading', track: null };}
  const cached = hit.track;
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
  cacheTrack(track.id, track);
}

/**
 * Post id → Spotify track id, for whichever of these posts are Spotify reposts.
 *
 * Read with its own query, never added to an existing select or RPC: this app must keep
 * working against a database that does not have `posts.spotify_track_id` yet, and selecting
 * a missing column fails the WHOLE query. Callers pass only posts that came back with no
 * Livil track — a Spotify repost is the only post without one (posts_media_source_check).
 *
 * Fail-safe: any error is an empty map, and the caller draws what it would have drawn
 * without Spotify.
 */
export async function fetchSpotifyTrackIds(postIds: string[]): Promise<Map<string, string>> {
  const byId = new Map<string, string>();
  if (postIds.length === 0) {return byId;}
  try {
    const { data, error } = await supabase
      .from('posts')
      .select('id, spotify_track_id')
      .in('id', postIds);
    if (error || !data) {return byId;}
    for (const row of data as Array<{ id: string; spotify_track_id: string | null }>) {
      if (row.spotify_track_id) { byId.set(row.id, row.spotify_track_id); }
    }
  } catch {
    // Same as an error response: nothing is known to be a Spotify repost.
  }
  return byId;
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
/** 'library' = Library → Recently Played (allowed from migration 20261108000000). */
export type SpotifyOpenSource = 'feed' | 'chat' | 'search' | 'library';

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
