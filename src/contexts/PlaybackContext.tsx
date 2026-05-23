import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

export type NowPlayingInfo = {
  postId: string;
  title: string;
  artistName: string;
  coverArtUrl: string | null;
  mediaKind: 'audio' | 'video';
  videoUrl?: string;
};

type PlayerHandlers = {
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
};

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

export function PlaybackProvider({ children }: { children: React.ReactNode }) {
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);

  const [nowPlaying, setNowPlayingState] = useState<NowPlayingInfo | null>(null);
  const [pendingPlayId, setPendingPlayId] = useState<string | null>(null);
  const [isFullScreenOpen, setIsFullScreenOpen] = useState(false);

  const positionRef = useRef<number>(0);
  const durationRef = useRef<number>(0);
  const handlersRef = useRef<PlayerHandlers | null>(null);
  const queueRef = useRef<NowPlayingInfo[]>([]);

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
    setNowPlayingState(info);
  }, []);

  const clearNowPlaying = useCallback(() => {
    positionRef.current = 0;
    durationRef.current = 0;
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
    const nowId = activeRef.current ?? (handlersRef.current ? null : null);
    const idx = queue.findIndex(p => p.postId === nowId);
    const next = queue[idx + 1];
    if (!next) { return; }
    // Request the next post to play; its PostCard will auto-start via pendingPlayId.
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
    ],
  );

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

export function usePlayback(): PlaybackContextValue {
  const ctx = useContext(PlaybackContext);
  if (!ctx) { throw new Error('usePlayback must be used inside <PlaybackProvider>'); }
  return ctx;
}
