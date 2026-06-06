import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Video, { type VideoRef, type OnLoadData, type OnProgressData } from 'react-native-video';
import { usePlayback } from '../contexts/PlaybackContext';

const AUDIO_BUFFER_CONFIG = {
  minBufferMs: 15_000,
  maxBufferMs: 50_000,
  bufferForPlaybackMs: 2_500,
  bufferForPlaybackAfterRebufferMs: 5_000,
  backBufferDurationMs: 10_000,
  cacheSizeMB: 200,
};

/**
 * Hidden audio player that activates whenever nowPlaying.audioUrl is set
 * (i.e. playback was triggered from a playlist, not from a PostCard inline player).
 *
 * Registers handlers so FloatingPlayer's tap, flick-skip, and FullScreenPlayer
 * controls all work exactly like they do for PostCard audio.
 *
 * PostCard audio always sets nowPlaying WITHOUT audioUrl, so this component stays
 * silent in that case and PostCard's own <Video> remains the audio source.
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
  } = usePlayback();

  const videoRef = useRef<VideoRef>(null);
  const [paused, setPaused] = useState(true);

  // Which postId this component is currently responsible for
  const myPostIdRef = useRef<string | null>(null);

  // Activate/deactivate based on whether nowPlaying carries an audioUrl
  useEffect(() => {
    const url = nowPlaying?.audioUrl;
    if (url && nowPlaying?.mediaKind === 'audio') {
      console.log(`[LIVIL][GAP] activating for postId=${nowPlaying.postId}`);
      myPostIdRef.current = nowPlaying.postId;
      setPaused(false);
      registerHandlers({
        play:    () => { console.log('[LIVIL][GAP] handler PLAY'); setPaused(false); },
        pause:   () => { console.log('[LIVIL][GAP] handler PAUSE'); setPaused(true); },
        seek:    (s: number) => {
          console.log(`[LIVIL][GAP] handler SEEK to=${s.toFixed(1)}s`);
          positionRef.current = s;
          videoRef.current?.seek(s);
        },
        setRate: () => {},
      });
    } else {
      // No audio URL (PostCard is the source, or nothing playing)
      myPostIdRef.current = null;
      setPaused(true);
      // Do NOT call unregisterHandlers — whoever takes over will registerHandlers,
      // overwriting ours. Nulling handlersRef here would race with PostCard's register.
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowPlaying?.postId, nowPlaying?.audioUrl]);

  // When activePostId changes while we're the active player, advance to the new track.
  // This handles FloatingPlayer flick-skip (playNext / playPrev) and track-end advances.
  const prevActivePostId = useRef<string | null>(null);
  useEffect(() => {
    const mine = myPostIdRef.current;
    if (!mine) { return; }
    if (activePostId === prevActivePostId.current) { return; }
    prevActivePostId.current = activePostId;

    if (!activePostId || activePostId === mine) { return; }

    const next = queueRef.current[currentIndexRef.current];
    if (next?.audioUrl) {
      setNowPlaying(next);
    } else {
      myPostIdRef.current = null;
      setPaused(true);
    }
  }, [activePostId, queueRef, currentIndexRef, setNowPlaying]);

  const handleLoad = useCallback((data: OnLoadData) => {
    updateDuration(data.duration ?? 0);
    const pos = positionRef.current;
    if (pos > 0) { videoRef.current?.seek(pos); }
  }, [updateDuration, positionRef]);

  const handleProgress = useCallback((data: OnProgressData) => {
    updatePosition(data.currentTime ?? 0);
  }, [updatePosition]);

  const handleEnd = useCallback(() => {
    playNext();
  }, [playNext]);

  // Don't render when PlaybackEngine is handling playback, or no audio URL
  if (engineDriving || !nowPlaying?.audioUrl || nowPlaying.mediaKind !== 'audio') {
    return null;
  }

  return (
    <Video
      ref={videoRef}
      source={{ uri: nowPlaying.audioUrl }}
      paused={paused}
      onLoad={handleLoad}
      onProgress={handleProgress}
      onEnd={handleEnd}
      progressUpdateInterval={250}
      playInBackground
      playWhenInactive
      ignoreSilentSwitch="ignore"
      muted={false}
      volume={1.0}
      {...(Platform.OS === 'android'
        ? { bufferConfig: AUDIO_BUFFER_CONFIG }
        : { preferredForwardBufferDuration: 20 })}
      style={{ width: 0, height: 0, position: 'absolute' }}
    />
  );
}
