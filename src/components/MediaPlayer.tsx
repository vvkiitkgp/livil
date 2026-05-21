import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { View, StyleSheet, Image, Pressable, Text, Platform } from 'react-native';
import Video, { type VideoRef, type OnProgressData, type OnLoadData } from 'react-native-video';
import { COLORS } from '../theme/colors';
import { usePlayback } from '../contexts/PlaybackContext';

export type MediaShape =
  | { kind: 'audio'; audioUrl: string; coverUrl: string | null }
  | { kind: 'video'; videoUrl: string };

export type MediaPlayerHandle = {
  /** Programmatic seek in seconds. Mirrors the native player's `seek`. */
  seek: (seconds: number) => void;
  /** Force-pause without dropping ownership of the playback lock. */
  pause: () => void;
};

export type MediaPlayerProps = {
  /** A stable id, typically the post id, that the global PlaybackContext uses to
   *  enforce single-player-at-a-time semantics. */
  postId: string;
  media: MediaShape;
  /** Parent overrides — used by PostCard to drive the play/pause button. */
  paused: boolean;
  onTogglePaused: () => void;
  /** Progress events for the seek bar. We throttle inside this component to ~4 Hz
   *  so the bar updates smoothly without ping-ponging React. */
  onProgress?: (positionSeconds: number) => void;
  onLoaded?: (durationSeconds: number) => void;
  onEnded?: () => void;
  /** Externally requested seek position in seconds; used after the user drags
   *  the SeekBar thumb. */
  seekTo?: number | null;
  /** Pause when scrolled off-screen — visibility is debounced inside MediaPlayer
   *  because FlatList viewability can flicker during playback / layout. */
  visible: boolean;
  /**
   * Home feeds often mis-report viewability while `Video` surfaces resize / Android
   * clips rows — set false there and rely on tab blur (`pauseAll`) instead.
   */
  pauseWhenOffScreen?: boolean;
};

/**
 * Single component for both audio and video posts. For audio posts we render a
 * cover image stacked above a hidden `<Video audioOnly />`. For video posts the
 * `<Video>` renders the surface itself.
 *
 * We coordinate with PlaybackContext so only one player ever runs at a time —
 * when this player starts, others see `activePostId` change and pause.
 */
const MediaPlayer = forwardRef<MediaPlayerHandle, MediaPlayerProps>(function MediaPlayer(
  {
    postId,
    media,
    paused,
    onTogglePaused,
    onProgress,
    onLoaded,
    onEnded,
    seekTo,
    visible,
    pauseWhenOffScreen = true,
  },
  ref,
) {
  const playback = usePlayback();
  const videoRef = useRef<VideoRef>(null);
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  // FlatList viewability can flicker for a frame or two while media loads / layout
  // settles (especially with RefreshControl + large headers). Treat brief "hidden"
  // blips as still on-screen so playback isn't cut off after ~1s.
  const [visibilityGateOpen, setVisibilityGateOpen] = useState(true);
  const visibilityHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track-throttled progress: we get ~4 callbacks per second from the player,
  // which is already a good cadence for the seek bar.
  const lastEmittedRef = useRef(0);

  useEffect(() => {
    if (!pauseWhenOffScreen) {
      if (visibilityHideTimerRef.current != null) {
        clearTimeout(visibilityHideTimerRef.current);
        visibilityHideTimerRef.current = null;
      }
      setVisibilityGateOpen(true);
      return;
    }

    if (visible) {
      if (visibilityHideTimerRef.current != null) {
        clearTimeout(visibilityHideTimerRef.current);
        visibilityHideTimerRef.current = null;
      }
      setVisibilityGateOpen(true);
      return;
    }

    visibilityHideTimerRef.current = setTimeout(() => {
      visibilityHideTimerRef.current = null;
      setVisibilityGateOpen(false);
    }, 480);

    return () => {
      if (visibilityHideTimerRef.current != null) {
        clearTimeout(visibilityHideTimerRef.current);
        visibilityHideTimerRef.current = null;
      }
    };
  }, [visible, pauseWhenOffScreen]);

  useImperativeHandle(
    ref,
    () => ({
      seek: (seconds: number) => {
        videoRef.current?.seek(Math.max(0, seconds));
      },
      pause: () => {
        // Just forward to the parent via the toggle? No — we want a hard pause.
        // The parent owns `paused` so we ask it to flip via reportPaused below.
        playback.reportPaused(postId);
      },
    }),
    [playback, postId],
  );

  // When another card snatches the active slot, the parent's `paused` should
  // already flip; off-screen handling uses `visibilityGateOpen` (debounced).
  const effectivePaused = paused || (pauseWhenOffScreen && !visibilityGateOpen);

  // If we just transitioned from paused to playing, claim the active slot.
  useEffect(() => {
    if (!effectivePaused) {
      playback.requestPlay(postId);
    } else if (playback.isActive(postId)) {
      playback.reportPaused(postId);
    }
    // We intentionally exclude `playback` from deps — its methods are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePaused, postId]);

  // Apply an external seek (from SeekBar drag-end).
  useEffect(() => {
    if (seekTo == null) {return;}
    videoRef.current?.seek(Math.max(0, seekTo));
  }, [seekTo]);

  const handleLoad = useCallback(
    (data: OnLoadData) => {
      setLoaded(true);
      setErrored(false);
      onLoaded?.(data.duration ?? 0);
    },
    [onLoaded],
  );

  const handleProgress = useCallback(
    (data: OnProgressData) => {
      const now = Date.now();
      if (now - lastEmittedRef.current < 200) {return;}
      lastEmittedRef.current = now;
      onProgress?.(data.currentTime ?? 0);
    },
    [onProgress],
  );

  const handleEnd = useCallback(() => {
    onEnded?.();
    playback.reportPaused(postId);
  }, [onEnded, playback, postId]);

  const handleError = useCallback(() => {
    setErrored(true);
    playback.reportPaused(postId);
  }, [playback, postId]);

  const source = useMemo(() => {
    if (media.kind === 'audio') {return { uri: media.audioUrl };}
    return { uri: media.videoUrl };
  }, [media]);

  return (
    <Pressable
      style={styles.container}
      onPress={onTogglePaused}
      accessibilityRole="button"
      accessibilityLabel={effectivePaused ? 'Play' : 'Pause'}
    >
      {/* The Video element always fills the container so the native surface
          (ExoPlayer on Android, AVPlayer on iOS) has real layout — earlier
          versions of this used a 1×1 invisible surface for audio posts and
          ExoPlayer never reached ready state, so onLoad never fired. */}
      <Video
        ref={videoRef}
        source={source}
        paused={effectivePaused}
        {...(Platform.OS === 'android'
          ? {
              // Paused/off-screen ExoPlayers still request audio focus by default;
              // dozens mount when multiple tabs/lists render and they preempt real playback.
              disableFocus: effectivePaused,
            }
          : {})}
        style={styles.video}
        resizeMode="cover"
        onLoad={handleLoad}
        onProgress={handleProgress}
        onEnd={handleEnd}
        onError={handleError}
        progressUpdateInterval={250}
        playInBackground={false}
        playWhenInactive={false}
        ignoreSilentSwitch="ignore"
        muted={false}
        volume={1.0}
      />

      {/* For audio posts we layer the cover (or fallback art) on top of the
          Video so the user sees the artwork instead of a black surface. */}
      {media.kind === 'audio' && media.coverUrl ? (
        // Image doesn't intercept touches by default, so taps still reach the
        // outer Pressable that toggles play/pause.
        <Image source={{ uri: media.coverUrl }} style={styles.cover} resizeMode="cover" />
      ) : null}

      {media.kind === 'audio' && !media.coverUrl ? (
        <View style={styles.fallbackArt} pointerEvents="none">
          <View style={styles.fallbackBlobA} />
          <View style={styles.fallbackBlobB} />
        </View>
      ) : null}

      {/* Center play-glyph overlay shown when paused or before first play. */}
      {effectivePaused ? (
        <View pointerEvents="none" style={styles.playGlyphWrap}>
          <View style={styles.playGlyph}>
            <Text style={styles.playGlyphText}>▶</Text>
          </View>
        </View>
      ) : null}

      {errored ? (
        <View style={styles.errorOverlay} pointerEvents="none">
          <Text style={styles.errorText}>Couldn't load this media</Text>
        </View>
      ) : null}

      {!loaded && !errored ? (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <View style={styles.loadingDot} />
        </View>
      ) : null}
    </Pressable>
  );
});

export default MediaPlayer;

const styles = StyleSheet.create({
  container: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#000',
    borderRadius: 18,
    overflow: 'hidden',
    position: 'relative',
  },
  cover: {
    ...StyleSheet.absoluteFillObject,
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
  fallbackArt: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.card,
    overflow: 'hidden',
  },
  fallbackBlobA: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: COLORS.purple,
    opacity: 0.45,
    top: -60,
    left: -40,
  },
  fallbackBlobB: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#EC4899',
    opacity: 0.35,
    bottom: -50,
    right: -20,
  },
  playGlyphWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playGlyph: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  playGlyphText: {
    color: COLORS.white,
    fontSize: 24,
    marginLeft: 4,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  errorText: {
    color: COLORS.error,
    fontSize: 13,
    fontWeight: '600',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.purpleLight,
    opacity: 0.6,
  },
});
