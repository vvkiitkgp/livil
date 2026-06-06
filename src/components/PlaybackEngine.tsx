import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import Video, { type VideoRef, type OnLoadData, type OnProgressData } from 'react-native-video';
import { usePlayback, type NowPlayingInfo } from '../contexts/PlaybackContext';

// Buffer 20s before starting playback. Engine handles audio-only tracks
// (playlist mode) — aggressive buffering ensures gapless track transitions.
const ENGINE_BUFFER_CONFIG = {
  minBufferMs: 15_000,
  maxBufferMs: 50_000,
  bufferForPlaybackMs: 2_500,
  bufferForPlaybackAfterRebufferMs: 5_000,
  backBufferDurationMs: 10_000,
  cacheSizeMB: 200,
};

type SlotState = 'idle' | 'loading' | 'ready' | 'playing';

function getTrackUrl(info: NowPlayingInfo): string | null {
  if (info.mediaKind === 'video') { return info.videoUrl ?? null; }
  return info.audioUrl ?? null;
}

export default function PlaybackEngine() {
  const {
    nowPlaying,
    setIsBuffering,
    setIsReadyForDisplay,
    engineDriving,
    setEngineDriving,
    updatePosition,
    updateDuration,
    registerHandlers,
    positionRef,
    activePostId,
    setNowPlaying,
    queueRef,
    currentIndexRef,
    playNext,
    clipWindowRef,
  } = usePlayback();

  const refA = useRef<VideoRef>(null);
  const refB = useRef<VideoRef>(null);

  // Which slot (0=A, 1=B) is active (playing) vs standby (preloading)
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
  const [slotASource, setSlotASource] = useState<string | null>(null);
  const [slotBSource, setSlotBSource] = useState<string | null>(null);
  const [slotAPaused, setSlotAPaused] = useState(true);
  const [slotBPaused, setSlotBPaused] = useState(true);

  const slotAState = useRef<SlotState>('idle');
  const slotBState = useRef<SlotState>('idle');
  // Track which URL each slot has loaded/is loading
  const slotAUrl = useRef<string | null>(null);
  const slotBUrl = useRef<string | null>(null);

  const activeSlotRef = useRef<0 | 1>(0);
  const nowPlayingRef = useRef<NowPlayingInfo | null>(null);
  // Whether this engine should be driving playback (FS open or playlist/global audio)
  const shouldDriveRef = useRef(false);
  const preloadScheduled = useRef(false);

  const getActiveRef = useCallback(() => activeSlotRef.current === 0 ? refA : refB, []);
  const getStandbyRef = useCallback(() => activeSlotRef.current === 0 ? refB : refA, []);

  const getActiveState = useCallback(() => activeSlotRef.current === 0 ? slotAState : slotBState, []);
  const getStandbyState = useCallback(() => activeSlotRef.current === 0 ? slotBState : slotAState, []);
  const getActiveUrl = useCallback(() => activeSlotRef.current === 0 ? slotAUrl : slotBUrl, []);
  const getStandbyUrl = useCallback(() => activeSlotRef.current === 0 ? slotBUrl : slotAUrl, []);

  const setActiveSource = useCallback((url: string | null) => {
    if (activeSlotRef.current === 0) { setSlotASource(url); slotAUrl.current = url; }
    else { setSlotBSource(url); slotBUrl.current = url; }
  }, []);

  const setStandbySource = useCallback((url: string | null) => {
    if (activeSlotRef.current === 0) { setSlotBSource(url); slotBUrl.current = url; }
    else { setSlotASource(url); slotAUrl.current = url; }
  }, []);

  const setActivePaused = useCallback((p: boolean) => {
    if (activeSlotRef.current === 0) { setSlotAPaused(p); }
    else { setSlotBPaused(p); }
  }, []);

  const setStandbyPaused = useCallback((_p: boolean) => {
    if (activeSlotRef.current === 0) { setSlotBPaused(true); }
    else { setSlotAPaused(true); }
  }, []);

  // Engine drives AUDIO playback only (playlist/global audio mode).
  // Video playback is always handled by FullScreenPlayer's own <Video> or PostCard's
  // MediaPlayer — the engine can't display video frames from its hidden 1x1 slots.
  // The engine still preloads the next track in the queue for instant switching.
  const shouldDrive = !!(nowPlaying?.audioUrl && nowPlaying.mediaKind === 'audio');
  shouldDriveRef.current = shouldDrive;

  useEffect(() => {
    console.log(`[LIVIL][ENG] shouldDrive=${shouldDrive} mediaKind=${nowPlaying?.mediaKind} hasAudioUrl=${!!nowPlaying?.audioUrl}`);
    setEngineDriving(shouldDrive);
  }, [shouldDrive, setEngineDriving, nowPlaying?.mediaKind, nowPlaying?.audioUrl]);

  // Preload the next track on the standby slot
  const schedulePreload = useCallback(() => {
    if (preloadScheduled.current) { return; }
    preloadScheduled.current = true;
    setTimeout(() => {
      preloadScheduled.current = false;
      const nextIdx = currentIndexRef.current + 1;
      const next = queueRef.current[nextIdx];
      if (!next) { return; }
      const nextUrl = getTrackUrl(next);
      if (!nextUrl) { return; }
      // Don't preload if standby already has this URL
      if (getStandbyUrl().current === nextUrl) { return; }
      getStandbyState().current = 'loading';
      setStandbySource(nextUrl);
      setStandbyPaused(true);
    }, 500);
  }, [currentIndexRef, queueRef, getStandbyUrl, getStandbyState, setStandbySource, setStandbyPaused]);

  // When engine is driving and activePostId changes (playNext/playPrev),
  // look up the new track from the queue and call setNowPlaying.
  // PostCard does NOT call setNowPlaying when engine is driving (it checks pendingPlayId
  // but engine handles the actual track switch).
  const prevActivePostIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!shouldDrive || !activePostId) { return; }
    if (activePostId === prevActivePostIdRef.current) { return; }
    prevActivePostIdRef.current = activePostId;

    // If nowPlaying already matches, skip (initial activation)
    if (nowPlaying?.postId === activePostId) { return; }

    const next = queueRef.current.find(t => t.postId === activePostId);
    if (next) {
      setNowPlaying(next);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePostId, shouldDrive]);

  // When engine deactivates, clean up slots and clear buffering state
  useEffect(() => {
    if (!shouldDrive) {
      setSlotAPaused(true);
      setSlotBPaused(true);
      slotAState.current = 'idle';
      slotBState.current = 'idle';
      setSlotASource(null);
      setSlotBSource(null);
      slotAUrl.current = null;
      slotBUrl.current = null;
      setIsBuffering(false);
      setIsReadyForDisplay(true);
    }
  }, [shouldDrive, setIsBuffering, setIsReadyForDisplay]);

  // When nowPlaying changes AND engine should drive, load/swap
  useEffect(() => {
    if (!shouldDrive || !nowPlaying) { return; }

    nowPlayingRef.current = nowPlaying;
    const url = getTrackUrl(nowPlaying);
    if (!url) { return; }

    // Check if standby already has this track preloaded
    const standbyHasIt = getStandbyUrl().current === url &&
      (getStandbyState().current === 'ready' || getStandbyState().current === 'loading');

    if (standbyHasIt) {
      // Swap slots — standby becomes active
      setActivePaused(true);
      getActiveState().current = 'idle';

      const newActive: 0 | 1 = activeSlotRef.current === 0 ? 1 : 0;
      activeSlotRef.current = newActive;
      setActiveSlot(newActive);

      // Start playing the new active slot
      if (newActive === 0) {
        setSlotAPaused(false);
        slotAState.current = 'playing';
      } else {
        setSlotBPaused(false);
        slotBState.current = 'playing';
      }
      setIsBuffering(false);
      registerEngineHandlers();
      schedulePreload();
    } else {
      // Cold load into active slot
      setIsBuffering(true);
      setIsReadyForDisplay(false);
      getActiveState().current = 'loading';
      setActiveSource(url);
      setActivePaused(false);
      registerEngineHandlers();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowPlaying?.postId, shouldDrive]);

  const registerEngineHandlers = useCallback(() => {
    registerHandlers({
      play: () => setActivePaused(false),
      pause: () => setActivePaused(true),
      seek: (s: number) => {
        positionRef.current = s;
        getActiveRef().current?.seek(s);
      },
      setRate: () => {},
    });
  }, [registerHandlers, positionRef, getActiveRef, setActivePaused]);

  // --- Video callbacks (slot A) ---
  const handleLoadA = useCallback((data: OnLoadData) => {
    updateDuration(data.duration ?? 0);
    slotAState.current = 'ready';
    if (activeSlotRef.current === 0 && shouldDriveRef.current) {
      slotAState.current = 'playing';
      setIsBuffering(false);
      const pos = positionRef.current;
      if (pos > 0) { refA.current?.seek(pos); }
      schedulePreload();
    }
  }, [updateDuration, setIsBuffering, positionRef, schedulePreload]);

  const handleProgressA = useCallback((data: OnProgressData) => {
    if (activeSlotRef.current === 0 && shouldDriveRef.current) {
      updatePosition(data.currentTime ?? 0);
    }
  }, [updatePosition]);

  const handleBufferA = useCallback((e: { isBuffering: boolean }) => {
    if (activeSlotRef.current === 0 && shouldDriveRef.current) {
      setIsBuffering(e.isBuffering);
    }
  }, [setIsBuffering]);

  const handleReadyForDisplayA = useCallback(() => {
    if (activeSlotRef.current === 0 && shouldDriveRef.current) {
      setIsReadyForDisplay(true);
    }
  }, [setIsReadyForDisplay]);

  const handleEndA = useCallback(() => {
    if (activeSlotRef.current === 0 && shouldDriveRef.current) {
      playNext();
    }
  }, [playNext]);

  // --- Video callbacks (slot B) ---
  const handleLoadB = useCallback((data: OnLoadData) => {
    if (activeSlotRef.current === 1 && shouldDriveRef.current) {
      updateDuration(data.duration ?? 0);
      slotBState.current = 'playing';
      setIsBuffering(false);
      const pos = positionRef.current;
      if (pos > 0) { refB.current?.seek(pos); }
      schedulePreload();
    } else {
      slotBState.current = 'ready';
    }
  }, [updateDuration, setIsBuffering, positionRef, schedulePreload]);

  const handleProgressB = useCallback((data: OnProgressData) => {
    if (activeSlotRef.current === 1 && shouldDriveRef.current) {
      updatePosition(data.currentTime ?? 0);
    }
  }, [updatePosition]);

  const handleBufferB = useCallback((e: { isBuffering: boolean }) => {
    if (activeSlotRef.current === 1 && shouldDriveRef.current) {
      setIsBuffering(e.isBuffering);
    }
  }, [setIsBuffering]);

  const handleReadyForDisplayB = useCallback(() => {
    if (activeSlotRef.current === 1 && shouldDriveRef.current) {
      setIsReadyForDisplay(true);
    }
  }, [setIsReadyForDisplay]);

  const handleEndB = useCallback(() => {
    if (activeSlotRef.current === 1 && shouldDriveRef.current) {
      playNext();
    }
  }, [playNext]);

  const platformBufferProps = Platform.OS === 'android'
    ? { bufferConfig: ENGINE_BUFFER_CONFIG }
    : { preferredForwardBufferDuration: 20 };

  return (
    <View style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} pointerEvents="none">
      {slotASource && (
        <Video
          ref={refA}
          source={{ uri: slotASource }}
          paused={slotAPaused}
          onLoad={handleLoadA}
          onProgress={handleProgressA}
          onBuffer={handleBufferA}
          onReadyForDisplay={handleReadyForDisplayA}
          onEnd={handleEndA}
          progressUpdateInterval={250}
          playInBackground
          playWhenInactive
          ignoreSilentSwitch="ignore"
          muted={false}
          volume={1.0}
          {...platformBufferProps}
          {...(Platform.OS === 'android' ? { disableFocus: slotAPaused } : {})}
          style={{ width: 1, height: 1 }}
        />
      )}
      {slotBSource && (
        <Video
          ref={refB}
          source={{ uri: slotBSource }}
          paused={slotBPaused}
          onLoad={handleLoadB}
          onProgress={handleProgressB}
          onBuffer={handleBufferB}
          onReadyForDisplay={handleReadyForDisplayB}
          onEnd={handleEndB}
          progressUpdateInterval={250}
          playInBackground
          playWhenInactive
          ignoreSilentSwitch="ignore"
          muted={false}
          volume={1.0}
          {...platformBufferProps}
          {...(Platform.OS === 'android' ? { disableFocus: slotBPaused } : {})}
          style={{ width: 1, height: 1 }}
        />
      )}
    </View>
  );
}
