import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchHomeFeedPage,
  newHomeFeedSession,
  type FeedPost,
  type HomeFeedCursor,
  type HomeFeedSession,
  type HomeFeedTab,
} from '../services/posts';
import { avoidRepeatTop } from '../utils/avoidRepeatTop';

export type HomeFeedLoadMode = 'initial' | 'refresh' | 'prefetch' | 'end';

type Options = {
  pageSize: number;
  /**
   * A new pass is about to replace the list (cold open, pull-to-refresh). Home uses it to
   * settle the impressions being timed against cards that are on their way off screen.
   */
  onNewPass?: () => void;
  /** Posts the viewer deleted this session — never chosen as "the card that was on top". */
  isDeleted?: (postId: string) => boolean;
  /** A page arrived (Home warms the image cache with it). */
  onPage?: (posts: FeedPost[]) => void;
};

/**
 * One of Home's feeds — For you or New on Livil — with its own pass, cursor and list.
 *
 * Both tabs page the same way (they are the same ranker server-side, 20261026000000), so
 * this is For you's loading logic moved out of HomeScreen unchanged and instantiated once
 * per tab. Each keeps its own session: switching tabs and back must not reshuffle a feed
 * the viewer was halfway down.
 *
 * The refs are exposed because Home's viewability callback is created once and must read
 * the CURRENT values without re-subscribing (see HomeScreen's handleViewableItemsChanged).
 */
export function useHomeFeed(tab: HomeFeedTab, options: Options) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feedError, setFeedError] = useState('');
  // The server has no such feed (PostgREST "Could not find the function", e.g. the
  // migration not yet applied). Home hides the tab rather than show that.
  const [unavailable, setUnavailable] = useState(false);
  // Mirrors `nextCursorRef.current === null` as state so the footer re-renders when
  // pagination is exhausted (refs alone don't trigger re-renders).
  const [endOfFeed, setEndOfFeed] = useState(false);

  const postsRef = useRef<FeedPost[]>([]);
  postsRef.current = posts;
  const nextCursorRef = useRef<HomeFeedCursor | null>(null);
  // One pass through the feed. Replaced on cold open and on every refresh; every page in
  // between is fetched with the SAME session, which is what keeps the ranking still while
  // the viewer scrolls (PROP-0010 phase 2).
  const sessionRef = useRef<HomeFeedSession>(newHomeFeedSession());
  const loadingMoreRef = useRef(false);
  const loadingInitialRef = useRef(true);
  /** Whether a first load has been asked for — New on Livil waits until it is opened. */
  const startedRef = useRef(false);

  useEffect(() => {
    loadingInitialRef.current = loadingInitial;
  }, [loadingInitial]);

  const appendFeedPage = useCallback(async (mode: HomeFeedLoadMode) => {
    if (loadingMoreRef.current) {
      return;
    }
    if ((mode === 'prefetch' || mode === 'end') && nextCursorRef.current === null) {
      return;
    }

    loadingMoreRef.current = true;
    // Surface the skeleton footer for any pagination fetch (prefetch + end).
    // Initial/refresh are handled by their own indicators, not this footer.
    if (mode === 'end' || mode === 'prefetch') {
      setLoadingMore(true);
    }
    if (mode === 'initial' || mode === 'refresh') {
      startedRef.current = true;
      // A new pass gets a new seed and a new decay origin — this is what makes pulling
      // down actually re-rank rather than hand back the page already on screen. Minted
      // before the fetch below reads it.
      sessionRef.current = newHomeFeedSession();
      optionsRef.current.onNewPass?.();
    }
    if (mode === 'initial') {
      setLoadingInitial(true);
      setFeedError('');
      nextCursorRef.current = null;
      setPosts([]);
      setEndOfFeed(false);
    }
    if (mode === 'refresh') {
      setFeedError('');
      nextCursorRef.current = null;
      setEndOfFeed(false);
    }

    try {
      const cursor = mode === 'initial' || mode === 'refresh' ? null : nextCursorRef.current;

      const { posts: chunk, nextCursor } = await fetchHomeFeedPage({
        limit: optionsRef.current.pageSize,
        cursor,
        session: sessionRef.current,
        tab,
      });

      optionsRef.current.onPage?.(chunk);

      // The post the viewer was just looking at at the top, for avoidRepeatTop. Read
      // BEFORE setPosts replaces the list.
      const isDeleted = optionsRef.current.isDeleted ?? (() => false);
      const previousTopId = postsRef.current.find(post => !isDeleted(post.id))?.id;

      setPosts(prev => {
        if (mode === 'refresh') {
          return avoidRepeatTop(chunk, previousTopId);
        }
        if (mode === 'initial') {
          return chunk;
        }
        const seen = new Set(prev.map(p => p.id));
        const merged = chunk.filter(p => !seen.has(p.id));
        return [...prev, ...merged];
      });

      nextCursorRef.current = nextCursor;
      setEndOfFeed(nextCursor === null);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message || 'Could not load your feed.'
          : typeof err === 'string'
            ? err
            : 'Could not load your feed.';
      if (/could not find the function|PGRST202/i.test(message)) {
        setUnavailable(true);
      }
      if (mode === 'initial' || mode === 'refresh') {
        setFeedError(message);
      }
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
      setLoadingInitial(false);
    }
  }, [tab]);

  return {
    tab,
    posts,
    loadingInitial,
    loadingMore,
    feedError,
    endOfFeed,
    unavailable,
    appendFeedPage,
    postsRef,
    nextCursorRef,
    loadingMoreRef,
    loadingInitialRef,
    startedRef,
  };
}

export type HomeFeedState = ReturnType<typeof useHomeFeed>;
