import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Video, { type VideoRef, type OnLoadData, type OnProgressData } from 'react-native-video';
import { usePlayback } from '../contexts/PlaybackContext';
import { trackPlayProgress } from '../utils/playTracker';
import { buildNowPlayingMetadata, buildMediaQueueJson } from '../utils/nowPlayingMetadata';

const AUDIO_BUFFER_CONFIG = {
  minBufferMs: 15_000,
  maxBufferMs: 50_000,
  bufferForPlaybackMs: 2_500,
  bufferForPlaybackAfterRebufferMs: 5_000,
  backBufferDurationMs: 10_000,
  cacheSizeMB: 200,
};

/**
 * The single, always-on audio engine. Whenever `nowPlaying` is an audio track
 * (mediaKind === 'audio' with an audioUrl) this hidden <Video> is the sole
 * source of audio — for feed taps, queue advances, playlists and jams alike.
 *
 * PostCard NO LONGER plays audio inline; it just shows cover art + a play
 * button that sets nowPlaying (with audioUrl) and requests play. That keeps
 * playback completely decoupled from which card is on screen — so audio
 * survives scrolling, off-screen play/pause, and video→audio queue advances.
 *
 * Responsibilities mirrored from the old PostCard MediaPlayer:
 *   - register play/pause/seek handlers so FloatingPlayer + FullScreenPlayer work
 *   - drive the play tracker (trackPlayProgress) for play counts
 *   - enforce clip-end for clipped reposts (repeat-one loops, else playNext)
 *   - advance the queue on natural end
 *   - surface buffering state for the spinner overlays
 */
export default function GlobalAudioPlayer() {
  const {
    nowPlaying,
    activePostId,
    setNowPlaying,
    updatePosition,
    updateDuration,
    registerHandlers,
    positionRef,
    queueRef,
    currentIndexRef,
    playNext,
    playPrev,
    engineDriving,
    reportPaused,
    resumePlay,
    clipWindowRef,
    repeatMode,
    setIsBuffering,
    queueVersion,
  } = usePlayback();

  const videoRef = useRef<VideoRef>(null);
  const [paused, setPaused] = useState(true);
  // Mirror of `paused` readable synchronously inside native-event callbacks
  // (no stale closure) so we can tell an in-app pause from a lock-screen pause.
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  // True while the player is buffering/loading. onPlaybackStateChanged reports
  // isPlaying=false during buffering — which must NOT be mistaken for a
  // lock-screen pause, or switching tracks self-pauses the new track.
  const bufferingRef = useRef(false);
  // Timestamp until which a new track is considered "loading"; the pause-sync is
  // suppressed in this window (covers the gap before onBuffer even fires).
  const loadGuardUntilRef = useRef(0);

  // Which postId this component is currently responsible for
  const myPostIdRef = useRef<string | null>(null);
  // One-shot guard so clip-end fires once per play session (onProgress fires
  // several times in the final ~250ms of a clip).
  const clipEndFiredRef = useRef(false);
  // Read repeatMode through a ref so the progress callback stays stable.
  const repeatModeRef = useRef(repeatMode);
  repeatModeRef.current = repeatMode;

  // Activate/deactivate based on whether nowPlaying carries an audioUrl
  useEffect(() => {
    const url = nowPlaying?.audioUrl;
    if (url && nowPlaying?.mediaKind === 'audio') {
      console.log(`[LIVIL][GAP] activating for postId=${nowPlaying.postId} pos=${positionRef.current.toFixed(1)}`);
      myPostIdRef.current = nowPlaying.postId;
      clipEndFiredRef.current = false;
      setIsBuffering(true);
      bufferingRef.current = true;
      // Suppress the pause-sync while the new track loads (it reports
      // isPlaying=false until the first frame is decodable).
      loadGuardUntilRef.current = Date.now() + 4000;
      setPaused(false);
      registerHandlers({
        play:    () => {
          console.log('[LIVIL][GAP] handler PLAY');
          clipEndFiredRef.current = false;
          setPaused(false);
          resumePlay(nowPlaying.postId);
        },
        pause:   () => { console.log('[LIVIL][GAP] handler PAUSE'); setPaused(true); reportPaused(nowPlaying.postId); },
        seek:    (s: number) => {
          console.log(`[LIVIL][GAP] handler SEEK to=${s.toFixed(1)}s`);
          positionRef.current = s;
          clipEndFiredRef.current = false;
          videoRef.current?.seek(s);
        },
        setRate: () => {},
      });
    } else {
      // No audio URL (video track, or nothing playing) — go silent.
      console.log('[LIVIL][GAP] deactivating (no audio track)');
      myPostIdRef.current = null;
      setPaused(true);
      setIsBuffering(false);
      // Do NOT call unregisterHandlers — whoever takes over (FS for video) will
      // registerHandlers, overwriting ours. Nulling handlersRef here would race.
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowPlaying?.postId, nowPlaying?.audioUrl]);

  // React to activePostId changes while we're the active player:
  //   - null  → paused externally (FloatingPlayer pause / pauseAll) → stop audio
  //   - mine  → resumed (play handler already set paused=false) → nothing to do
  //   - other → queue advanced (FloatingPlayer flick / track-end) → load new track
  const prevActivePostId = useRef<string | null>(null);
  useEffect(() => {
    const mine = myPostIdRef.current;
    if (!mine) { return; }
    if (activePostId === prevActivePostId.current) { return; }
    prevActivePostId.current = activePostId;

    if (!activePostId) {
      console.log('[LIVIL][GAP] activePostId=null → pausing');
      setPaused(true);
      return;
    }
    if (activePostId === mine) { return; }

    const next = queueRef.current[currentIndexRef.current];
    if (next?.audioUrl) {
      console.log(`[LIVIL][GAP] activePostId→${activePostId}, loading queue track`);
      setNowPlaying(next);
    } else {
      // Next track is a video (or has no audio) — release; FS takes over.
      myPostIdRef.current = null;
      setPaused(true);
    }
  }, [activePostId, queueRef, currentIndexRef, setNowPlaying]);

  const handleLoad = useCallback((data: OnLoadData) => {
    console.log(`[LIVIL][GAP] onLoad duration=${(data.duration ?? 0).toFixed(1)}s seekTo=${positionRef.current.toFixed(1)}s`);
    updateDuration(data.duration ?? 0);
    setIsBuffering(false);
    const pos = positionRef.current;
    if (pos > 0) { videoRef.current?.seek(pos); }
  }, [updateDuration, positionRef, setIsBuffering]);

  const handleProgress = useCallback((data: OnProgressData) => {
    const t = data.currentTime ?? 0;
    updatePosition(t);
    const mine = myPostIdRef.current;
    if (mine) { trackPlayProgress(mine, t); }

    // Clip-end enforcement for clipped reposts (react-native-video doesn't know
    // about the clip window, so we enforce the upper bound here).
    const cw = clipWindowRef.current;
    if (cw && t >= cw.end && !clipEndFiredRef.current) {
      clipEndFiredRef.current = true;
      if (repeatModeRef.current === 'one') {
        console.log(`[LIVIL][GAP] clip-end repeat-one → loop to ${cw.start.toFixed(1)}s`);
        positionRef.current = cw.start;
        videoRef.current?.seek(cw.start);
        setTimeout(() => { clipEndFiredRef.current = false; }, 300);
      } else {
        console.log('[LIVIL][GAP] clip-end → playNext');
        playNext();
      }
    }
  }, [updatePosition, positionRef, clipWindowRef, playNext]);

  const handleBuffer = useCallback((e: { isBuffering: boolean }) => {
    bufferingRef.current = e.isBuffering;
    setIsBuffering(e.isBuffering);
  }, [setIsBuffering]);

  // Keep the in-app UI (FloatingPlayer) in sync when the user pauses/plays from
  // the LOCK SCREEN / notification / headset. RNV's `paused` is a controlled
  // prop, so a notification pause stops audio but leaves our state thinking it's
  // playing — we reconcile here. We only act on a genuine discrepancy (native
  // state != our intended state), so our own pause/resume don't loop.
  const handlePlaybackStateChanged = useCallback(
    (e: { isPlaying: boolean; isSeeking: boolean }) => {
      if (e.isSeeking) { return; }
      const mine = myPostIdRef.current;
      if (!mine) { return; }
      if (e.isPlaying && pausedRef.current) {
        console.log('[LIVIL][GAP] lock-screen PLAY → sync');
        setPaused(false);
        resumePlay(mine);
      } else if (!e.isPlaying && !pausedRef.current) {
        // A not-playing report during buffering or a fresh track load is NOT a
        // user pause — ignore it, or switching tracks would self-pause.
        if (bufferingRef.current || Date.now() < loadGuardUntilRef.current) {
          return;
        }
        console.log('[LIVIL][GAP] lock-screen PAUSE → sync');
        setPaused(true);
        reportPaused(mine);
      }
    },
    [resumePlay, reportPaused],
  );

  const handleEnd = useCallback(() => {
    console.log('[LIVIL][GAP] onEnd → playNext');
    playNext();
  }, [playNext]);

  // Lock-screen / notification / headset next & previous-track presses.
  const handleNextTrack = useCallback(() => {
    console.log('[LIVIL][GAP] onNextTrack → playNext');
    playNext();
  }, [playNext]);

  const handlePrevTrack = useCallback(() => {
    console.log('[LIVIL][GAP] onPreviousTrack → playPrev');
    playPrev();
  }, [playPrev]);

  // Serialise the queue for the native playback service so notification next/prev
  // can switch tracks while the app is backgrounded. Rebuilt whenever the active
  // track changes (which is also when the queue index moves).
  const mediaQueueJson = useMemo(
    () => buildMediaQueueJson(queueRef.current, currentIndexRef.current),
    // Recompute on track change (postId) AND queue change (queueVersion) — the
    // queue is often set just AFTER the first track starts, so postId alone is
    // not enough; without queueVersion the native side gets an empty queue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nowPlaying?.postId, queueVersion],
  );

  // Don't render when PlaybackEngine is handling playback, or no audio URL.
  if (engineDriving || !nowPlaying?.audioUrl || nowPlaying.mediaKind !== 'audio') {
    return null;
  }

  return (
    <Video
      ref={videoRef}
      source={{ uri: nowPlaying.audioUrl, metadata: buildNowPlayingMetadata(nowPlaying) }}
      paused={paused}
      onLoad={handleLoad}
      onProgress={handleProgress}
      onBuffer={handleBuffer}
      onEnd={handleEnd}
      onPlaybackStateChanged={handlePlaybackStateChanged}
      onNextTrack={handleNextTrack}
      onPreviousTrack={handlePrevTrack}
      mediaQueueJson={mediaQueueJson}
      progressUpdateInterval={250}
      playInBackground
      playWhenInactive
      ignoreSilentSwitch="ignore"
      // Lock-screen / notification / Control Center media controls. GlobalAudioPlayer
      // only mounts this <Video> for audio tracks and FullScreenPlayer only mounts its
      // <Video> for video tracks, so exactly one MediaSession exists at a time.
      showNotificationControls
      muted={false}
      volume={1.0}
      {...(Platform.OS === 'android'
        ? { bufferConfig: AUDIO_BUFFER_CONFIG }
        : { preferredForwardBufferDuration: 20 })}
      style={{ width: 0, height: 0, position: 'absolute' }}
    />
  );
}
