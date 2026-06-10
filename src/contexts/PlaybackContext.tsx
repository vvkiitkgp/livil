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
  /** Video tracks only — user-uploaded thumbnail. Null for audio or legacy video. */
  thumbnailUrl: string | null;
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
  // currently-playing item is itself a repost. The original* counters below
  // are hydrated by FullScreenPlayer on mount so the player surface always
  // shows the canonical track's engagement (not the repost's).
  kind: 'upload' | 'repost';
  originalPostId: string | null;
  originalLikesCount?: number;
  originalCommentsCount?: number;
  originalRepostsCount?: number;
  originalViewerHasLiked?: boolean;
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
  /** Resume playback without setting playSourceRef (avoids queue resets on screens). */
  resumePlay: (postId: string) => void;
  reportPaused: (postId: string) => void;
  pauseAll: () => void;
  isActive: (postId: string) => boolean;

  // --- now playing ---
  nowPlaying: NowPlayingInfo | null;
  setNowPlaying: (info: NowPlayingInfo) => void;
  clearNowPlaying: () => void;
  /**
   * Apply a delta to the now-playing post's commentsCount. When
   * `isOriginal` is true (for reposts whose player surface routes to the
   * original post), the delta updates `originalCommentsCount` instead.
   */
  bumpCommentsCount: (delta: number, isOriginal: boolean) => void;

  // --- position / duration (refs — no re-renders) ---
  positionRef: React.MutableRefObject<number>;
  durationRef: React.MutableRefObject<number>;
  updatePosition: (seconds: number) => void;
  updateDuration: (seconds: number) => void;
  /**
   * Pre-commit position to a seek target and arm a guard so stale onProgress
   * samples don't clobber positionRef during the native seek transition.
   * Call this before dispatching `seek()` through a handler.
   */
  markSeekTarget: (seconds: number) => void;
  /** Increments on every markSeekTarget — lets a paused slave surface re-seek. */
  seekNonce: number;
  /** Bumped when the clip window is edited in-place (handle drag) so the
   *  lock-screen clip-relative timeline refreshes for the current track. */
  clipVersion: number;
  /** Call after mutating clipWindowRef on a drag-commit to push the new window. */
  bumpClipVersion: () => void;
  // --- clip window (ref — no re-renders; mutated by FullScreenPlayer on drag) ---
  clipWindowRef: React.MutableRefObject<{ start: number; end: number } | null>;

  // --- player handlers (ref — no re-renders) ---
  handlersRef: React.MutableRefObject<PlayerHandlers | null>;
  registerHandlers: (handlers: PlayerHandlers) => void;
  unregisterHandlers: () => void;

  // --- buffering state (re-rendering — for UI spinners) ---
  isBuffering: boolean;
  setIsBuffering: (v: boolean) => void;
  isReadyForDisplay: boolean;
  setIsReadyForDisplay: (v: boolean) => void;
  /**
   * True while FullScreenPlayer's MUTED video frame is buffering / not yet
   * ready. GlobalAudioPlayer reads this to pause the audio in lock-step with the
   * picture, so a stalling video never plays on while the frame is frozen (the
   * audio waits for the video, and a paused audio stream stops pulling data —
   * freeing bandwidth for the video to buffer, since both decode the SAME file).
   * Only meaningful while the frame is mounted (video post + FS open +
   * foreground); cleared otherwise so audio posts / minimized video play freely.
   */
  videoFrameBuffering: boolean;
  setVideoFrameBuffering: (v: boolean) => void;

  // --- engine driving flag (true when PlaybackEngine owns audio output) ---
  engineDriving: boolean;
  setEngineDriving: (v: boolean) => void;

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
  /** Bumped on every queue mutation so QueueList can re-render. */
  queueVersion: number;

  // --- full-screen player ---
  isFullScreenOpen: boolean;
  openFullScreenPlayer: () => void;
  closeFullScreenPlayer: () => void;
  /**
   * Clean / immersive view — the FS video with EVERY control + the floating
   * player hidden so the user can pinch-zoom / pan the picture. Tap the video to
   * toggle. Only meaningful for a video post while FS is open; it is force-reset
   * to false on FS close and on every track change (so advancing to an audio
   * track can never strand the user in a controls-hidden view).
   */
  isImmersive: boolean;
  setImmersive: (v: boolean) => void;
  toggleImmersive: () => void;

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
  const [isImmersive, setIsImmersiveState] = useState(false);
  const [isStoryViewerOpen, setIsStoryViewerOpenState] = useState(false);
  const [isRepostOpen, setIsRepostOpenState] = useState(false);
  const [jamLocked, setJamLockedState] = useState(false);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');
  const [isBuffering, setIsBufferingState] = useState(false);
  const [isReadyForDisplay, setIsReadyForDisplayState] = useState(false);
  const [videoFrameBuffering, setVideoFrameBufferingState] = useState(false);
  const [engineDriving, setEngineDrivingState] = useState(false);
  const [queueVersion, setQueueVersion] = useState(0);
  const bumpQueue = useCallback(() => setQueueVersion(v => v + 1), []);
  // Bumped on every markSeekTarget so a slave surface (FullScreenPlayer's muted
  // video frame) can seek itself to the new position even while paused — its
  // onProgress doesn't fire when paused, so it can't drift-correct on its own.
  const [seekNonce, setSeekNonce] = useState(0);
  // Bumped when the user drags the clip handles on the SAME track, so
  // GlobalAudioPlayer recomputes currentClipJson and pushes the new window to the
  // lock screen. (Track changes are already covered by nowPlaying.postId, and
  // repeat-mode toggles by repeatMode — clipVersion is only for in-place edits.)
  const [clipVersion, setClipVersion] = useState(0);
  const bumpClipVersion = useCallback(() => setClipVersion(v => v + 1), []);

  const positionRef = useRef<number>(0);
  const durationRef = useRef<number>(0);
  const clipWindowRef = useRef<{ start: number; end: number } | null>(null);
  const handlersRef = useRef<PlayerHandlers | null>(null);
  // Seek guard — after a seek, the native player keeps reporting the *old*
  // currentTime for several hundred ms via onProgress. Those stale updates
  // would clobber positionRef and the seek bar would rubber-band back to the
  // pre-seek position before finally snapping forward. While this guard is
  // active, updatePosition discards samples that are far from `target`. Once
  // a sample lands close to the target the guard auto-clears.
  const seekGuardRef = useRef<{ target: number; until: number } | null>(null);
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
    console.log(`[LIVIL][CTX] requestPlay postId=${postId}`);
    playSourceRef.current = 'user';
    activeRef.current = postId;
    setActivePostId(postId);
  }, []);

  /** Resume playback of the current track without triggering queue resets on screens. */
  const resumePlay = useCallback((postId: string) => {
    console.log(`[LIVIL][CTX] resumePlay postId=${postId}`);
    activeRef.current = postId;
    setActivePostId(postId);
  }, []);

  const reportPaused = useCallback((postId: string) => {
    if (activeRef.current === postId) {
      console.log(`[LIVIL][CTX] reportPaused postId=${postId}`);
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
    setNowPlayingState(prev => {
      const isNewPost = prev?.postId !== info.postId;
      if (isNewPost) {
        const clipStart = (info.clipStartSec !== null && info.clipEndSec !== null)
          ? info.clipStartSec : 0;
        console.log(`[LIVIL][CTX] setNowPlaying NEW postId=${info.postId} title="${info.title}" kind=${info.mediaKind} startAt=${clipStart}s clip=[${info.clipStartSec},${info.clipEndSec}] knownDur=${info.knownDurationSec ?? 0}`);
        positionRef.current = clipStart;
        durationRef.current = info.knownDurationSec ?? 0;
        clipWindowRef.current = (info.clipStartSec !== null && info.clipEndSec !== null)
          ? { start: info.clipStartSec, end: info.clipEndSec }
          : null;
      } else {
        console.log(`[LIVIL][CTX] setNowPlaying SAME postId=${info.postId} (metric/state-only, refs preserved pos=${positionRef.current.toFixed(2)} dur=${durationRef.current.toFixed(2)})`);
      }
      return info;
    });
  }, []);

  const clearNowPlaying = useCallback(() => {
    positionRef.current = 0;
    durationRef.current = 0;
    clipWindowRef.current = null;
    setNowPlayingState(null);
  }, []);

  const bumpCommentsCount = useCallback((delta: number, isOriginal: boolean) => {
    setNowPlayingState(prev => {
      if (!prev) { return prev; }
      if (isOriginal) {
        const base = prev.originalCommentsCount ?? 0;
        return { ...prev, originalCommentsCount: Math.max(base + delta, 0) };
      }
      return { ...prev, commentsCount: Math.max(prev.commentsCount + delta, 0) };
    });
  }, []);

  // --- position / duration ---

  const updatePosition = useCallback((seconds: number) => {
    const guard = seekGuardRef.current;
    if (guard) {
      if (Date.now() < guard.until) {
        if (Math.abs(seconds - guard.target) > 1.5) {
          // Stale sample from before the seek committed — ignore it.
          console.log(`[LIVIL][CTX] seekGuard suppress p=${seconds.toFixed(2)} target=${guard.target.toFixed(2)}`);
          return;
        }
        // Sample landed near the target — seek has taken effect, release guard.
        console.log(`[LIVIL][CTX] seekGuard release p=${seconds.toFixed(2)} target=${guard.target.toFixed(2)}`);
        seekGuardRef.current = null;
      } else {
        // Guard expired (native never came back close enough). Drop it.
        seekGuardRef.current = null;
      }
    }
    positionRef.current = seconds;
  }, []);

  /**
   * Pre-commit the position to a seek target and arm the guard. Call this
   * *before* dispatching `seek()` through a handler so the bar polls the new
   * value immediately and stale onProgress events get filtered out.
   */
  const markSeekTarget = useCallback((seconds: number) => {
    positionRef.current = seconds;
    seekGuardRef.current = { target: seconds, until: Date.now() + 1200 };
    setSeekNonce(n => n + 1);
    console.log(`[LIVIL][CTX] markSeekTarget=${seconds.toFixed(2)}`);
  }, []);

  const updateDuration = useCallback((seconds: number) => {
    durationRef.current = seconds;
  }, []);

  // --- handlers ---

  const registerHandlers = useCallback((handlers: PlayerHandlers) => {
    console.log('[LIVIL][CTX] registerHandlers called');
    handlersRef.current = handlers;
  }, []);

  const unregisterHandlers = useCallback(() => {
    console.log('[LIVIL][CTX] unregisterHandlers called');
    handlersRef.current = null;
  }, []);

  // --- buffering / engine ---

  const setIsBuffering = useCallback((v: boolean) => {
    setIsBufferingState(v);
  }, []);

  const setIsReadyForDisplay = useCallback((v: boolean) => {
    setIsReadyForDisplayState(v);
  }, []);

  const setVideoFrameBuffering = useCallback((v: boolean) => {
    setVideoFrameBufferingState(v);
  }, []);

  const setEngineDriving = useCallback((v: boolean) => {
    setEngineDrivingState(v);
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
    // Honour clipStartSec on queue-driven plays — reposts with a mid-track
    // clip window must start audibly at the clip, and the seek thumb is
    // clamped at clipStart so anything less makes the bar look frozen.
    const startPos = (track.clipStartSec !== null && track.clipEndSec !== null)
      ? track.clipStartSec : 0;
    positionRef.current = startPos;
    durationRef.current = track.knownDurationSec ?? 0;
    clipWindowRef.current = (track.clipStartSec !== null && track.clipEndSec !== null)
      ? { start: track.clipStartSec, end: track.clipEndSec }
      : null;
    // Arm the seek guard so a stale onProgress from the OUTGOING player (e.g. the
    // video we're advancing away from fires one last sample at ~clipEnd) can't
    // clobber positionRef back off the new track's start before the new player
    // loads. Without this the next track audibly starts mid-song.
    seekGuardRef.current = { target: startPos, until: Date.now() + 1200 };
    console.log(`[LIVIL][CTX] playTrackAtIndex idx=${idx} postId=${track.postId} clip=[${track.clipStartSec},${track.clipEndSec}] posRef=${startPos} dur=${track.knownDurationSec ?? 0}`);
    setNowPlayingState(track);
    setPendingPlayId(track.postId);
  }, []);

  const setQueue = useCallback((posts: NowPlayingInfo[], startIndex: number, source: string) => {
    // Orphaned reposts (original upload deleted → originalPostId null) keep a
    // valid track_id, so they'd play fine from the queue even though their feed
    // card is a non-playable tombstone. Strip them here — the single chokepoint
    // every surface (Home / Profile / UserProfile) routes through — so next/prev
    // can never land on a deleted post. The start post is never an orphan (you
    // can't initiate playback from a tombstone), so we re-find its index in the
    // filtered list to keep currentIndex aligned.
    const activeId = posts[startIndex]?.postId;
    const filtered = posts.filter(t => !(t.kind === 'repost' && t.originalPostId === null));
    const newIndex = activeId != null
      ? Math.max(0, filtered.findIndex(t => t.postId === activeId))
      : Math.min(startIndex, Math.max(0, filtered.length - 1));
    console.log(`[LIVIL][CTX] setQueue len=${filtered.length} (raw ${posts.length}) startIdx=${newIndex} source="${source}"`);
    queueRef.current = filtered;
    currentIndexRef.current = newIndex;
    userQueueRef.current = [];
    queueSourceRef.current = source;
    if (shuffleRef.current) {
      generateShuffleOrder(newIndex, filtered.length);
    }
    bumpQueue();
  }, [generateShuffleOrder, bumpQueue]);

  const playNext = useCallback(() => {
    if (userQueueRef.current.length > 0) {
      const track = userQueueRef.current.shift()!;
      activeRef.current = track.postId;
      setActivePostId(track.postId);
      const startPos = (track.clipStartSec !== null && track.clipEndSec !== null)
        ? track.clipStartSec : 0;
      positionRef.current = startPos;
      durationRef.current = track.knownDurationSec ?? 0;
      clipWindowRef.current = (track.clipStartSec !== null && track.clipEndSec !== null)
        ? { start: track.clipStartSec, end: track.clipEndSec }
        : null;
      seekGuardRef.current = { target: startPos, until: Date.now() + 1200 };
      console.log(`[LIVIL][CTX] playNext (userQueue) postId=${track.postId} clip=[${track.clipStartSec},${track.clipEndSec}] posRef=${startPos}`);
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
    // "Restart current track" semantics — for clipped reposts the start is the
    // clip-start, not 0. clipWindowRef tracks the active clip (or null if
    // there's no clip).
    const trackStart = clipWindowRef.current?.start ?? 0;

    if (positionRef.current > trackStart + 3) {
      handlersRef.current?.seek(trackStart);
      positionRef.current = trackStart;
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
      handlersRef.current?.seek(trackStart);
      positionRef.current = trackStart;
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
    bumpQueue();
  }, [bumpQueue]);

  const playTrackNextFn = useCallback((track: NowPlayingInfo) => {
    userQueueRef.current = [track, ...userQueueRef.current];
    bumpQueue();
  }, [bumpQueue]);

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
    bumpQueue();
  }, [bumpQueue]);

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
    bumpQueue();
  }, [bumpQueue]);

  const clearPendingPlay = useCallback(() => {
    setPendingPlayId(null);
  }, []);

  const openFullScreenPlayer = useCallback(() => {
    setIsFullScreenOpen(true);
  }, []);

  const closeFullScreenPlayer = useCallback(() => {
    setIsFullScreenOpen(false);
    // Leaving full-screen always exits clean view — reopening starts with
    // controls visible. Both setters are stable, so deps stay [].
    setIsImmersiveState(false);
  }, []);

  const setImmersive = useCallback((v: boolean) => {
    setIsImmersiveState(v);
  }, []);

  const toggleImmersive = useCallback(() => {
    setIsImmersiveState(v => !v);
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
      resumePlay,
      reportPaused,
      pauseAll,
      isActive,
      nowPlaying,
      setNowPlaying,
      clearNowPlaying,
      bumpCommentsCount,
      positionRef,
      durationRef,
      updatePosition,
      updateDuration,
      markSeekTarget,
      seekNonce,
      clipVersion,
      bumpClipVersion,
      clipWindowRef,
      handlersRef,
      registerHandlers,
      unregisterHandlers,
      isBuffering,
      setIsBuffering,
      isReadyForDisplay,
      setIsReadyForDisplay,
      videoFrameBuffering,
      setVideoFrameBuffering,
      engineDriving,
      setEngineDriving,
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
      queueVersion,
      isFullScreenOpen,
      openFullScreenPlayer,
      closeFullScreenPlayer,
      isImmersive,
      setImmersive,
      toggleImmersive,
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
      resumePlay,
      reportPaused,
      pauseAll,
      isActive,
      nowPlaying,
      setNowPlaying,
      clearNowPlaying,
      bumpCommentsCount,
      updatePosition,
      updateDuration,
      markSeekTarget,
      seekNonce,
      clipVersion,
      bumpClipVersion,
      registerHandlers,
      unregisterHandlers,
      isBuffering,
      setIsBuffering,
      isReadyForDisplay,
      setIsReadyForDisplay,
      videoFrameBuffering,
      setVideoFrameBuffering,
      engineDriving,
      setEngineDriving,
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
      queueVersion,
      isFullScreenOpen,
      openFullScreenPlayer,
      closeFullScreenPlayer,
      isImmersive,
      setImmersive,
      toggleImmersive,
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
