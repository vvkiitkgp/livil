import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { fetchProfileBadges, type ProfileBadge } from '../services/profileBadges';

/**
 * Badges for whoever is currently on screen, fetched in batches and cached.
 *
 * THE FETCH IS THE WHOLE PROBLEM. Rendering a badge beside a username is trivial; asking
 * the server about each username is not. A feed of twenty posts, each with an author and
 * possibly an original author, plus a comment sheet, is forty round trips if every row
 * asks for itself. So rows do not ask — they REGISTER, and every id registered inside one
 * tick is answered by a single call.
 *
 * WHY NOT LOAD EVERY HOLDER ONCE, like RelationshipContext does with friends and stars?
 * Because that set is bounded by one person's relationships, and this one is not: it grows
 * with every Verified creator, forever. A hundred rows today, unbounded later. Batching has
 * no such cliff, and it needs no new server function — `badges_for_profiles` already takes
 * a list, so this ships without a migration.
 *
 * NEVER EVICTS, deliberately. The entries are tiny — a uuid and at most two short strings —
 * and the working set is whoever the user has scrolled past this session. Eviction would
 * buy nothing and would guarantee a refetch every time somebody scrolled back up.
 *
 * FAIL-SAFE ALL THE WAY DOWN. `fetchProfileBadges` never throws; a failure caches nothing,
 * and a missing entry renders no badge. A badge outage must never blank a feed.
 */

type BadgeMap = Record<string, ProfileBadge[]>;

type ProfileBadgesValue = {
  /** Badges for one user. Empty until the batch lands, and empty for anyone with none. */
  badgesFor: (userId: string) => ProfileBadge[];
  /** Register interest. Safe to call every render; already-known ids cost nothing. */
  request: (userIds: string[]) => void;
  /** Drop a user from the cache so the next request refetches — after a grant, say. */
  invalidate: (userId: string) => void;
  /** Bumped once per resolved batch. Consumers re-render off this; see the memo below. */
  version: number;
};

const Ctx = createContext<ProfileBadgesValue | null>(null);

const EMPTY: ProfileBadge[] = [];

export function ProfileBadgesProvider({ children }: { children: React.ReactNode }) {
  /**
   * The cache lives in a ref, not state: it is written from a batch callback that may
   * resolve after any number of renders, and rewriting a state object per row registration
   * would re-render the whole tree mid-scroll. `version` is the only state, bumped once
   * per resolved batch, which is what tells consumers to read again.
   */
  const cache = useRef<BadgeMap>({});
  /** Ids seen and either answered or in flight — so nothing is asked for twice. */
  const known = useRef<Set<string>>(new Set());
  const pending = useRef<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    // SET TRUE ON MOUNT, not just false on cleanup. A ref initialised once at creation is
    // not re-initialised when the component remounts — and Fast Refresh remounts providers
    // constantly in development. After one cleanup this would stay false forever: every
    // batch would fetch correctly, discard its result at the mounted check, and no badge
    // would ever appear again, with nothing logged. React 18 StrictMode's double-invoked
    // effects produce the same state on the first mount.
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) { clearTimeout(timer.current); }
    };
  }, []);

  const flush = useCallback(async () => {
    timer.current = null;
    const ids = [...pending.current];
    pending.current.clear();
    if (ids.length === 0) { return; }

    let byUser: BadgeMap;
    try {
      byUser = await fetchProfileBadges(ids);
    } catch (e) {
      // fetchProfileBadges is documented as fail-safe and should never land here — but
      // relying on that from inside a `void flush()` would turn a future change into an
      // unhandled rejection. The important part is UN-KNOWING the ids: leaving them marked
      // known with nothing cached means they are never retried and never render a badge
      // again for the rest of the session, which is a far worse failure than one lost batch.
      for (const id of ids) { known.current.delete(id); }
      console.warn('[profileBadges] batch failed; will retry on next request', e);
      return;
    }
    if (!mounted.current) { return; }

    // EVERY id asked for is recorded, not just the ones that came back. Somebody with no
    // badges is an answer — without this they would be re-requested on every render, which
    // is the majority of users and therefore most of the traffic.
    for (const id of ids) { cache.current[id] = byUser[id] ?? EMPTY; }
    setVersion(v => v + 1);
  }, []);

  const request = useCallback((userIds: string[]) => {
    let added = false;
    for (const id of userIds) {
      if (!id || known.current.has(id)) { continue; }
      known.current.add(id);
      pending.current.add(id);
      added = true;
    }
    if (!added || timer.current) { return; }
    // A short window rather than a microtask: a FlatList mounts its rows across several
    // frames, so a microtask would still fire once per frame. 50ms collapses the initial
    // screenful into one call and is far below noticing.
    timer.current = setTimeout(() => { void flush(); }, 50);
  }, [flush]);

  const badgesFor = useCallback((userId: string) => cache.current[userId] ?? EMPTY, []);

  const invalidate = useCallback((userId: string) => {
    known.current.delete(userId);
    delete cache.current[userId];
    setVersion(v => v + 1);
  }, []);

  /**
   * `version` IS in the value, and that is load-bearing. The three functions are stable and
   * the cache lives in a ref, so a memo without it would never produce a new context value
   * — consumers would keep the identity they mounted with and never re-render when a batch
   * resolved. The badge would arrive in the cache and never appear on screen.
   *
   * Including it means every resolved batch re-renders every consumer, which is acceptable
   * precisely because it happens once per batch rather than once per row.
   */
  const value = useMemo<ProfileBadgesValue>(
    () => ({ badgesFor, request, invalidate, version }),
    [badgesFor, request, invalidate, version],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Badges for one user, registering interest on the way.
 *
 * The single call every row makes. Safe to call unconditionally: registration is idempotent
 * and an id already known costs nothing beyond a Set lookup.
 */
export function useBadgesFor(userId: string | null | undefined): ProfileBadge[] {
  const { badgesFor, request } = useProfileBadges();

  useEffect(() => {
    if (userId) { request([userId]); }
  }, [userId, request]);

  return userId ? badgesFor(userId) : EMPTY;
}

export function useProfileBadges(): ProfileBadgesValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useProfileBadges must be used inside ProfileBadgesProvider');
  }
  return ctx;
}
