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

// Tab bar heights (must stay above these)
const TAB_BAR_H = Platform.OS === 'ios' ? 84 : 64;
// Position: 20% from bottom, but never closer than 10px above the tab bar
const PLAYER_BOTTOM = Math.max(SCREEN_H * 0.10, TAB_BAR_H + 10);

// Gesture thresholds
const SNAP_VELOCITY = 400;  // px/s — qualifies as a "snap" gesture
const SNAP_DISTANCE = 40;   // px  — qualifies as a "snap" gesture

// Playback rates while dragging
const RATE_FORWARD = 2.0;
const RATE_REVERSE = -1.0;  // negative = reverse (iOS AVPlayer; Android clamps to 0)

export const FLOATING_PLAYER_HEIGHT = D;

export default function FloatingPlayer() {
  const {
    nowPlaying,
    activePostId,
    positionRef,
    durationRef,
    handlersRef,
    playNext,
    playPrev,
  } = usePlayback();

  // ─── Animations ─────────────────────────────────────────────────────────────
  const slideAnim   = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  // Horizontal offset of the draggable circle (0 = centered)
  const circleX = useRef(new Animated.Value(0)).current;

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

  // ─── Helper: spring circle back to center ──────────────────────────────────
  const springBack = () => {
    Animated.spring(circleX, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 10,
      speed: 14,
    }).start();
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

  // Tap: Simultaneous (not Race) so it never times out the pan mid-hold.
  const tapGesture = Gesture.Tap()
    .runOnJS(true)
    .onEnd((_e, success) => {
      if (!success) { return; }
      if (activePostId) { handlersRef.current?.pause(); }
      else { handlersRef.current?.play(); }
    });

  const panGesture = Gesture.Pan()
    .runOnJS(true)
    .onStart(() => {
      // Stop any running spring so it doesn't fight the finger on a new drag.
      circleX.stopAnimation();
      stopRewind();
    })
    .onUpdate((e) => {
      // Circle physically follows the finger within bar bounds.
      const clamped = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, e.translationX));
      circleX.setValue(clamped);

      if (e.translationX >= 0) {
        stopRewind();
        handlersRef.current?.setRate(RATE_FORWARD);        // 2× forward
      } else {
        handlersRef.current?.setRate(1.0);                 // normal speed while seeking back
        if (rewindTimer.current === null) { startRewind(); }
      }
    })
    .onEnd((e) => {
      stopRewind();
      handlersRef.current?.setRate(1.0);
      springBack();

      // Snap = quick flick only (velocity). Slow hold-and-release must never
      // trigger next/prev even if the circle travelled far.
      const isSnap = Math.abs(e.velocityX) > SNAP_VELOCITY;
      if (isSnap) {
        if (e.velocityX > 0) { playNext(); }
        else { playPrev(); }
      }
      // Non-snap: rate already reset; music resumes at 1×.
    })
    .onFinalize(() => {
      // Fires after onEnd AND on external cancellation.
      stopRewind();
      handlersRef.current?.setRate(1.0);
      springBack();
    });

  // Simultaneous lets tap fire for pure taps while pan handles drags,
  // without either cancelling the other mid-gesture.
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

  if (!nowPlaying && !wasVisible.current) { return null; }

  return (
    <Animated.View
      style={[styles.container, { transform: [{ translateY }] }]}
      pointerEvents={nowPlaying ? 'box-none' : 'none'}
    >
      {/* Continuous bar — 50% width, centered; circle sits on top of it */}
      <View style={styles.bar} />

      {/* Draggable circle */}
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[styles.circleContainer, { transform: [{ translateX: circleX }] }]}
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
  // Outer wrapper: transparent, 50% wide, centered, sitting at thumb-reach height
  container: {
    position: 'absolute',
    width: CONTAINER_W,
    height: D,
    left: (SCREEN_W - CONTAINER_W) / 2,
    bottom: PLAYER_BOTTOM,
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
