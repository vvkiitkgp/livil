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
  /**
   * Album this track belongs to, when known. AlbumDetailScreen pre-fills this
   * when building the queue (instant correctness); for other queues
   * GlobalAudioPlayer lazily fetches it via `fetchAlbumForTrack` whenever the
   * trackId changes and patches it back here. Surfaced in the lock-screen /
   * Bluetooth / car MediaSession metadata (with a "Single" fallback when null
   * — the fallback never leaks into in-app UI; see `buildNowPlayingMetadata`).
   *
   * Tri-state semantics:
   *   undefined — not yet looked up (treat as null in UI; metadata falls back to "Single")
   *   null      — looked up, track is not in any album
   *   string    — the album's display title
   */
  albumTitle?: string | null;
};

export type PlayerHandlers = {
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
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
  /**
   * Set while a scrubber owns the position — for the length of a swipe.
   *
   * A scrub does not seek the engine until the finger lifts, so playback keeps
   * running where it was and its progress events would overwrite whatever the
   * finger has written into `positionRef` four times a second. `updatePosition`
   * yields while this is set, which lets the scrubbing surface publish the swipe
   * target to every OTHER position consumer — the floating player's progress ring
   * above all — without seeking anything.
   *
   * A plain ref, deliberately: this is written at gesture rate, and the cheap
   * seam is the whole point. Routing it through state (or through markSeekTarget,
   * which bumps seekNonce) re-renders every playback consumer per touch event and
   * the scrub visibly stutters. That was measured, not assumed.
   */
  scrubbingRef: React.MutableRefObject<boolean>;
  /**
   * Where the NEXT activation must start, committed by whoever changed the track.
   *
   * Separate from `positionRef` because that one has two writers: the code choosing a track,
   * and `updatePosition` reporting progress from the engine. Between committing a queue
   * advance and GlobalAudioPlayer reading it, the OUTGOING track keeps emitting progress —
   * so the intended start gets overwritten by the old playhead, and the new track begins
   * wherever the last one happened to be. `seekGuardRef` was meant to hold that off and
   * demonstrably does not (no guard ever logged across a whole session of flicks).
   *
   * This ref has exactly one writer and one reader, and the reader clears it. Progress
   * samples cannot touch it, so a start position cannot be raced. Null means "no explicit
   * start" — resume wherever `positionRef` says, which is what a jam listener syncing to a
   * host's position relies on.
   */
  pendingStartRef: React.MutableRefObject<number | null>;
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
  /**
   * `tab` lands the player on a panel instead of the bare artwork — the credits row on a
   * post card opens 'info'. Cleared once the player has consumed it, so reopening by any
   * other route starts clean.
   */
  openFullScreenPlayer: (tab?: 'queue' | 'info') => void;
  /** Panel the next open should land on, or null. Read and cleared by FullScreenPlayer. */
  pendingTab: 'queue' | 'info' | null;
  clearPendingTab: () => void;
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
  /** The track that was playing when the clip session opened (null if none, or no
   *  session). GAP pins the media notification's METADATA to this for the whole
   *  session, so the OS card keeps showing the user's music — never the story. */
  clipSessionPrevTrack: NowPlayingInfo | null;
  setStoryViewerOpen: (open: boolean) => void;
  /** Enter a declared clip session (stories): snapshots the engine, forces
   *  repeat/shuffle off, disarms the native clip-end watcher, and returns the
   *  pre-session source url. The caller passes the current nowPlaying. See ADR-0013. */
  enterClipSession: (prevNowPlaying: NowPlayingInfo | null) => string | null;
  /** Exit the clip session and restore the user's music (track/position/queue). */
  exitClipSession: () => void;

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
  // Idempotent setters — no-op when the incoming value already matches state,
  // so the controller↔JS feedback loop (car HU toggle → onVideoRepeatModeChange
  // → setRepeatMode → mediaSessionStateJson re-render → controller echo) ends
  // at the first matching value instead of oscillating.
  setRepeatMode: (mode: RepeatMode) => void;
  setShuffleEnabled: (enabled: boolean) => void;
};

/**
 * Full snapshot of the engine's state captured when a clip session (stories)
 * opens, so the user's music — track, position, queue, repeat/shuffle — is
 * restored intact on close. The clip session overwrites ALL of this while it
 * drives short clips through the single engine.
 */
type ClipSnapshot = {
  nowPlaying: NowPlayingInfo | null;
  queue: NowPlayingInfo[];
  currentIndex: number;
  userQueue: NowPlayingInfo[];
  queueSource: string;
  playSource: 'user' | 'queue';
  position: number;
  duration: number;
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
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
  const [clipSessionPrevTrack, setClipSessionPrevTrack] = useState<NowPlayingInfo | null>(null);
  const [isRepostOpen, setIsRepostOpenState] = useState(false);
  const [jamLocked, setJamLockedState] = useState(false);
  const [shuffleEnabled, setShuffleEnabledState] = useState(false);
  const [repeatMode, setRepeatModeState] = useState<RepeatMode>('off');
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
  const scrubbingRef = useRef<boolean>(false);
  /** Single-writer start position for the next activation — see the type above. */
  const pendingStartRef = useRef<number | null>(null);
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
  // Clip session (stories): a declared foreground mode where the JS clock is the
  // sole advance authority and the native clip-end watcher is disarmed (ADR-0013).
  // clipSessionRef is a ref so playNext can read it synchronously; the reactive
  // twin GAP reads to null-out currentClipJson is `isStoryViewerOpen`.
  const clipSessionRef = useRef(false);
  const clipSnapshotRef = useRef<ClipSnapshot | null>(null);

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
        // Committed where progress samples cannot reach it — see pendingStartRef.
        pendingStartRef.current = clipStart;
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
    // A full-screen / immersive player is meaningless with no track, so reset
    // those flags here too — otherwise they go stale. Concretely: a jam ends
    // while the co-host has FS open → nowPlaying clears (FullScreenPlayer then
    // renders nothing) but a stale isFullScreenOpen=true would keep the floating
    // pill stuck EXPANDED instead of collapsing to the thin white bar (and a
    // late jam heartbeat re-setting nowPlaying made the pill reappear expanded).
    setIsFullScreenOpen(false);
    setIsImmersiveState(false);
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
    // A swipe in flight owns positionRef. Checked BEFORE the seek guard so a
    // pending guard is neither consumed nor released by samples nobody is
    // listening to; it expires on its own, and the release re-arms it anyway.
    if (scrubbingRef.current) { return; }
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
    pendingStartRef.current = startPos;
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
    // In a CLIP SESSION (stories) the JS clock is the sole advance authority; the
    // native watcher is disarmed at the source (currentClipJson inactive, ADR-0013)
    // so it shouldn't emit at all, but the naturalEndListener still fires at a true
    // STATE_ENDED (a clip that IS the whole short track), so keep this as a cheap
    // belt-and-suspenders: playNext never acts during a clip session.
    if (clipSessionRef.current) { return; }
    if (userQueueRef.current.length > 0) {
      const track = userQueueRef.current.shift()!;
      activeRef.current = track.postId;
      setActivePostId(track.postId);
      const startPos = (track.clipStartSec !== null && track.clipEndSec !== null)
        ? track.clipStartSec : 0;
      positionRef.current = startPos;
      pendingStartRef.current = startPos;
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

  const [pendingTab, setPendingTab] = useState<'queue' | 'info' | null>(null);

  const openFullScreenPlayer = useCallback((tab?: 'queue' | 'info') => {
    setPendingTab(tab ?? null);
    setIsFullScreenOpen(true);
  }, []);

  const clearPendingTab = useCallback(() => setPendingTab(null), []);

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

  // Idempotent: the controller→JS event path (car HU shuffle toggle → native
  // event → setShuffleEnabled → mediaSessionStateJson prop re-emits the new
  // value → native may echo the change back) ends here. Without this guard
  // the chain would flip-flop forever.
  const setShuffleEnabled = useCallback((enabled: boolean) => {
    if (shuffleRef.current === enabled) { return; }
    shuffleRef.current = enabled;
    if (enabled) {
      generateShuffleOrder(currentIndexRef.current, queueRef.current.length);
    } else {
      shuffleOrderRef.current = [];
      shuffleIndexRef.current = -1;
    }
    setShuffleEnabledState(enabled);
  }, [generateShuffleOrder]);

  const setRepeatMode = useCallback((mode: RepeatMode) => {
    if (repeatModeRef.current === mode) { return; }
    repeatModeRef.current = mode;
    setRepeatModeState(mode);
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffleEnabled(!shuffleRef.current);
  }, [setShuffleEnabled]);

  const cycleRepeatMode = useCallback(() => {
    const prev = repeatModeRef.current;
    const next: RepeatMode = prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off';
    setRepeatMode(next);
  }, [setRepeatMode]);

  // ── Clip session (stories), ADR-0013 ──────────────────────────────────────────
  // Enter/exit a declared, foreground-only clip session over the single engine.
  // This REPLACES the story viewer's former snapshot-and-neutralize dance: one
  // declared mode instead of many implicit ref overrides. In the session the JS
  // clock is the sole advance authority and GAP disarms the native clip-end watcher
  // (currentClipJson inactive off `isStoryViewerOpen`). GAP stays the sole engine
  // and sole audio source, so ADR-0001 is fully intact. `enterClipSession` snapshots
  // the engine (caller passes the current nowPlaying, which is state, not a ref) and
  // returns the pre-session source url; `exitClipSession` restores the user's music.
  const enterClipSession = useCallback((prevNowPlaying: NowPlayingInfo | null): string | null => {
    clipSnapshotRef.current = {
      nowPlaying: prevNowPlaying,
      queue: queueRef.current,
      currentIndex: currentIndexRef.current,
      userQueue: userQueueRef.current,
      queueSource: queueSourceRef.current,
      playSource: playSourceRef.current,
      position: positionRef.current,
      duration: durationRef.current,
      repeatMode: repeatModeRef.current,
      shuffleEnabled: shuffleRef.current,
    };
    handlersRef.current?.pause();
    pauseAll();
    setRepeatMode('off');
    setShuffleEnabled(false);
    clipSessionRef.current = true;
    // Pin the media card's metadata to the user's music for the whole session —
    // the OS notification must keep showing THIS track (paused), never the story.
    setClipSessionPrevTrack(prevNowPlaying);
    setStoryViewerOpen(true);
    return prevNowPlaying
      ? (prevNowPlaying.audioUrl ?? prevNowPlaying.videoUrl ?? null)
      : null;
  }, [pauseAll, setRepeatMode, setShuffleEnabled, setStoryViewerOpen]);

  const exitClipSession = useCallback(() => {
    const snap = clipSnapshotRef.current;
    handlersRef.current?.pause();
    if (snap) {
      // Restore the queue refs the one-item clip queue overwrote (setQueue reassigns
      // these to NEW arrays, so the snapshotted arrays were never mutated in place).
      queueRef.current = snap.queue;
      currentIndexRef.current = snap.currentIndex;
      userQueueRef.current = snap.userQueue;
      queueSourceRef.current = snap.queueSource;
      playSourceRef.current = snap.playSource;
      setRepeatMode(snap.repeatMode);
      setShuffleEnabled(snap.shuffleEnabled);
    }
    if (snap?.nowPlaying) {
      // Restore the previous track. setNowPlaying resets positionRef to the new
      // post's clip start, so re-apply the saved position on the next tick and force
      // the NATIVE engine back to it (raw ref writes aren't enough same-source).
      const { nowPlaying: prev, position, duration } = snap;
      setNowPlaying(prev);
      setTimeout(() => {
        durationRef.current = duration;
        markSeekTarget(position);
        handlersRef.current?.seek(position);
        // Assert the FINAL state explicitly: restored track paused, JS state and
        // the pill icon in sync. Without this, a stray native isPlaying report
        // during the source swap-back could leave native playing while JS (and the
        // play/pause icon) said paused. GAP's stray-PLAY guard is the primary
        // defense; this makes the end-state deterministic regardless.
        handlersRef.current?.pause();
      }, 0);
    } else {
      clearNowPlaying();
    }
    // pauseAll (activePostId → null) runs AFTER setNowPlaying, so the restored track
    // settles PAUSED (GAP gates on activePostId; null never equals the restored id).
    pauseAll();
    clipSessionRef.current = false;
    setStoryViewerOpen(false);
    setClipSessionPrevTrack(null);
    clipSnapshotRef.current = null;
  }, [pauseAll, setRepeatMode, setShuffleEnabled, setNowPlaying, clearNowPlaying, markSeekTarget, setStoryViewerOpen]);

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
      scrubbingRef,
      pendingStartRef,
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
      pendingTab,
      clearPendingTab,
      closeFullScreenPlayer,
      isImmersive,
      setImmersive,
      toggleImmersive,
      isStoryViewerOpen,
      clipSessionPrevTrack,
      setStoryViewerOpen,
      enterClipSession,
      exitClipSession,
      isRepostOpen,
      setRepostOpen,
      jamLocked,
      setJamLocked,
      shuffleEnabled,
      toggleShuffle,
      repeatMode,
      cycleRepeatMode,
      setRepeatMode,
      setShuffleEnabled,
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
      pendingTab,
      clearPendingTab,
      closeFullScreenPlayer,
      isImmersive,
      setImmersive,
      toggleImmersive,
      isStoryViewerOpen,
      clipSessionPrevTrack,
      setStoryViewerOpen,
      enterClipSession,
      exitClipSession,
      isRepostOpen,
      setRepostOpen,
      jamLocked,
      setJamLocked,
      shuffleEnabled,
      toggleShuffle,
      repeatMode,
      cycleRepeatMode,
      setRepeatMode,
      setShuffleEnabled,
    ],
  );

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

export function usePlayback(): PlaybackContextValue {
  const ctx = useContext(PlaybackContext);
  if (!ctx) { throw new Error('usePlayback must be used inside <PlaybackProvider>'); }
  return ctx;
}
