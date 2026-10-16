import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Reanimated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { COLORS } from '../theme/colors';
import { GradientBorder } from './GradientBorder';
import { Icon } from './Icon';
import { ViewType } from 'react-native-video';
import MediaPlayer, { type MediaPlayerHandle, type MediaShape } from './MediaPlayer';

/**
 * A phone-shaped window onto how a VIDEO looks in the full-screen player, before it is posted
 * (the upload's Preview page). The frame is at the screen's own proportions, so the crop it
 * shows is the crop full screen makes, and it has the full-screen player's pinch: the video
 * starts full-bleed ("cover"); pinching out goes to the whole frame ("contain"), pinching in
 * back — the same range FullScreenPlayer allows. A tap plays / pauses.
 *
 * Sound comes from the standalone MediaPlayer (the upload screen's preview player), never
 * the global engine. `onPinchingChange` lets the screen hold its scroll still during a pinch,
 * so two fingers zoom the video instead of dragging the page.
 */
export default function FullScreenFrame({
  media,
  width,
  height,
  radius,
  border,
  paused,
  onTogglePaused,
  onProgress,
  onLoaded,
  onEnded,
  onPinchingChange,
  playerRef,
}: {
  media: Extract<MediaShape, { kind: 'video' }>;
  width: number;
  height: number;
  radius: number;
  border: number;
  paused: boolean;
  onTogglePaused: () => void;
  onProgress?: (seconds: number) => void;
  onLoaded?: (seconds: number) => void;
  onEnded?: () => void;
  onPinchingChange?: (pinching: boolean) => void;
  playerRef?: React.Ref<MediaPlayerHandle>;
}) {
  const innerW = width - border * 2;
  const innerH = height - border * 2;
  const [aspect, setAspect] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const handleLoaded = useCallback((s: number) => {
    setLoaded(true);
    onLoaded?.(s);
  }, [onLoaded]);

  // The video fitted whole inside the screen at scale 1 ("contain"), and the scale at which
  // it fills the screen instead ("cover") — full screen's default look.
  const wider = aspect != null && aspect > innerW / innerH;
  const containW = aspect ? (wider ? innerW : innerH * aspect) : innerW;
  const containH = aspect ? (wider ? innerW / aspect : innerH) : innerH;
  const coverScale = aspect ? Math.max(innerW / containW, innerH / containH) : 1;

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const maxScale = useSharedValue(1);
  // Set, not animated: the size switches to "contain" in the same render, so animating up
  // from 1 would flash the letterboxed frame before settling on full-bleed.
  useEffect(() => {
    maxScale.value = coverScale;
    scale.value = coverScale;
  }, [coverScale, maxScale, scale]);

  const pinch = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value;
      if (onPinchingChange) { runOnJS(onPinchingChange)(true); }
    })
    .onUpdate(e => {
      scale.value = Math.min(maxScale.value, Math.max(1, savedScale.value * e.scale));
    })
    .onFinalize(() => {
      if (onPinchingChange) { runOnJS(onPinchingChange)(false); }
    });
  const zoomStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    // The video fills the frame up to its rounded outline (`border` is just the outline's
    // thickness), so at full-bleed the outline's curve trims its corners, as a phone would.
    // No overflow:'hidden' on the GradientBorder host (CLAUDE.md); the screen clips itself.
    <View style={[styles.frame, { width, height, borderRadius: radius, padding: border }]}>
      <GradientBorder borderRadius={radius} />
      <GestureDetector gesture={pinch}>
        <View style={[styles.screen, { borderRadius: Math.max(0, radius - border) }]}>
          <Reanimated.View style={zoomStyle}>
            <MediaPlayer
              ref={playerRef}
              postId="upload_preview"
              media={media}
              paused={paused}
              onTogglePaused={onTogglePaused}
              onProgress={onProgress}
              onLoaded={handleLoaded}
              onNaturalAspect={setAspect}
              onEnded={onEnded}
              visible
              pauseWhenOffScreen={false}
              // A preview keeps going: replay it as many times as they like.
              repeat
              // TextureView, not SurfaceView: the pinch SCALES this frame, and Android's
              // SurfaceView ignores transforms (the video would not zoom at all).
              viewType={ViewType.TEXTURE}
              // Its overlays would scale with the video (a giant play button); drawn
              // below instead, outside the zoom.
              overlays={false}
              // borderRadius 0: MediaPlayer rounds its own corners by default, which showed
              // when zoomed out. The whole frame, zoomed out, is the video exactly as it is.
              style={[styles.player, { width: containW, height: containH }]}
            />
          </Reanimated.View>
          {paused || !loaded ? (
            <View pointerEvents="none" style={styles.overlay}>
              {loaded ? (
                <View style={styles.playGlyph}>
                  {/* Nudged: a centred triangle reads as pushed left (as MediaPlayer). */}
                  <View style={styles.playNudge}>
                    <Icon name="play" size={22} color={COLORS.white} />
                  </View>
                </View>
              ) : (
                <ActivityIndicator size="small" color={COLORS.purpleLight} />
              )}
            </View>
          ) : null}
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { backgroundColor: '#000' },
  player: { borderRadius: 0 },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  // MediaPlayer's glyph, a touch smaller for the smaller window.
  playGlyph: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  playNudge: { marginLeft: 3 },
  screen: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
