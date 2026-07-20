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
import { Icon } from './Icon';

export type ClipRangeSliderProps = {
  duration: number;
  position: number;
  start: number;
  end: number;
  minClipSeconds?: number;
  maxClipSeconds?: number;
  /**
   * When true, dragging the left (clip-start) handle shifts the whole window
   * instead of shrinking it — the right handle slides along by the same delta,
   * preserving the current window size. Useful for story reposts where the
   * window is fixed at the max clip length and the user wants to *position*
   * the window rather than resize it.
   */
  slideWindowOnLeftDrag?: boolean;
  /** When true, clip handles are shown in gray and are not draggable. */
  readOnly?: boolean;
  /**
   * When true, the purple progress fill and the seek thumb are not rendered —
   * only the clip start/end markers (and the disabled zones outside them)
   * remain. Implies the seek pan-responder is disabled.
   */
  hideProgress?: boolean;
  /**
   * Horizontal inset (px) applied to BOTH ends of the track, shrinking the bar
   * inward from its container. Use on editable sliders so the clip handles at
   * 0:00 / full-end don't sit in Android's left/right edge back-gesture zone
   * (which would steal the drag). Default 0 (e.g. read-only seek bars).
   */
  edgeInset?: number;
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

const CLIP_ICON_SIZE = 22;
// The CaretLine icons have ~60/256 of transparent padding before the vertical
// line. Shift each clip handle outward by that inset so the LINE (the boundary
// marker) lands exactly on the clip point instead of the icon's box edge.
const CARET_INSET = Math.round((60 / 256) * CLIP_ICON_SIZE); // ≈ 5px

type ActiveHandle = 'left' | 'right' | 'seek';

export default function ClipRangeSlider({
  duration,
  position,
  start,
  end,
  minClipSeconds = 1,
  maxClipSeconds,
  slideWindowOnLeftDrag = false,
  readOnly = false,
  hideProgress = false,
  edgeInset = 0,
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
  const slideRef    = useRef(slideWindowOnLeftDrag);
  slideRef.current  = slideWindowOnLeftDrag;
  // Window size captured at gesture start — kept constant while sliding so the
  // window doesn't grow / shrink as the user drags the left handle.
  const grabWindowRef = useRef(0);

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

  // Shift the entire clip window so its left edge lands at `raw`, preserving
  // the window size captured at gesture start. Used in slideWindowOnLeftDrag
  // mode so the user can position a fixed-length clip anywhere on the track.
  const slideWindow = useCallback((raw: number): [number, number] => {
    const dur = durationRef.current;
    const win = grabWindowRef.current;
    const newStart = Math.max(0, Math.min(dur - win, raw));
    return [newStart, newStart + win];
  }, []);

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
          // Lock the window size at grab time so left-slide mode preserves it.
          grabWindowRef.current = endRef.current - startRef.current;
        },

        onPanResponderMove: (_e: GestureResponderEvent, g: PanResponderGestureState) => {
          const raw = secondsFromAbsX(g.moveX !== 0 ? g.moveX : g.x0);
          if (activeHandleRef.current === 'seek') {
            setSeekDragPos(clampSeek(raw));
          } else if (activeHandleRef.current === 'left') {
            if (slideRef.current) {
              const [s, e] = slideWindow(raw);
              onChange?.(s, e);
            } else {
              onChange?.(clampLeft(raw), endRef.current);
            }
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
            if (slideRef.current) {
              const [s, e] = slideWindow(raw);
              onChangeEnd?.(s, e, 'left');
            } else {
              onChangeEnd?.(clampLeft(raw), endRef.current, 'left');
            }
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
     slideWindow, onChange, onChangeEnd, onSeekEnd, readOnly],
  );

  // ─── Visual calculations ──────────────────────────────────────────────────
  const dur      = duration > 0 ? duration : 1;
  const leftFrac = Math.max(0, Math.min(1, start        / dur));
  const rightFrac= Math.max(0, Math.min(1, end          / dur));
  const posFrac  = Math.max(0, Math.min(1, effectivePos / dur));

  const leftPx  = trackWidth * leftFrac;
  const rightPx = trackWidth * rightFrac;
  const posPx   = trackWidth * posFrac;

  // Purple fill: clip_start → min(position, clip_end). When hideProgress is
  // set, collapse the fill so the entire clip window renders as remainingZone
  // and the seek thumb is not drawn.
  const fillRight  = hideProgress ? leftPx : Math.max(leftPx, Math.min(posPx, rightPx));
  const progressW  = Math.max(0, fillRight - leftPx);
  const remainingW = Math.max(0, rightPx   - fillRight);

  // Clip handle pixel positions. The indication point is the icon's INNER edge,
  // not its centre: clip-start sits to the LEFT of the start line (its right edge
  // on the line); clip-end sits to the RIGHT of the end line (its left edge on
  // the line) — so the carets frame the clip window without covering it.
  const leftThumbLeft  = Math.max(-THUMB_SIZE, Math.min(trackWidth, leftPx  - THUMB_SIZE + CARET_INSET));
  const rightThumbLeft = Math.max(0, Math.min(trackWidth, rightPx - CARET_INSET));

  // Seek handle sits at the right edge of the purple fill.
  const seekThumbLeft  = Math.max(0, Math.min(trackWidth - THUMB_SIZE, fillRight - THUMB_SIZE / 2));

  // Clip handles are bare grip icons (no circle): white when editable, gray
  // when read-only/decorative.
  const clipGripColor   = readOnly ? 'rgba(150,150,175,0.95)' : COLORS.white;
  // Attach gesture when: clip handles are interactive OR seek handle is.
  // hideProgress callers want a static view, so disable seek too.
  const isInteractive   = !readOnly || (onSeekEnd != null && !hideProgress);

  return (
    <View
      ref={containerRef}
      style={[styles.hitArea, edgeInset ? { marginHorizontal: edgeInset } : null]}
      onLayout={handleLayout}
      {...(isInteractive ? panResponder.panHandlers : {})}
    >
      {/* Track: overflow:hidden clips fills to the rounded shape */}
      <View style={styles.track}>
        {leftPx > 0 && (
          <View style={[styles.disabledZone, { left: 0, width: leftPx }]} />
        )}
        {progressW > 0 && (
          <View style={[styles.progressFill, { left: leftPx, width: progressW }]}>
            {/* offsetX keeps the gradient pinned to the track — this fill starts
                at the clip start, not at zero. */}
            <GradientFill width={trackWidth} height={TRACK_H} offsetX={leftPx} />
          </View>
        )}
        {remainingW > 0 && (
          <View style={[styles.remainingZone, { left: fillRight, width: remainingW }]} />
        )}
        {rightPx < trackWidth && (
          <View style={[styles.disabledZone, { left: rightPx, right: 0 }]} />
        )}
      </View>

      {/* Clip handles — bare boundary carets (no circle). Each is anchored by its
          inner edge: start hugs its right edge, end hugs its left edge. */}
      <View style={[styles.thumb, styles.thumbAlignEnd, { left: leftThumbLeft  }]}>
        <Icon name="clipStart" size={CLIP_ICON_SIZE} color={clipGripColor} />
      </View>
      <View style={[styles.thumb, styles.thumbAlignStart, { left: rightThumbLeft }]}>
        <Icon name="clipEnd" size={CLIP_ICON_SIZE} color={clipGripColor} />
      </View>

      {/* Seek handle — rendered last so it sits on top of clip handles */}
      {hideProgress ? null : (
        <View style={[styles.thumb, styles.thumbSeek, { left: seekThumbLeft }]} />
      )}
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
    overflow: 'hidden',
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Clip carets are anchored by their inner edge (icon overflows the container):
  // start hugs the right edge, end hugs the left edge.
  thumbAlignEnd:   { alignItems: 'flex-end' },
  thumbAlignStart: { alignItems: 'flex-start' },
  // Seek handle: same primary colour as the progress fill, white ring for
  // visibility, higher elevation so it renders on top of clip handles.
  thumbSeek: {
    backgroundColor: COLORS.purpleNeon,
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.95)',
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 8,
  },
});
