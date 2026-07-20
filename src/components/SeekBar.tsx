import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  PanResponder,
  type LayoutChangeEvent,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';
import { COLORS } from '../theme/colors';
import { GradientFill } from './GradientFill';

export type SeekBarProps = {
  /** Current playback position in seconds. Ignored while the user is actively dragging. */
  position: number;
  /** Total duration in seconds. */
  duration: number;
  /** Called continuously while the user drags. Use this only to mirror the thumb in the UI;
   *  do not actually seek the player on every tick or you'll thrash the native side. */
  onSeek?: (seconds: number) => void;
  /** Called when the user lifts their finger. This is the right moment to seek the player. */
  onSeekEnd?: (seconds: number) => void;
  /** Called when the user first touches the bar. */
  onSeekStart?: () => void;
};

/**
 * Custom scrubber. Uses PanResponder so we can claim the gesture inside a
 * vertical FlatList without fighting the parent scroll.
 *
 * Coordinate strategy: we use `gestureState.x0` (touch start, absolute screen
 * X) and `gestureState.moveX` (current screen X) and subtract the view's
 * measured pageX. This is more reliable than `nativeEvent.locationX`, which on
 * Android can return stale or zero values during move/release — particularly
 * with emulator mouse input.
 */
export default function SeekBar({
  position,
  duration,
  onSeek,
  onSeekEnd,
  onSeekStart,
}: SeekBarProps) {
  const containerRef = useRef<View>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [draggingValue, setDraggingValue] = useState<number | null>(null);

  // Stable refs so the PanResponder closures (created once via useMemo)
  // always read the latest values without rebuilding the responder.
  const widthRef = useRef(0);
  const pageXRef = useRef(0);
  const durationRef = useRef(duration);
  durationRef.current = duration;

  const measure = useCallback(() => {
    containerRef.current?.measureInWindow((x, _y, w) => {
      pageXRef.current = x;
      widthRef.current = w;
      setTrackWidth(w);
    });
  }, []);

  const handleLayout = useCallback(
    (_event: LayoutChangeEvent) => {
      // Defer one frame so the view is fully laid out in the window before
      // measureInWindow — otherwise pageX can be 0 on Android the first time.
      requestAnimationFrame(measure);
    },
    [measure],
  );

  const valueFromAbsoluteX = useCallback((absoluteX: number): number => {
    const w = widthRef.current;
    if (w <= 0) {return 0;}
    const localX = absoluteX - pageXRef.current;
    const clamped = Math.max(0, Math.min(w, localX));
    const fraction = clamped / w;
    const total = Math.max(0, durationRef.current);
    return fraction * total;
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Capture taps and drags before any parent (FlatList scroll) can claim them.
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: (_e: GestureResponderEvent, g: PanResponderGestureState) => {
          // Re-measure on each grant in case the view has moved (e.g. parent
          // scrolled since layout). measureInWindow is cheap.
          measure();
          onSeekStart?.();
          const next = valueFromAbsoluteX(g.x0);
          setDraggingValue(next);
          onSeek?.(next);
        },
        onPanResponderMove: (_e: GestureResponderEvent, g: PanResponderGestureState) => {
          const next = valueFromAbsoluteX(g.moveX);
          setDraggingValue(next);
          onSeek?.(next);
        },
        onPanResponderRelease: (_e: GestureResponderEvent, g: PanResponderGestureState) => {
          // For a pure tap, moveX is 0 (no movement); fall back to x0 in that case.
          const absX = g.moveX !== 0 ? g.moveX : g.x0;
          const next = valueFromAbsoluteX(absX);
          setDraggingValue(null);
          onSeekEnd?.(next);
        },
        onPanResponderTerminate: () => {
          setDraggingValue(null);
        },
      }),
    [measure, onSeek, onSeekEnd, onSeekStart, valueFromAbsoluteX],
  );

  const effective = draggingValue ?? position;
  const fraction = duration > 0 ? Math.max(0, Math.min(1, effective / duration)) : 0;
  const fillWidth = trackWidth * fraction;
  // Thumb is 14 px wide; offset so its center sits at the fraction position.
  const thumbLeft = Math.max(0, Math.min(trackWidth - 14, fillWidth - 7));

  return (
    <View ref={containerRef} style={styles.hitArea} onLayout={handleLayout} {...panResponder.panHandlers}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: fillWidth }]}>
          {/* Full track width, revealed by the fill's animated width — keeps the
              gradient pinned to the track instead of stretching as it plays. */}
          <GradientFill width={trackWidth} height={4} borderRadius={2} />
        </View>
        <View style={[styles.thumb, { left: thumbLeft }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Generous vertical hit area so the thin bar is easy to grab.
  hitArea: {
    paddingVertical: 12,
    justifyContent: 'center',
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.12)',
    position: 'relative',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 2,
    overflow: 'hidden',
  },
  thumb: {
    position: 'absolute',
    top: -5,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: COLORS.white,
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
    elevation: 4,
  },
});
