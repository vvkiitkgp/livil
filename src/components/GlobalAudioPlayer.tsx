import React, { useCallback, useEffect, useRef, useState } from 'react';
import Video, { type VideoRef, type OnLoadData, type OnProgressData } from 'react-native-video';
import { usePlayback } from '../contexts/PlaybackContext';

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
    playNext,
    playPrev,
  } = usePlayback();

  const videoRef = useRef<VideoRef>(null);
  const [paused, setPaused] = useState(true);

  // Which postId this component is currently responsible for
  const myPostIdRef = useRef<string | null>(null);

  // Activate/deactivate based on whether nowPlaying carries an audioUrl
  useEffect(() => {
    const url = nowPlaying?.audioUrl;
    if (url && nowPlaying?.mediaKind === 'audio') {
      myPostIdRef.current = nowPlaying.postId;
      setPaused(false);
      registerHandlers({
        play:    () => setPaused(false),
        pause:   () => setPaused(true),
        seek:    (s: number) => {
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

    // Find the next track in the queue (it carries audioUrl from PlaylistScreen)
    const next = queueRef.current.find(t => t.postId === activePostId);
    if (next?.audioUrl) {
      setNowPlaying(next);
    } else {
      myPostIdRef.current = null;
      setPaused(true);
    }
  }, [activePostId, queueRef, setNowPlaying]);

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

  // Only render (and stream) when we have an audio URL to play
  if (!nowPlaying?.audioUrl || nowPlaying.mediaKind !== 'audio') {
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
      style={{ width: 0, height: 0, position: 'absolute' }}
    />
  );
}
