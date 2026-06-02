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
  // null = no clip active (play full track). Initialized from NowPlayingInfo.clipStartSec/clipEndSec
  // when setNowPlaying is called, then editable by the user in FullScreenPlayer.
  clipWindowRef: React.MutableRefObject<{ start: number; end: number } | null>;

  // --- player handlers (ref — no re-renders) ---
  handlersRef: React.MutableRefObject<PlayerHandlers | null>;
  registerHandlers: (handlers: PlayerHandlers) => void;
  unregisterHandlers: () => void;

  // --- queue + next / prev ---
  setQueue: (posts: NowPlayingInfo[]) => void;
  playNext: () => void;
  playPrev: () => void;
  pendingPlayId: string | null;
  clearPendingPlay: () => void;
  queueRef: React.MutableRefObject<NowPlayingInfo[]>;

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
  // Refs so playNext/playPrev stay stable (useCallback []) while still reading latest values.
  const shuffleRef = useRef(false);
  const repeatModeRef = useRef<RepeatMode>('off');

  // --- existing ---

  const requestPlay = useCallback((postId: string) => {
    if (activeRef.current === postId) { return; }
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

  const setQueue = useCallback((posts: NowPlayingInfo[]) => {
    queueRef.current = posts;
  }, []);

  const playNext = useCallback(() => {
    const queue = queueRef.current;
    const nowId = activeRef.current;
    const idx = queue.findIndex(p => p.postId === nowId);

    let next: NowPlayingInfo | undefined;
    if (shuffleRef.current) {
      const remaining = queue.filter((_, i) => i !== idx);
      if (remaining.length > 0) {
        next = remaining[Math.floor(Math.random() * remaining.length)];
      }
    } else {
      next = queue[idx + 1];
      if (!next && repeatModeRef.current === 'all') {
        next = queue[0];
      }
    }
    if (!next) { return; }
    activeRef.current = next.postId;
    setActivePostId(next.postId);
    setPendingPlayId(next.postId);
  }, []);

  const playPrev = useCallback(() => {
    const queue = queueRef.current;
    const nowId = activeRef.current;
    const idx = queue.findIndex(p => p.postId === nowId);
    const prev = queue[idx - 1];
    if (!prev) { return; }
    activeRef.current = prev.postId;
    setActivePostId(prev.postId);
    setPendingPlayId(prev.postId);
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
      shuffleRef.current = !v;
      return !v;
    });
  }, []);

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
      pendingPlayId,
      clearPendingPlay,
      queueRef,
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
