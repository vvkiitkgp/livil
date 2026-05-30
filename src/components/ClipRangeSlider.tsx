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

export type ClipRangeSliderProps = {
  duration: number;
  position: number;
  start: number;
  end: number;
  minClipSeconds?: number;
  maxClipSeconds?: number;
  /** When true, clip handles are shown in gray and are not draggable. */
  readOnly?: boolean;
  onChange?: (start: number, end: number) => void;
  /** `handle` tells the caller which grip was released ('left' = clip-start, 'right' = clip-end). */
  onChangeEnd?: (start: number, end: number, handle: 'left' | 'right') => void;
  /**
   * Called when the blue seek handle is released.
   * In readOnly mode seeking is clamped to [start, end].
   * In editable mode seeking is unconstrained ([0, duration]).
   */
  onSeekEnd?: (seconds: number) => void;
};

const THUMB_SIZE = 18;
const TRACK_H   = 6;
const HIT_SLOP  = 14;
// Thumb top relative to hitArea so it sits centred on the track line.
// hitArea padding-top = HIT_SLOP, track centre = HIT_SLOP + TRACK_H/2
// => thumb top = HIT_SLOP + TRACK_H/2 - THUMB_SIZE/2
const THUMB_TOP = HIT_SLOP + (TRACK_H - THUMB_SIZE) / 2; // 14 + (6-18)/2 = 8

type ActiveHandle = 'left' | 'right' | 'seek';

export default function ClipRangeSlider({
  duration,
  position,
  start,
  end,
  minClipSeconds = 1,
  maxClipSeconds,
  readOnly = false,
  onChange,
  onChangeEnd,
  onSeekEnd,
}: ClipRangeSliderProps) {
  const containerRef = useRef<View>(null);
  const [trackWidth, setTrackWidth] = useState(0);

  // Always-current refs so gesture callbacks never see stale values.
  const widthRef    = useRef(0);
  const pageXRef    = useRef(0);
  const durationRef = useRef(duration);   durationRef.current = duration;
  const startRef    = useRef(start);      startRef.current    = start;
  const endRef      = useRef(end);        endRef.current      = end;
  const positionRef = useRef(position);   positionRef.current = position;
  const minRef      = useRef(minClipSeconds);  minRef.current = minClipSeconds;
  const maxRef      = useRef(maxClipSeconds);  maxRef.current = maxClipSeconds;

  // Internal state for the seek handle while the user drags it.
  // Overrides the `position` prop so the visual updates instantly without
  // waiting for a parent re-render triggered by onSeekEnd.
  const [seekDragPos, setSeekDragPos] = useState<number | null>(null);
  const effectivePos = seekDragPos !== null ? seekDragPos : position;

  // ─── Layout ───────────────────────────────────────────────────────────────
  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    widthRef.current = w;
    setTrackWidth(w);
    // Refresh absolute x asynchronously — only needed before a gesture fires.
    requestAnimationFrame(() => {
      containerRef.current?.measureInWindow((x) => { pageXRef.current = x; });
    });
  }, []);

  const refreshMeasure = useCallback(() => {
    containerRef.current?.measureInWindow((x, _y, w) => {
      pageXRef.current = x;
      widthRef.current = w;
    });
  }, []);

  const secondsFromAbsX = useCallback((absX: number): number => {
    const w = widthRef.current;
    if (w <= 0) { return 0; }
    return (Math.max(0, Math.min(w, absX - pageXRef.current)) / w) *
      Math.max(0, durationRef.current);
  }, []);

  // ─── Clamp helpers ────────────────────────────────────────────────────────
  const clampLeft = useCallback((raw: number): number => {
    const dur = durationRef.current, curEnd = endRef.current;
    const min = minRef.current, max = maxRef.current;
    const lo = max !== undefined ? Math.max(0, curEnd - max) : 0;
    return Math.max(lo, Math.min(curEnd - min, Math.min(dur, raw)));
  }, []);

  const clampRight = useCallback((raw: number): number => {
    const dur = durationRef.current, curStart = startRef.current;
    const min = minRef.current, max = maxRef.current;
    const hi = max !== undefined ? Math.min(dur, curStart + max) : dur;
    return Math.min(hi, Math.max(curStart + min, raw));
  }, []);

  const clampSeek = useCallback((raw: number): number => {
    if (readOnly) {
      // PostCard: seek is limited to the clip window.
      return Math.max(startRef.current, Math.min(endRef.current, raw));
    }
    return Math.max(0, Math.min(durationRef.current, raw));
  }, [readOnly]);

  // ─── Gesture ──────────────────────────────────────────────────────────────
  const activeHandleRef = useRef<ActiveHandle | null>(null);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder:        () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder:         () => true,
        onMoveShouldSetPanResponderCapture:  () => true,
        onPanResponderTerminationRequest:    () => false,
        onShouldBlockNativeResponder:        () => true,

        onPanResponderGrant: (_e: GestureResponderEvent, g: PanResponderGestureState) => {
          refreshMeasure();
          const tapped = secondsFromAbsX(g.x0);
          const dur    = durationRef.current || 1;

          if (readOnly) {
            // Clip handles are decorative; every touch seeks the playback position.
            activeHandleRef.current = 'seek';
          } else {
            // Pick the nearest handle (left clip, right clip, or seek).
            // Use strict < so ties go to a clip handle, not the seek handle.
            const dSeek  = Math.abs(tapped - positionRef.current) / dur;
            const dLeft  = Math.abs(tapped - startRef.current)    / dur;
            const dRight = Math.abs(tapped - endRef.current)      / dur;

            if (dSeek < dLeft && dSeek < dRight) {
              activeHandleRef.current = 'seek';
            } else if (dLeft <= dRight) {
              activeHandleRef.current = 'left';
            } else {
              activeHandleRef.current = 'right';
            }
          }
        },

        onPanResponderMove: (_e: GestureResponderEvent, g: PanResponderGestureState) => {
          const raw = secondsFromAbsX(g.moveX !== 0 ? g.moveX : g.x0);
          if (activeHandleRef.current === 'seek') {
            setSeekDragPos(clampSeek(raw));
          } else if (activeHandleRef.current === 'left') {
            onChange?.(clampLeft(raw), endRef.current);
          } else if (activeHandleRef.current === 'right') {
            onChange?.(startRef.current, clampRight(raw));
          }
        },

        onPanResponderRelease: (_e: GestureResponderEvent, g: PanResponderGestureState) => {
          const raw = secondsFromAbsX(g.moveX !== 0 ? g.moveX : g.x0);
          if (activeHandleRef.current === 'seek') {
            const clamped = clampSeek(raw);
            setSeekDragPos(null);
            onSeekEnd?.(clamped);
          } else if (activeHandleRef.current === 'left') {
            onChangeEnd?.(clampLeft(raw), endRef.current, 'left');
          } else if (activeHandleRef.current === 'right') {
            onChangeEnd?.(startRef.current, clampRight(raw), 'right');
          }
          activeHandleRef.current = null;
        },

        onPanResponderTerminate: () => {
          setSeekDragPos(null);
          activeHandleRef.current = null;
        },
      }),
    // readOnly is included because onPanResponderGrant branches on it.
    [refreshMeasure, secondsFromAbsX, clampLeft, clampRight, clampSeek,
     onChange, onChangeEnd, onSeekEnd, readOnly],
  );

  // ─── Visual calculations ──────────────────────────────────────────────────
  const dur      = duration > 0 ? duration : 1;
  const leftFrac = Math.max(0, Math.min(1, start        / dur));
  const rightFrac= Math.max(0, Math.min(1, end          / dur));
  const posFrac  = Math.max(0, Math.min(1, effectivePos / dur));

  const leftPx  = trackWidth * leftFrac;
  const rightPx = trackWidth * rightFrac;
  const posPx   = trackWidth * posFrac;

  // Purple fill: clip_start → min(position, clip_end)
  const fillRight  = Math.max(leftPx, Math.min(posPx, rightPx));
  const progressW  = Math.max(0, fillRight - leftPx);
  const remainingW = Math.max(0, rightPx   - fillRight);

  // Clip handle pixel positions (clamped to stay within track bounds).
  const leftThumbLeft  = Math.max(0, Math.min(trackWidth - THUMB_SIZE, leftPx  - THUMB_SIZE / 2));
  const rightThumbLeft = Math.max(0, Math.min(trackWidth - THUMB_SIZE, rightPx - THUMB_SIZE / 2));

  // Seek handle sits at the right edge of the purple fill.
  const seekThumbLeft  = Math.max(0, Math.min(trackWidth - THUMB_SIZE, fillRight - THUMB_SIZE / 2));

  const clipThumbStyle  = readOnly ? styles.thumbReadOnly : styles.thumbActive;
  // Attach gesture when: clip handles are interactive OR seek handle is.
  const isInteractive   = !readOnly || onSeekEnd != null;

  return (
    <View
      ref={containerRef}
      style={styles.hitArea}
      onLayout={handleLayout}
      {...(isInteractive ? panResponder.panHandlers : {})}
    >
      {/* Track: overflow:hidden clips fills to the rounded shape */}
      <View style={styles.track}>
        {leftPx > 0 && (
          <View style={[styles.disabledZone, { left: 0, width: leftPx }]} />
        )}
        {progressW > 0 && (
          <View style={[styles.progressFill, { left: leftPx, width: progressW }]} />
        )}
        {remainingW > 0 && (
          <View style={[styles.remainingZone, { left: fillRight, width: remainingW }]} />
        )}
        {rightPx < trackWidth && (
          <View style={[styles.disabledZone, { left: rightPx, right: 0 }]} />
        )}
      </View>

      {/* Clip handles — rendered below seek handle in z-order */}
      <View style={[styles.thumb, clipThumbStyle, { left: leftThumbLeft  }]} />
      <View style={[styles.thumb, clipThumbStyle, { left: rightThumbLeft }]} />

      {/* Seek handle — rendered last so it sits on top of clip handles */}
      <View style={[styles.thumb, styles.thumbSeek, { left: seekThumbLeft }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  hitArea: {
    paddingVertical: HIT_SLOP,
    justifyContent: 'center',
  },
  track: {
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  disabledZone: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  progressFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: COLORS.purple,
  },
  remainingZone: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.88)',
  },
  // Thumbs: positioned relative to hitArea, centred on the track line.
  thumb: {
    position: 'absolute',
    top: THUMB_TOP,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
  },
  thumbActive: {
    backgroundColor: COLORS.white,
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.65,
    shadowRadius: 6,
    elevation: 5,
  },
  thumbReadOnly: {
    backgroundColor: 'rgba(130,130,155,0.75)',
  },
  // Seek handle: same primary colour as the progress fill, white ring for
  // visibility, higher elevation so it renders on top of clip handles.
  thumbSeek: {
    backgroundColor: COLORS.purple,
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.95)',
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 8,
  },
});
