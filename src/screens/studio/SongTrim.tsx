import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { COLORS } from '../../theme/colors';
import { formatClock } from './RecordPanel';
import { clampRange, snapToStep, type SongRange } from './timeline';

const HEIGHT = 26;
const GRIP = 22;

type Props = {
  /** Seconds the row spans — the same scale as the ruler and clip rows. */
  viewLen: number;
  /** The whole song (every clip, rounded to bars). */
  full: number;
  /** The current trim (already clamped), or the whole song. */
  range: SongRange;
  bpm: number;
  onGesture: (active: boolean) => void;
  /** The finger lifted: the new trim, or null when it covers the whole song again. */
  onCommit: (range: SongRange | null) => void;
};

/**
 * The whole-song trim: drag the two grips in from the ends to choose the part that plays,
 * loops and gets posted. Snaps to the drum grid so the loop stays on the beat.
 */
export function SongTrim({ viewLen, full, range, bpm, onGesture, onCommit }: Props) {
  const [w, setW] = useState(0);
  const [drag, setDrag] = useState<{ edge: 'start' | 'end'; dx: number } | null>(null);
  const pps = w > 0 ? w / viewLen : 1;

  const moved = (edge: 'start' | 'end', dx: number): SongRange => {
    const t = snapToStep((edge === 'start' ? range.start : range.end) + dx / pps, bpm);
    return clampRange(edge === 'start' ? { start: t, end: range.end } : { start: range.start, end: t }, full, bpm);
  };
  const shown = drag ? moved(drag.edge, drag.dx) : range;

  const pan = (edge: 'start' | 'end') =>
    Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-4, 4])
      .failOffsetY([-14, 14])
      .onStart(() => onGesture(true))
      .onUpdate(e => setDrag({ edge, dx: e.translationX }))
      .onEnd(e => {
        const r = moved(edge, e.translationX);
        onCommit(r.start <= 1e-3 && r.end >= full - 1e-3 ? null : r);
      })
      .onFinalize(() => { setDrag(null); onGesture(false); });

  const left = shown.start * pps;
  const right = shown.end * pps;
  const trimmed = shown.start > 1e-3 || shown.end < full - 1e-3;
  const label = drag || trimmed
    ? `${formatClock(shown.start, true)} – ${formatClock(shown.end, true)} · ${formatClock(shown.end - shown.start, true)}`
    : 'Drag the ends to trim the song';

  return (
    <View style={styles.root} onLayout={e => setW(Math.floor(e.nativeEvent.layout.width))}>
      <View style={[styles.song, { width: Math.min(w, full * pps) }]} />
      <View style={[styles.kept, { left, width: Math.max(2, right - left) }]}>
        <Text style={[styles.label, !drag && !trimmed && styles.labelIdle]} numberOfLines={1}>{label}</Text>
      </View>
      <GestureDetector gesture={pan('start')}>
        <View style={[styles.grip, { left: left - GRIP / 2 }]} accessibilityLabel="Trim the start of the song" hitSlop={{ top: 8, bottom: 8 }}>
          <View style={styles.bar} />
        </View>
      </GestureDetector>
      <GestureDetector gesture={pan('end')}>
        <View style={[styles.grip, { left: right - GRIP / 2 }]} accessibilityLabel="Trim the end of the song" hitSlop={{ top: 8, bottom: 8 }}>
          <View style={styles.bar} />
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { height: HEIGHT, justifyContent: 'center' },
  song: { position: 'absolute', left: 0, top: 4, bottom: 4, borderRadius: 6, backgroundColor: COLORS.surface },
  kept: {
    position: 'absolute', top: 4, bottom: 4, borderRadius: 6, borderWidth: 1.5, borderColor: COLORS.purple,
    backgroundColor: COLORS.purpleDim, justifyContent: 'center', paddingHorizontal: 12, overflow: 'hidden',
  },
  label: { color: COLORS.white, fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
  labelIdle: { color: COLORS.textSecondary, fontWeight: '600' },
  grip: { position: 'absolute', top: 0, bottom: 0, width: GRIP, alignItems: 'center', justifyContent: 'center' },
  bar: { width: 4, height: 18, borderRadius: 2, backgroundColor: COLORS.purpleLight },
});
