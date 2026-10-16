/**
 * GIFs in comments — the app side of the `gifs` edge function (ADR-0031).
 *
 * Everything here is FAIL-SAFE by contract, as in services/spotify.ts: a missing function,
 * no key, GIPHY being down or rate-limiting us all resolve to "not available" / null,
 * never a thrown error. The UI hides the GIF button or shows a quiet fallback.
 *
 * The app never talks to GIPHY. It sees only the `Gif` shape the function returns, and
 * every GIF in it is already rated PG-13 or below — the function filters on the way out.
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../../lib/supabase';
import { GIF_ID_RE } from '../utils/gifIds';

/** What the edge function returns for a GIF. Nothing else from GIPHY reaches the app. */
export type Gif = {
  id: string;
  provider: 'giphy';
  /** For screen readers; may be empty. */
  title: string;
  /** Of `url`, in px. */
  width: number;
  height: number;
  /** What a comment shows: ~200 px wide, animated. */
  url: string;
  /** What the picker grid shows: fewer frames, so a full grid loads fast. */
  previewUrl: string;
};

async function call<T>(body: Record<string, unknown>): Promise<T | null> {
  try {
    const { data, error } = await supabase.functions.invoke('gifs', { body });
    if (error) {
      console.warn('[gifs] function returned an error', body.action, error.message ?? error);
      return null;
    }
    return (data ?? null) as T | null;
  } catch (e) {
    console.warn('[gifs] call failed', body.action, e);
    return null;
  }
}

// ── Availability ────────────────────────────────────────────────────────────
//
// "Is there a GIF button?" = does the function answer `enabled: true`. A function that is
// not deployed yet, or has no key, is "no". Cached for a few minutes and re-asked when the
// app returns to the foreground, so deploying (or removing the key) reaches open apps
// without a restart.

const AVAILABILITY_TTL_MS = 5 * 60 * 1000;
let availability: { enabled: boolean; at: number } | null = null;
let availabilityInFlight: Promise<boolean> | null = null;

export function getGifsEnabled(): Promise<boolean> {
  if (availability && Date.now() - availability.at < AVAILABILITY_TTL_MS) {
    return Promise.resolve(availability.enabled);
  }
  if (!availabilityInFlight) {
    availabilityInFlight = call<{ enabled?: boolean }>({ action: 'status' })
      .then(res => {
        const enabled = res?.enabled === true;
        availability = { enabled, at: Date.now() };
        return enabled;
      })
      .finally(() => { availabilityInFlight = null; });
  }
  return availabilityInFlight;
}

export function useGifsEnabled(): boolean {
  const [enabled, setEnabled] = useState(availability?.enabled ?? false);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getGifsEnabled().then(v => { if (!cancelled) { setEnabled(v); } });
    };
    refresh();
    const sub = AppState.addEventListener('change', next => { if (next === 'active') { refresh(); } });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);
  return enabled;
}

// ── Search ──────────────────────────────────────────────────────────────────

export type GifPage = { gifs: Gif[]; next: number | null };

export const MAX_GIF_QUERY_LENGTH = 50;

// The first trending page, held for a few minutes: every picker open starts there, and on
// a beta key each open would otherwise cost one of the app's 100 calls an hour.
const TRENDING_TTL_MS = 5 * 60 * 1000;
let trending: { page: GifPage; at: number } | null = null;

/**
 * One page of GIFs: trending for an empty query, else a search. Resolves to `null` when
 * the search FAILED (GIPHY down, our hourly quota spent), so the picker can say "GIFs
 * aren't available right now" instead of the misleading "No GIFs for …".
 */
export async function searchGifs(query: string, offset = 0): Promise<GifPage | null> {
  const q = query.trim().slice(0, MAX_GIF_QUERY_LENGTH);
  const firstTrending = !q && offset === 0;
  if (firstTrending && trending && Date.now() - trending.at < TRENDING_TTL_MS) { return trending.page; }
  const res = await call<{ enabled?: boolean; gifs?: Gif[]; next?: number | null }>(
    q ? { action: 'search', q, offset } : { action: 'trending', offset },
  );
  if (!res || res.enabled !== true) { return null; }
  const gifs = (res.gifs ?? []).filter(g => GIF_ID_RE.test(g.id));
  const page = { gifs, next: typeof res.next === 'number' ? res.next : null };
  if (firstTrending) { trending = { page, at: Date.now() }; }
  return page;
}

// ── Lookup (the comments that show a GIF) ───────────────────────────────────
//
// A comment stores only the GIF's id; its media URL is fetched fresh (ADR-0031). Asks made
// within a short window go out as ONE call — `prefetchGifs` puts a whole comment sheet in
// one. Answers are held for the app session; `null` (removed, or rated above PG-13) is held
// too. A failed CALL is not an answer: it resolves `undefined` and is never held.

const gifCache = new Map<string, Gif | null>();
const waiters = new Map<string, Array<(g: Gif | null | undefined) => void>>();
let pending = new Set<string>();
const inflight = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const BATCH_WINDOW_MS = 40;
const MAX_IDS_PER_CALL = 50;

/** Only a GIF the card can actually draw counts; anything else is "not available". */
function usableGif(value: unknown): Gif | null {
  if (!value || typeof value !== 'object') { return null; }
  const g = value as Partial<Gif>;
  return typeof g.id === 'string' && typeof g.url === 'string' && typeof g.previewUrl === 'string'
    && typeof g.width === 'number' && typeof g.height === 'number'
    ? g as Gif
    : null;
}

async function flush(): Promise<void> {
  flushTimer = null;
  const ids = Array.from(pending);
  pending = new Set();
  // All of them, before the first call: an ask for an id in a later chunk must wait for
  // that chunk, not queue a second call for it.
  ids.forEach(id => inflight.add(id));
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_CALL) {
    const chunk = ids.slice(i, i + MAX_IDS_PER_CALL);
    const res = await call<{ gifs?: Record<string, unknown> }>({ action: 'lookup', ids: chunk });
    for (const id of chunk) {
      // OWN keys only: `'constructor' in {}` is true, and "constructor" is a valid GIF id
      // that anyone can write into a comment row.
      const answered = !!res?.gifs && Object.prototype.hasOwnProperty.call(res.gifs, id);
      const gif = answered ? usableGif(res!.gifs![id]) : undefined;
      if (gif !== undefined) { gifCache.set(id, gif); }
      inflight.delete(id);
      const list = waiters.get(id) ?? [];
      waiters.delete(id);
      list.forEach(resolve => resolve(gif));
    }
  }
}

/**
 * The GIF for an id, batched with other asks made in the same moment: a GIF, `null` when
 * it is not available (removed, or refused), or `undefined` when the lookup could not be
 * made (GIPHY down, quota spent) — which is not the same thing, and is not remembered.
 */
export function getGif(id: string): Promise<Gif | null | undefined> {
  if (!GIF_ID_RE.test(id)) { return Promise.resolve(null); }
  if (gifCache.has(id)) { return Promise.resolve(gifCache.get(id) ?? null); }
  return new Promise(resolve => {
    const list = waiters.get(id) ?? [];
    list.push(resolve);
    waiters.set(id, list);
    if (!inflight.has(id)) { pending.add(id); }
    if (!flushTimer) { flushTimer = setTimeout(() => { void flush(); }, BATCH_WINDOW_MS); }
  });
}

/**
 * Ask for every GIF in a comment sheet at once, as soon as its comments arrive. Without
 * this the list's rows mount in batches ~50 ms apart, each batch outside the last one's
 * window — several calls per sheet where one does.
 */
export function prefetchGifs(ids: string[]): void {
  ids.forEach(id => { void getGif(id); });
}

export type GifState =
  | { status: 'loading'; gif: null }
  | { status: 'ready'; gif: Gif }
  /** Removed, or refused by the rating filter. */
  | { status: 'unavailable'; gif: null }
  /** The lookup could not be made; the next mount asks again. */
  | { status: 'failed'; gif: null };

function stateFromCache(id: string): GifState {
  if (!gifCache.has(id)) { return { status: 'loading', gif: null }; }
  const cached = gifCache.get(id) ?? null;
  return cached ? { status: 'ready', gif: cached } : { status: 'unavailable', gif: null };
}

/** React wrapper for a comment's GIF. Keyed by id, re-derived from the cache in the same render. */
export function useGif(id: string): GifState {
  const [entry, setEntry] = useState<{ id: string; state: GifState }>(() => ({ id, state: stateFromCache(id) }));
  const current = entry.id === id ? entry.state : stateFromCache(id);

  useEffect(() => {
    let cancelled = false;
    getGif(id).then(gif => {
      if (cancelled) { return; }
      const state: GifState = gif
        ? { status: 'ready', gif }
        : gif === null ? { status: 'unavailable', gif: null } : { status: 'failed', gif: null };
      setEntry({ id, state });
    });
    return () => { cancelled = true; };
  }, [id]);

  return current;
}

/** Seed the cache from the picker, so the comment just posted draws without a lookup. */
export function rememberGif(gif: Gif): void {
  gifCache.set(gif.id, gif);
}

/** Test-only. */
export function __resetGifsForTest(): void {
  gifCache.clear();
  waiters.clear();
  pending = new Set();
  inflight.clear();
  if (flushTimer) { clearTimeout(flushTimer); }
  flushTimer = null;
  availability = null;
  availabilityInFlight = null;
  trending = null;
}
