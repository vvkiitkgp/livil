import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme/colors';
import { Button } from './Button';
import { GradientBorder } from './GradientBorder';
import { Icon } from './Icon';
import MediaPlayer, { type MediaPlayerHandle, type MediaShape } from './MediaPlayer';
import WaveformScrubber from './WaveformScrubber';

const { width: SCREEN_W } = Dimensions.get('window');
const ART_SIDE = SCREEN_W - 64;
const MAX_ZOOM = 3;
/** Same timing as FullScreenPlayer's hint: after the open, on screen ~1.5 s. */
const HINT_DELAY_MS = 500;

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) { return '0:00'; }
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * The upload's full-screen preview: the song or video as the full-screen player will show
 * it, before it is posted. OK closes it and stops the sound.
 *
 * NOT FullScreenPlayer. That one IS the global engine's view — it reads `nowPlaying`, the
 * queue and the floating player, and playing an unpublished file through it would put the
 * song on the lock screen, in "listening now" for friends and in play counts. This is a
 * temporary surface over the upload screen: sound comes from the standalone preview player
 * (MediaPlayer, the same one the upload screen always used), nothing is queued, and the
 * floating player is never involved. Queue and Info are drawn, disabled, so the screen
 * reads like the real one.
 *
 * Video gets the full-screen player's gestures: a tap hides the controls (clean view) and
 * a pinch zooms, with the same "Tap and pinch" pill on open.
 */
export default function UploadPreviewPlayer({
  visible,
  media,
  title,
  artistLine,
  onClose,
  onDuration,
}: {
  visible: boolean;
  media: MediaShape | null;
  title: string;
  /** "Riya · Vocals" — who made it, as the player's credit line will say. */
  artistLine: string;
  onClose: () => void;
  /** The file's length, once the player reports it. */
  onDuration?: (seconds: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const playerRef = useRef<MediaPlayerHandle>(null);
  const [paused, setPaused] = useState(true);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [clean, setClean] = useState(false);
  const scrubbingRef = useRef(false);
  const isVideo = media?.kind === 'video';

  // A fresh start on every open: from 0, controls shown, not zoomed.
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  useEffect(() => {
    if (!visible) { return; }
    setPaused(true);
    setPosition(0);
    setClean(false);
    scale.value = 1;
    savedScale.value = 1;
  }, [visible, scale, savedScale]);

  const close = useCallback(() => {
    setPaused(true);
    onClose();
  }, [onClose]);

  const pinch = Gesture.Pinch()
    .enabled(isVideo)
    .onStart(() => {
      savedScale.value = scale.value;
    })
    .onUpdate(e => {
      scale.value = Math.min(MAX_ZOOM, Math.max(1, savedScale.value * e.scale));
    })
    .onEnd(() => {
      if (scale.value < 1.05) { scale.value = withTiming(1, { duration: 160 }); }
    });
  const zoomStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  // "Tap and pinch", once per open of a video.
  const hint = useRef(new Animated.Value(0)).current;
  const [hintOn, setHintOn] = useState(false);
  useEffect(() => {
    if (!visible || !isVideo) { return; }
    const t = setTimeout(() => setHintOn(true), HINT_DELAY_MS);
    return () => clearTimeout(t);
  }, [visible, isVideo]);
  useEffect(() => {
    if (!hintOn) { return; }
    const anim = Animated.sequence([
      Animated.timing(hint, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.delay(1000),
      Animated.timing(hint, { toValue: 0, duration: 320, useNativeDriver: true }),
    ]);
    anim.start(({ finished }) => { if (finished) { setHintOn(false); } });
    return () => anim.stop();
  }, [hintOn, hint]);
  // Found clean view → they know; drop the pill now.
  useEffect(() => {
    if (clean) { setHintOn(false); hint.setValue(0); }
  }, [clean, hint]);

  const handleLoaded = useCallback((s: number) => {
    setDuration(s);
    onDuration?.(s);
  }, [onDuration]);

  const handleProgress = useCallback((s: number) => {
    if (!scrubbingRef.current) { setPosition(s); }
  }, []);

  const handleEnded = useCallback(() => {
    setPaused(true);
    setPosition(0);
    playerRef.current?.seek(0);
  }, []);

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent onRequestClose={close}>
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.mediaArea}>
          {media ? (
            isVideo ? (
              <GestureDetector gesture={pinch}>
                <Reanimated.View style={[styles.videoWrap, zoomStyle]}>
                  <MediaPlayer
                    ref={playerRef}
                    postId="upload_preview"
                    media={media}
                    paused={paused}
                    // On a video a tap is clean view, as in the full-screen player; play
                    // and pause live on the button below.
                    onTogglePaused={() => setClean(c => !c)}
                    onProgress={handleProgress}
                    onLoaded={handleLoaded}
                    onEnded={handleEnded}
                    visible
                    pauseWhenOffScreen={false}
                    style={styles.videoPlayer}
                  />
                </Reanimated.View>
              </GestureDetector>
            ) : (
              <View style={styles.artCard}>
                <MediaPlayer
                  ref={playerRef}
                  postId="upload_preview"
                  media={media}
                  paused={paused}
                  onTogglePaused={() => setPaused(p => !p)}
                  onProgress={handleProgress}
                  onLoaded={handleLoaded}
                  onEnded={handleEnded}
                  visible
                  pauseWhenOffScreen={false}
                  style={styles.artPlayer}
                />
              </View>
            )
          ) : null}
        </View>

        {hintOn ? (
          <Animated.View style={[styles.hintWrap, { opacity: hint }]} pointerEvents="none">
            <View style={styles.hintPill}>
              <Icon name="handTap" size={16} color={COLORS.purpleLight} />
              <Text style={styles.hintText}>Tap and pinch</Text>
              <Icon name="zoomOut" size={16} color={COLORS.purpleLight} />
            </View>
          </Animated.View>
        ) : null}

        {clean ? null : (
          <>
            <View style={[styles.header, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
              <Text style={styles.headerLabel}>Preview</Text>
              <Button label="OK" onPress={close} variant="primary" size="sm" onMedia style={styles.okButton} />
            </View>

            <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
              <Text style={styles.title} numberOfLines={2}>{title.trim() || 'Untitled'}</Text>
              <Text style={styles.artist} numberOfLines={1}>{artistLine}</Text>

              {duration > 0 ? (
                <View style={styles.seek}>
                  <WaveformScrubber
                    position={position}
                    duration={duration}
                    seed={media?.kind === 'audio' ? media.audioUrl : (media?.videoUrl ?? '')}
                    span="full"
                    height={40}
                    onSeekStart={() => { scrubbingRef.current = true; }}
                    onSeek={s => setPosition(s)}
                    onSeekEnd={s => {
                      scrubbingRef.current = false;
                      setPosition(s);
                      playerRef.current?.seek(s);
                    }}
                  />
                  <View style={styles.timeRow}>
                    <Text style={styles.time}>{formatClock(position)}</Text>
                    <Text style={styles.time}>{formatClock(duration)}</Text>
                  </View>
                </View>
              ) : null}

              <TouchableOpacity
                style={styles.playBtn}
                activeOpacity={0.85}
                onPress={() => setPaused(p => !p)}
                accessibilityRole="button"
                accessibilityLabel={paused ? 'Play' : 'Pause'}
              >
                <GradientBorder borderRadius={32} />
                <Icon name={paused ? 'play' : 'pause'} size={26} color={COLORS.purpleNeon} />
              </TouchableOpacity>

              {/* Drawn so this reads as the full-screen player; there is no queue or track
                  info for a post that does not exist yet. */}
              <View style={styles.tabs}>
                {['Queue', 'Info'].map(tab => (
                  <View key={tab} style={styles.tab} accessibilityState={{ disabled: true }}>
                    <Text style={styles.tabText}>{tab}</Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  mediaArea: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  videoWrap: { width: SCREEN_W },
  videoPlayer: { width: SCREEN_W },
  // Matches FullScreenPlayer's audio art card: rounded, hairline edge, lifted.
  artCard: {
    width: ART_SIDE,
    height: ART_SIDE,
    marginBottom: 140,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: COLORS.card,
  },
  artPlayer: { width: ART_SIDE, height: ART_SIDE },
  header: {
    position: 'absolute', left: 0, right: 0, top: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  headerLabel: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '700', letterSpacing: 0.3 },
  okButton: { minWidth: 72 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 24, gap: 6 },
  title: {
    color: COLORS.white, fontSize: 22, fontWeight: '800', letterSpacing: -0.5,
    textShadowColor: 'rgba(0,0,0,0.85)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8,
  },
  artist: { color: COLORS.textSecondary, fontSize: 14 },
  seek: { marginTop: 10 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  time: { color: COLORS.textSecondary, fontSize: 12, fontVariant: ['tabular-nums'] },
  playBtn: {
    alignSelf: 'center',
    width: 64, height: 64, borderRadius: 32,
    marginTop: 10,
    backgroundColor: 'rgba(10,10,15,0.9)',
    alignItems: 'center', justifyContent: 'center',
  },
  // FullScreenPlayer's Queue / Info buttons, at rest and greyed out.
  tabs: { flexDirection: 'row', gap: 10, marginTop: 14 },
  tab: {
    flex: 1, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(10,10,15,0.9)', borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
    opacity: 0.4,
  },
  tabText: { color: COLORS.white, fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  hintWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  hintPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999,
    backgroundColor: 'rgba(10,10,15,0.9)',
    borderWidth: 1, borderColor: COLORS.border,
  },
  hintText: { color: COLORS.white, fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
});
