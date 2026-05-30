import React, { useEffect, useRef } from 'react';
import {
  View,
  Image,
  StyleSheet,
  Animated,
  Dimensions,
  Platform,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayback } from '../contexts/PlaybackContext';
import { COLORS } from '../theme/colors';

// ─── Dimensions ───────────────────────────────────────────────────────────────
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Circle
const D = 60;  // diameter
const R = D / 2;
const B = 4;   // arc ring width

// The bar + circle occupy 50% of screen width, centered
const CONTAINER_W = SCREEN_W * 0.5;
// How far the circle's center can travel before hitting the bar edge
const MAX_DRAG = CONTAINER_W / 2 - R;

// Gesture thresholds
const SNAP_VELOCITY   = 400;   // px/s — horizontal flick qualifies as skip
const SNAP_DISTANCE   = 40;    // px   — (unused, kept for reference)
const OPEN_FS_DIST    = 80;    // px   — upward drag distance that opens full-screen player
const OPEN_FS_VEL     = 500;   // px/s — upward velocity that opens full-screen player
const CLOSE_FS_DIST   = 40;    // px   — downward drag (on circle) that closes full-screen player
const CLOSE_FS_VEL    = 400;   // px/s — downward flick (on circle) that closes full-screen player

// Vertical clamp for the draggable circle
const MAX_DRAG_Y_UP   = 180;   // px — how far up the circle can travel
const MAX_DRAG_Y_DOWN = 60;    // px — how far down the circle can travel

// Playback rates while dragging
const RATE_FORWARD = 2.0;
const RATE_REVERSE = -1.0;  // negative = reverse (iOS AVPlayer; Android clamps to 0)

export const FLOATING_PLAYER_HEIGHT = D;

export default function FloatingPlayer() {
  const insets = useSafeAreaInsets();
  // Re-compute bottom here so the Android system nav bar (insets.bottom) is
  // included.  The module-level PLAYER_BOTTOM uses a hardcoded TAB_BAR_H and
  // must NOT be used for the actual container position.
  const tabBarH      = Platform.OS === 'ios' ? 84 : 64 + insets.bottom;
  const playerBottom = Math.max(SCREEN_H * 0.10, tabBarH + 10);

  const {
    nowPlaying,
    isStoryViewerOpen,
    activePostId,
    positionRef,
    durationRef,
    handlersRef,
    playNext,
    playPrev,
    openFullScreenPlayer,
    closeFullScreenPlayer,
    isFullScreenOpen,
    jamLocked,
  } = usePlayback();

  // ─── Animations ─────────────────────────────────────────────────────────────
  const slideAnim    = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  // 2-D offset of the draggable circle (both axes, 0 = resting center)
  const circleX = useRef(new Animated.Value(0)).current;
  const circleY = useRef(new Animated.Value(0)).current;
  // Scale: pops up on press, springs back on release
  const scaleAnim = useRef(new Animated.Value(1)).current;

  // Slide in / out when nowPlaying changes
  const wasVisible = useRef(false);
  useEffect(() => {
    if (nowPlaying && !wasVisible.current) {
      wasVisible.current = true;
      Animated.spring(slideAnim, { toValue: 1, useNativeDriver: true, bounciness: 6 }).start();
    } else if (!nowPlaying && wasVisible.current) {
      wasVisible.current = false;
      Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    }
  }, [nowPlaying, slideAnim]);

  // Poll progress at ~4 Hz and drive the arc
  useEffect(() => {
    if (!nowPlaying) { return; }
    const id = setInterval(() => {
      const dur = durationRef.current;
      const pos = positionRef.current;
      progressAnim.setValue(dur > 0 ? Math.min(1, Math.max(0, pos / dur)) : 0);
    }, 250);
    return () => clearInterval(id);
  }, [nowPlaying, positionRef, durationRef, progressAnim]);

  // ─── Helper: spring circle back to center (both axes) ─────────────────────
  const springBack = () => {
    Animated.parallel([
      Animated.spring(circleX, { toValue: 0, useNativeDriver: true, bounciness: 10, speed: 14 }),
      Animated.spring(circleY, { toValue: 0, useNativeDriver: true, bounciness: 10, speed: 14 }),
    ]).start();
  };

  // ─── Rewind helpers ──────────────────────────────────────────────────────────
  const rewindTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopRewind = () => {
    if (rewindTimer.current !== null) {
      clearInterval(rewindTimer.current);
      rewindTimer.current = null;
    }
  };

  const startRewind = () => {
    stopRewind();
    // 0.5 s back every 250 ms ≈ 2× reverse. Seek-based so it works on Android too.
    rewindTimer.current = setInterval(() => {
      const newPos = Math.max(0, positionRef.current - 0.5);
      positionRef.current = newPos;
      handlersRef.current?.seek(newPos);
    }, 250);
  };

  // ─── Gestures ────────────────────────────────────────────────────────────────

  // Double-tap: opens full-screen player.
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .runOnJS(true)
    .onEnd((_e, success) => {
      if (success && !jamLocked) { openFullScreenPlayer(); }
    });

  // Single-tap: toggle play / pause. Exclusive ensures double-tap wins when detected.
  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .runOnJS(true)
    .onEnd((_e, success) => {
      if (!success || jamLocked) { return; }
      if (activePostId) { handlersRef.current?.pause(); }
      else { handlersRef.current?.play(); }
    });

  const tapGesture = Gesture.Exclusive(doubleTap, singleTap);

  // Single pan gesture — circle follows the finger in all four directions.
  // Horizontal drag controls playback speed / rewind; upward drag opens the
  // full-screen player on release; downward drag is allowed physically but
  // has no special action. Simultaneous with the tap gesture so taps still fire.
  const panGesture = Gesture.Pan()
    .runOnJS(true)
    .onBegin(() => {
      // Pop the circle up on any touch — fires before the gesture activates,
      // so it covers both quick taps and sustained holds.
      scaleAnim.stopAnimation();
      Animated.spring(scaleAnim, {
        toValue: 1.22,
        useNativeDriver: true,
        bounciness: 14,
        speed: 28,
      }).start();
    })
    .onStart(() => {
      if (jamLocked) { return; }
      circleX.stopAnimation();
      circleY.stopAnimation();
      stopRewind();
    })
    .onUpdate((e) => {
      // Circle follows the finger in both axes, clamped to safe ranges.
      const clampedX = Math.max(-MAX_DRAG,       Math.min(MAX_DRAG,       e.translationX));
      const clampedY = Math.max(-MAX_DRAG_Y_UP,  Math.min(MAX_DRAG_Y_DOWN, e.translationY));
      circleX.setValue(clampedX);
      circleY.setValue(clampedY);

      // Speed / rewind effects apply only when the gesture is primarily horizontal.
      const isHorizontal = Math.abs(e.translationX) > Math.abs(e.translationY);
      if (isHorizontal) {
        if (e.translationX >= 0) {
          stopRewind();
          handlersRef.current?.setRate(RATE_FORWARD);      // 2× fast-forward
        } else {
          handlersRef.current?.setRate(1.0);
          // Only rewind while the song is actively playing — mirrors the
          // forward behaviour (2× rate has no effect when paused either).
          if (rewindTimer.current === null && activePostId !== null) { startRewind(); }
        }
      } else {
        // Vertical drag — keep normal playback, cancel any rewind.
        stopRewind();
        handlersRef.current?.setRate(1.0);
      }
    })
    .onEnd((e) => {
      stopRewind();
      handlersRef.current?.setRate(1.0);
      springBack();

      // Downward drag while full screen is open → close it.
      if (isFullScreenOpen &&
          (e.translationY > CLOSE_FS_DIST || e.velocityY > CLOSE_FS_VEL)) {
        closeFullScreenPlayer();
        return;
      }

      // Upward drag past threshold → open full-screen player.
      // Check before horizontal snap so a diagonal-up-right drag doesn't skip.
      if (!isFullScreenOpen &&
          (e.translationY < -OPEN_FS_DIST ||
           (e.velocityY < -OPEN_FS_VEL && e.translationY < -20))) {
        openFullScreenPlayer();
        return;
      }

      // Horizontal snap = quick flick only (velocity). Slow hold-and-release
      // must never trigger next/prev even if the circle travelled far.
      const isSnap = Math.abs(e.velocityX) > SNAP_VELOCITY;
      if (isSnap) {
        if (e.velocityX > 0) { playNext(); }
        else { playPrev(); }
      }
    })
    .onFinalize(() => {
      // Fires after onEnd AND on external cancellation (e.g. incoming call).
      stopRewind();
      handlersRef.current?.setRate(1.0);
      springBack();
      // Spring the circle back to its resting scale.
      scaleAnim.stopAnimation();
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        bounciness: 8,
        speed: 18,
      }).start();
    });

  // Simultaneous: tap and pan can both fire — tap handles press, pan handles drag.
  const gesture = Gesture.Simultaneous(tapGesture, panGesture);

  // ─── Arc interpolations ───────────────────────────────────────────────────
  // Right half (0 → 50%): 180deg → 0deg
  const rightRot = progressAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['180deg', '0deg', '0deg'],
    extrapolate: 'clamp',
  });
  // Left half (50 → 100%): 180deg → 0deg
  const leftRot = progressAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['180deg', '180deg', '0deg'],
    extrapolate: 'clamp',
  });

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [D + 24, 0],
  });

  if ((!nowPlaying && !wasVisible.current) || isStoryViewerOpen) { return null; }

  return (
    <Animated.View
      style={[styles.container, { bottom: playerBottom, transform: [{ translateY }] }]}
      pointerEvents={nowPlaying ? 'box-none' : 'none'}
    >
      {/* Continuous bar — 50% width, centered; circle sits on top of it */}
      <View style={styles.bar} />

      {/* Draggable circle */}
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[styles.circleContainer, { transform: [{ translateX: circleX }, { translateY: circleY }, { scale: scaleAnim }] }]}
        >
          {/* Base: gray disc */}
          <View style={styles.grayDisc} />

          {/* Right half progress (0 → 50%) */}
          <View style={styles.rightClip}>
            <Animated.View
              style={[styles.halfWrapper, { transform: [{ rotate: rightRot }] }]}
            >
              <View style={styles.rightHalfDisc} />
            </Animated.View>
          </View>

          {/* Left half progress (50 → 100%) */}
          <View style={styles.leftClip}>
            <Animated.View
              style={[styles.halfWrapperLeft, { transform: [{ rotate: leftRot }] }]}
            >
              <View style={styles.leftHalfDisc} />
            </Animated.View>
          </View>

          {/* Inner disc — covers center so only the arc ring is visible */}
          <View style={styles.innerDisc}>
            {nowPlaying?.coverArtUrl ? (
              <Image
                source={{ uri: nowPlaying.coverArtUrl }}
                style={styles.albumArt}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.fallbackArt}>
                <View style={styles.fallbackBlobA} />
                <View style={styles.fallbackBlobB} />
              </View>
            )}
          </View>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Outer wrapper: transparent, 50% wide, centered.
  // bottom is set via inline style (playerBottom) so insets.bottom is included.
  container: {
    position: 'absolute',
    width: CONTAINER_W,
    height: D,
    left: (SCREEN_W - CONTAINER_W) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // The bar runs the full 50% width; the circle is layered on top of it
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: COLORS.border,
    borderRadius: 1,
  },

  // Circle sits centered on the bar and is moved by the gesture transform
  circleContainer: {
    width: D,
    height: D,
  },

  // ─── Arc layers ────────────────────────────────────────────────────────────
  grayDisc: {
    position: 'absolute',
    width: D,
    height: D,
    borderRadius: R,
    backgroundColor: COLORS.textMuted,
  },
  rightClip: {
    position: 'absolute',
    left: R,
    top: 0,
    width: R,
    height: D,
    overflow: 'hidden',
  },
  halfWrapper: {
    position: 'absolute',
    left: -R,
    top: 0,
    width: D,
    height: D,
  },
  rightHalfDisc: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: R,
    height: D,
    borderTopRightRadius: R,
    borderBottomRightRadius: R,
    backgroundColor: COLORS.purple,
  },
  leftClip: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: R,
    height: D,
    overflow: 'hidden',
  },
  halfWrapperLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: D,
    height: D,
  },
  leftHalfDisc: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: R,
    height: D,
    borderTopLeftRadius: R,
    borderBottomLeftRadius: R,
    backgroundColor: COLORS.purple,
  },
  innerDisc: {
    position: 'absolute',
    left: B,
    top: B,
    right: B,
    bottom: B,
    borderRadius: R - B,
    backgroundColor: COLORS.bg,
    overflow: 'hidden',
  },
  albumArt: {
    width: '100%',
    height: '100%',
  },
  fallbackArt: {
    flex: 1,
    backgroundColor: COLORS.card,
    overflow: 'hidden',
  },
  fallbackBlobA: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.purple,
    opacity: 0.5,
    top: -15,
    left: -10,
  },
  fallbackBlobB: {
    position: 'absolute',
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#EC4899',
    opacity: 0.4,
    bottom: -10,
    right: -8,
  },
});
