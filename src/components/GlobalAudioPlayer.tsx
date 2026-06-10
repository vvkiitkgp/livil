import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Video, { type VideoRef, type OnLoadData, type OnProgressData } from 'react-native-video';
import { usePlayback } from '../contexts/PlaybackContext';
import { useToast } from '../contexts/ToastContext';
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
 * The single, always-on audio engine for EVERY post — audio and video alike.
 * Whenever `nowPlaying` has a playable URL (audioUrl ?? videoUrl) this hidden
 * <Video> is the sole source of audio AND the sole owner of the lock-screen
 * MediaSession (notification / Control Center / Dynamic Island). For a video
 * post we decode its `videoUrl` here for the audio only — the frames are never
 * composited on this 0x0 surface; FullScreenPlayer renders a separate, MUTED
 * <Video> for the picture and seeks it to follow this engine's position.
 *
 * Because one engine plays every track's audio, audio↔video queue advances no
 * longer churn the MediaSession (no carousel, no lost next/prev events) and the
 * native background-skip queue stays valid across both media kinds.
 *
 * PostCard NO LONGER plays audio inline; it just shows cover art + a play
 * button that sets nowPlaying and requests play. That keeps playback completely
 * decoupled from which card is on screen — so audio survives scrolling,
 * off-screen play/pause, and video→audio queue advances.
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
  const { showToast } = useToast();

  const videoRef = useRef<VideoRef>(null);
  const [paused, setPaused] = useState(true);
  // Playback rate (FloatingPlayer drag-right "2x"). GAP is now the sole audio
  // engine for audio AND video posts, so it owns rate too (was a no-op before,
  // when FullScreenPlayer owned video playback).
  const [rate, setPlaybackRate] = useState(1.0);
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

  // Activate for ANY playable track — GAP is the single audio engine for both
  // audio posts and the audio track of video posts (source = audioUrl ?? videoUrl).
  useEffect(() => {
    const url = nowPlaying?.audioUrl ?? nowPlaying?.videoUrl;
    if (url) {
      console.log(`[LIVIL][GAP] activating for postId=${nowPlaying!.postId} kind=${nowPlaying!.mediaKind} pos=${positionRef.current.toFixed(1)}`);
      myPostIdRef.current = nowPlaying!.postId;
      clipEndFiredRef.current = false;
      setIsBuffering(true);
      bufferingRef.current = true;
      // Suppress the pause-sync while the new track loads (it reports
      // isPlaying=false until the first frame is decodable).
      loadGuardUntilRef.current = Date.now() + 4000;
      setPaused(false);
      setPlaybackRate(1.0); // a held 2x must not bleed into the next track
      registerHandlers({
        play:    () => {
          console.log('[LIVIL][GAP] handler PLAY');
          clipEndFiredRef.current = false;
          setPaused(false);
          resumePlay(nowPlaying!.postId);
        },
        pause:   () => { console.log('[LIVIL][GAP] handler PAUSE'); setPaused(true); reportPaused(nowPlaying!.postId); },
        seek:    (s: number) => {
          console.log(`[LIVIL][GAP] handler SEEK to=${s.toFixed(1)}s`);
          positionRef.current = s;
          clipEndFiredRef.current = false;
          videoRef.current?.seek(s);
        },
        setRate: (r: number) => { console.log(`[LIVIL][GAP] setRate=${r}`); setPlaybackRate(r); },
      });
    } else {
      // Nothing playing — go silent.
      console.log('[LIVIL][GAP] deactivating (nothing playing)');
      myPostIdRef.current = null;
      setPaused(true);
      setIsBuffering(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowPlaying?.postId, nowPlaying?.audioUrl, nowPlaying?.videoUrl]);

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
    if (next?.audioUrl ?? next?.videoUrl) {
      console.log(`[LIVIL][GAP] activePostId→${activePostId}, loading queue track kind=${next.mediaKind}`);
      setNowPlaying(next);
    }
    // No else: GAP is the sole engine now, so it never releases to anyone. A
    // queue item with neither url is a data error — leave the current paused.
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
    // repeat-one: loop the current track at its natural end instead of advancing.
    // (Clipped tracks already loop via the clip-end branch in handleProgress; this
    // covers UNclipped tracks reaching real end-of-stream — for audio AND video,
    // now that GAP owns every post's onEnd.)
    if (repeatModeRef.current === 'one') {
      const start = clipWindowRef.current?.start ?? 0;
      console.log(`[LIVIL][GAP] onEnd repeat-one → loop to ${start.toFixed(1)}s`);
      positionRef.current = start;
      clipEndFiredRef.current = false;
      videoRef.current?.seek(start);
      return;
    }
    console.log('[LIVIL][GAP] onEnd → playNext');
    playNext();
  }, [playNext, positionRef, clipWindowRef]);

  // GAP is the single engine, so a decode/URL failure here means the audio for
  // this post (audio OR video) won't play. Surface it and skip to the next
  // track so the queue doesn't dead-end on one broken file.
  const handleError = useCallback((e: { error?: unknown }) => {
    console.warn('[LIVIL][GAP] onError → skip', e?.error ?? e);
    showToast('Could not play this track', { kind: 'error' });
    setIsBuffering(false);
    playNext();
  }, [showToast, setIsBuffering, playNext]);

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

  // Don't render when the jam PlaybackEngine drives audio, or nothing is playing.
  if (engineDriving || !nowPlaying) {
    return null;
  }
  // The single audio engine: for a video post we play its audio track (videoUrl)
  // through this hidden surface — the frames are never composited here.
  const audioSrc = nowPlaying.audioUrl ?? nowPlaying.videoUrl;
  if (!audioSrc) {
    return null;
  }

  return (
    <Video
      ref={videoRef}
      source={{ uri: audioSrc, metadata: buildNowPlayingMetadata(nowPlaying) }}
      paused={paused}
      rate={rate}
      onLoad={handleLoad}
      onProgress={handleProgress}
      onBuffer={handleBuffer}
      onEnd={handleEnd}
      onError={handleError}
      onPlaybackStateChanged={handlePlaybackStateChanged}
      onNextTrack={handleNextTrack}
      onPreviousTrack={handlePrevTrack}
      mediaQueueJson={mediaQueueJson}
      progressUpdateInterval={250}
      playInBackground
      playWhenInactive
      ignoreSilentSwitch="ignore"
      // The ONE MediaSession for every post (audio + video). FullScreenPlayer's
      // <Video> is muted with no notification controls, so it never creates a
      // second session.
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
