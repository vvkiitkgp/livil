import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

export type RepeatMode = 'off' | 'all' | 'one';

export type NowPlayingInfo = {
  postId: string;
  trackId: string;
  title: string;
  artistName: string;
  authorId: string;
  authorUsername: string;
  authorAvatarUrl: string | null;
  coverArtUrl: string | null;
  mediaKind: 'audio' | 'video';
  audioUrl?: string;
  videoUrl?: string;
  // Engagement snapshot at play-start time (not kept live to avoid re-renders)
  likesCount: number;
  commentsCount: number;
  repostsCount: number;
  viewsCount: number;
  viewerHasLiked: boolean;
  // Clip window from DB (null = full song). Stored here to reset the live clip
  // window when a new track starts playing.
  clipStartSec: number | null;
  clipEndSec: number | null;
  // Repost lineage — lets the player route to the *original* post when the
  // currently-playing item is itself a repost.
  kind: 'upload' | 'repost';
  originalPostId: string | null;
  // Known duration at play-start (from prior onLoad); 0 if not yet loaded.
  knownDurationSec: number;
};

export type PlayerHandlers = {
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  setRate: (rate: number) => void;
};

type PlaybackContextValue = {
  // --- existing ---
  activePostId: string | null;
  requestPlay: (postId: string) => void;
  reportPaused: (postId: string) => void;
  pauseAll: () => void;
  isActive: (postId: string) => boolean;

  // --- now playing ---
  nowPlaying: NowPlayingInfo | null;
  setNowPlaying: (info: NowPlayingInfo) => void;
  clearNowPlaying: () => void;

  // --- position / duration (refs — no re-renders) ---
  positionRef: React.MutableRefObject<number>;
  durationRef: React.MutableRefObject<number>;
  updatePosition: (seconds: number) => void;
  updateDuration: (seconds: number) => void;

  // --- clip window (ref — no re-renders; mutated by FullScreenPlayer on drag) ---
  clipWindowRef: React.MutableRefObject<{ start: number; end: number } | null>;

  // --- player handlers (ref — no re-renders) ---
  handlersRef: React.MutableRefObject<PlayerHandlers | null>;
  registerHandlers: (handlers: PlayerHandlers) => void;
  unregisterHandlers: () => void;

  // --- queue ---
  setQueue: (posts: NowPlayingInfo[], startIndex: number, source: string) => void;
  playNext: () => void;
  playPrev: () => void;
  playAtIndex: (index: number) => void;
  addToQueue: (track: NowPlayingInfo) => void;
  playTrackNext: (track: NowPlayingInfo) => void;
  moveQueueItem: (fromIndex: number, toIndex: number) => void;
  removeFromQueue: (index: number) => void;
  pendingPlayId: string | null;
  clearPendingPlay: () => void;
  queueRef: React.MutableRefObject<NowPlayingInfo[]>;
  currentIndexRef: React.MutableRefObject<number>;
  userQueueRef: React.MutableRefObject<NowPlayingInfo[]>;
  queueSourceRef: React.MutableRefObject<string>;
  // 'user' = play originated from a tap in the feed/profile (screens should update queue)
  // 'queue' = play originated from playNext/playPrev/playAtIndex (screens must NOT override queue)
  playSourceRef: React.MutableRefObject<'user' | 'queue'>;

  // --- full-screen player ---
  isFullScreenOpen: boolean;
  openFullScreenPlayer: () => void;
  closeFullScreenPlayer: () => void;

  // --- story viewer (hides FloatingPlayer while stories are fullscreen) ---
  isStoryViewerOpen: boolean;
  setStoryViewerOpen: (open: boolean) => void;

  // --- repost screen (hides FloatingPlayer while editing a repost clip) ---
  isRepostOpen: boolean;
  setRepostOpen: (open: boolean) => void;

  // --- jam lock (disables FloatingPlayer gestures while listening in a jam) ---
  jamLocked: boolean;
  setJamLocked: (locked: boolean) => void;

  // --- shuffle / repeat ---
  shuffleEnabled: boolean;
  toggleShuffle: () => void;
  repeatMode: RepeatMode;
  cycleRepeatMode: () => void;
};

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

export function PlaybackProvider({ children }: { children: React.ReactNode }) {
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);

  const [nowPlaying, setNowPlayingState] = useState<NowPlayingInfo | null>(null);
  const [pendingPlayId, setPendingPlayId] = useState<string | null>(null);
  const [isFullScreenOpen, setIsFullScreenOpen] = useState(false);
  const [isStoryViewerOpen, setIsStoryViewerOpenState] = useState(false);
  const [isRepostOpen, setIsRepostOpenState] = useState(false);
  const [jamLocked, setJamLockedState] = useState(false);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');

  const positionRef = useRef<number>(0);
  const durationRef = useRef<number>(0);
  const clipWindowRef = useRef<{ start: number; end: number } | null>(null);
  const handlersRef = useRef<PlayerHandlers | null>(null);
  const queueRef = useRef<NowPlayingInfo[]>([]);
  const currentIndexRef = useRef<number>(-1);
  const userQueueRef = useRef<NowPlayingInfo[]>([]);
  const shuffleOrderRef = useRef<number[]>([]);
  const shuffleIndexRef = useRef<number>(-1);
  const queueSourceRef = useRef<string>('home');
  const playSourceRef = useRef<'user' | 'queue'>('user');
  // Refs so playNext/playPrev stay stable (useCallback []) while still reading latest values.
  const shuffleRef = useRef(false);
  const repeatModeRef = useRef<RepeatMode>('off');

  // --- existing ---

  const requestPlay = useCallback((postId: string) => {
    if (activeRef.current === postId) { return; }
    playSourceRef.current = 'user';
    activeRef.current = postId;
    setActivePostId(postId);
  }, []);

  const reportPaused = useCallback((postId: string) => {
    if (activeRef.current === postId) {
      activeRef.current = null;
      setActivePostId(null);
    }
  }, []);

  const pauseAll = useCallback(() => {
    activeRef.current = null;
    setActivePostId(null);
  }, []);

  const isActive = useCallback((postId: string) => activeRef.current === postId, []);

  // --- now playing ---

  const setNowPlaying = useCallback((info: NowPlayingInfo) => {
    positionRef.current = 0;
    durationRef.current = info.knownDurationSec ?? 0;
    clipWindowRef.current = (info.clipStartSec !== null && info.clipEndSec !== null)
      ? { start: info.clipStartSec, end: info.clipEndSec }
      : null;
    setNowPlayingState(info);
  }, []);

  const clearNowPlaying = useCallback(() => {
    positionRef.current = 0;
    durationRef.current = 0;
    clipWindowRef.current = null;
    setNowPlayingState(null);
  }, []);

  // --- position / duration ---

  const updatePosition = useCallback((seconds: number) => {
    positionRef.current = seconds;
  }, []);

  const updateDuration = useCallback((seconds: number) => {
    durationRef.current = seconds;
  }, []);

  // --- handlers ---

  const registerHandlers = useCallback((handlers: PlayerHandlers) => {
    handlersRef.current = handlers;
  }, []);

  const unregisterHandlers = useCallback(() => {
    handlersRef.current = null;
  }, []);

  // --- queue ---

  const generateShuffleOrder = useCallback((startAfter: number, length: number) => {
    const indices: number[] = [];
    for (let i = 0; i < length; i++) {
      if (i !== startAfter) { indices.push(i); }
    }
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j]!, indices[i]!];
    }
    shuffleOrderRef.current = indices;
    shuffleIndexRef.current = -1;
  }, []);

  const playTrackAtIndex = useCallback((idx: number) => {
    const track = queueRef.current[idx];
    if (!track) { return; }
    playSourceRef.current = 'queue';
    currentIndexRef.current = idx;
    activeRef.current = track.postId;
    setActivePostId(track.postId);
    positionRef.current = 0;
    durationRef.current = track.knownDurationSec ?? 0;
    clipWindowRef.current = (track.clipStartSec !== null && track.clipEndSec !== null)
      ? { start: track.clipStartSec, end: track.clipEndSec }
      : null;
    setNowPlayingState(track);
    setPendingPlayId(track.postId);
  }, []);

  const setQueue = useCallback((posts: NowPlayingInfo[], startIndex: number, source: string) => {
    queueRef.current = posts;
    currentIndexRef.current = startIndex;
    userQueueRef.current = [];
    queueSourceRef.current = source;
    if (shuffleRef.current) {
      generateShuffleOrder(startIndex, posts.length);
    }
  }, [generateShuffleOrder]);

  const playNext = useCallback(() => {
    if (userQueueRef.current.length > 0) {
      const track = userQueueRef.current.shift()!;
      activeRef.current = track.postId;
      setActivePostId(track.postId);
      positionRef.current = 0;
      durationRef.current = track.knownDurationSec ?? 0;
      clipWindowRef.current = (track.clipStartSec !== null && track.clipEndSec !== null)
        ? { start: track.clipStartSec, end: track.clipEndSec }
        : null;
      setNowPlayingState(track);
      setPendingPlayId(track.postId);
      return;
    }

    const queue = queueRef.current;
    if (shuffleRef.current) {
      shuffleIndexRef.current++;
      if (shuffleIndexRef.current >= shuffleOrderRef.current.length) {
        if (repeatModeRef.current === 'all') {
          generateShuffleOrder(currentIndexRef.current, queue.length);
          shuffleIndexRef.current = 0;
        } else {
          return;
        }
      }
      const nextIdx = shuffleOrderRef.current[shuffleIndexRef.current]!;
      playTrackAtIndex(nextIdx);
    } else {
      let nextIdx = currentIndexRef.current + 1;
      if (nextIdx >= queue.length) {
        if (repeatModeRef.current === 'all') {
          nextIdx = 0;
        } else {
          return;
        }
      }
      playTrackAtIndex(nextIdx);
    }
  }, [generateShuffleOrder, playTrackAtIndex]);

  const playPrev = useCallback(() => {
    if (positionRef.current > 3) {
      handlersRef.current?.seek(0);
      positionRef.current = 0;
      return;
    }

    if (shuffleRef.current && shuffleIndexRef.current > 0) {
      shuffleIndexRef.current--;
      const prevIdx = shuffleOrderRef.current[shuffleIndexRef.current]!;
      playTrackAtIndex(prevIdx);
      return;
    }

    const prevIdx = currentIndexRef.current - 1;
    if (prevIdx < 0) {
      handlersRef.current?.seek(0);
      positionRef.current = 0;
      return;
    }
    playTrackAtIndex(prevIdx);
  }, [playTrackAtIndex]);

  const playAtIndex = useCallback((index: number) => {
    playTrackAtIndex(index);
    if (shuffleRef.current) {
      generateShuffleOrder(index, queueRef.current.length);
    }
  }, [playTrackAtIndex, generateShuffleOrder]);

  const addToQueue = useCallback((track: NowPlayingInfo) => {
    userQueueRef.current = [...userQueueRef.current, track];
  }, []);

  const playTrackNextFn = useCallback((track: NowPlayingInfo) => {
    userQueueRef.current = [track, ...userQueueRef.current];
  }, []);

  const moveQueueItem = useCallback((fromIndex: number, toIndex: number) => {
    const queue = [...queueRef.current];
    const [moved] = queue.splice(fromIndex, 1);
    if (!moved) { return; }
    queue.splice(toIndex, 0, moved);
    queueRef.current = queue;
    // Adjust currentIndexRef if it was affected by the move
    const cur = currentIndexRef.current;
    if (fromIndex === cur) {
      currentIndexRef.current = toIndex;
    } else if (fromIndex < cur && toIndex >= cur) {
      currentIndexRef.current = cur - 1;
    } else if (fromIndex > cur && toIndex <= cur) {
      currentIndexRef.current = cur + 1;
    }
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    const queue = [...queueRef.current];
    queue.splice(index, 1);
    queueRef.current = queue;
    const cur = currentIndexRef.current;
    if (index < cur) {
      currentIndexRef.current = cur - 1;
    } else if (index === cur && cur >= queue.length) {
      currentIndexRef.current = Math.max(0, queue.length - 1);
    }
  }, []);

  const clearPendingPlay = useCallback(() => {
    setPendingPlayId(null);
  }, []);

  const openFullScreenPlayer = useCallback(() => {
    setIsFullScreenOpen(true);
  }, []);

  const closeFullScreenPlayer = useCallback(() => {
    setIsFullScreenOpen(false);
  }, []);

  const setStoryViewerOpen = useCallback((open: boolean) => {
    setIsStoryViewerOpenState(open);
  }, []);

  const setRepostOpen = useCallback((open: boolean) => {
    setIsRepostOpenState(open);
  }, []);

  const setJamLocked = useCallback((locked: boolean) => {
    setJamLockedState(locked);
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffleEnabled(v => {
      const next = !v;
      shuffleRef.current = next;
      if (next) {
        generateShuffleOrder(currentIndexRef.current, queueRef.current.length);
      } else {
        shuffleOrderRef.current = [];
        shuffleIndexRef.current = -1;
      }
      return next;
    });
  }, [generateShuffleOrder]);

  const cycleRepeatMode = useCallback(() => {
    setRepeatMode(prev => {
      const next: RepeatMode = prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off';
      repeatModeRef.current = next;
      return next;
    });
  }, []);

  const value = useMemo<PlaybackContextValue>(
    () => ({
      activePostId,
      requestPlay,
      reportPaused,
      pauseAll,
      isActive,
      nowPlaying,
      setNowPlaying,
      clearNowPlaying,
      positionRef,
      durationRef,
      updatePosition,
      updateDuration,
      clipWindowRef,
      handlersRef,
      registerHandlers,
      unregisterHandlers,
      setQueue,
      playNext,
      playPrev,
      playAtIndex,
      addToQueue,
      playTrackNext: playTrackNextFn,
      moveQueueItem,
      removeFromQueue,
      pendingPlayId,
      clearPendingPlay,
      queueRef,
      currentIndexRef,
      userQueueRef,
      queueSourceRef,
      playSourceRef,
      isFullScreenOpen,
      openFullScreenPlayer,
      closeFullScreenPlayer,
      isStoryViewerOpen,
      setStoryViewerOpen,
      isRepostOpen,
      setRepostOpen,
      jamLocked,
      setJamLocked,
      shuffleEnabled,
      toggleShuffle,
      repeatMode,
      cycleRepeatMode,
    }),
    [
      activePostId,
      requestPlay,
      reportPaused,
      pauseAll,
      isActive,
      nowPlaying,
      setNowPlaying,
      clearNowPlaying,
      updatePosition,
      updateDuration,
      registerHandlers,
      unregisterHandlers,
      setQueue,
      playNext,
      playPrev,
      playAtIndex,
      addToQueue,
      playTrackNextFn,
      moveQueueItem,
      removeFromQueue,
      pendingPlayId,
      clearPendingPlay,
      isFullScreenOpen,
      openFullScreenPlayer,
      closeFullScreenPlayer,
      isStoryViewerOpen,
      setStoryViewerOpen,
      isRepostOpen,
      setRepostOpen,
      jamLocked,
      setJamLocked,
      shuffleEnabled,
      toggleShuffle,
      repeatMode,
      cycleRepeatMode,
    ],
  );

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

export function usePlayback(): PlaybackContextValue {
  const ctx = useContext(PlaybackContext);
  if (!ctx) { throw new Error('usePlayback must be used inside <PlaybackProvider>'); }
  return ctx;
}
