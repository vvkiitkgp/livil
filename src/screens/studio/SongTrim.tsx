import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { COLORS } from '../../theme/colors';
import { formatClock } from './RecordPanel';
import { MAX_TRACK_SECONDS } from '../../../shared/constants/media';
import { clampRange, endDragTime, snapToStep, songEndAt, viewFor, type SongRange } from './timeline';

const HEIGHT = 26;
const GRIP = 22;

type Props = {
  /** Seconds the row spans — the same scale as the ruler and clip rows. */
  viewLen: number;
  /** The whole song, in whole bars. */
  full: number;
  /** The clips' own length in whole bars (0 with no voice): the song can't end before it without trimming one. */
  natural: number;
  /** The length the song's end was dragged out to, if it was. */
  length: number | undefined;
  /** The current trim (already clamped), or the whole song. */
  range: SongRange;
  bpm: number;
  onGesture: (active: boolean) => void;
  /** While the end is pulled past the row: the seconds every row must show to keep up. */
  onView: (viewLen: number) => void;
  /** The finger lifted: the new trim (null = the whole song) and the song's own length. */
  onCommit: (range: SongRange | null, length: number | undefined) => void;
};

type Edge = 'start' | 'end';
type Dragged = { range: SongRange; full: number; length: number | undefined };

/**
 * The whole song: drag the two grips in from the ends to choose the part that plays, loops and
 * gets posted, or pull the end grip OUT to make the song longer (the timeline zooms out to keep
 * up). Snaps to the drum grid, and a longer song to whole bars, so the loop stays on the beat.
 */
export function SongTrim({ viewLen, full, natural, length, range, bpm, onGesture, onView, onCommit }: Props) {
  const [w, setW] = useState(0);
  const [drag, setDrag] = useState<Dragged | null>(null);
  const pps = w > 0 ? w / viewLen : 1;
  /** The end grip, the song and the timeline's scale as they were when the finger went down. */
  const origin = useRef({ view: viewLen, full, x: 0 });

  const moved = (edge: Edge, dx: number): Dragged => {
    if (edge === 'start') {
      const t = snapToStep(range.start + dx / pps, bpm);
      return { range: clampRange({ start: t, end: range.end }, full, bpm), full, length };
    }
    const o = origin.current;
    return songEndAt(endDragTime(o.x + dx, Math.max(1, w), o.view, o.full), range.start, natural, bpm, MAX_TRACK_SECONDS);
  };
  const shown = drag?.range ?? range;
  const song = drag?.full ?? full;

  const pan = (edge: Edge) =>
    Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-4, 4])
      .failOffsetY([-14, 14])
      .onStart(() => {
        origin.current = { view: viewLen, full, x: range.end * pps };
        onGesture(true);
      })
      .onUpdate(e => {
        const d = moved(edge, e.translationX);
        setDrag(d);
        if (edge === 'end') onView(viewFor(d.range.end, origin.current.view, origin.current.full));
      })
      .onEnd(e => {
        const d = moved(edge, e.translationX);
        onCommit(d.range.start <= 1e-3 && d.range.end >= d.full - 1e-3 ? null : d.range, d.length);
      })
      .onFinalize(() => { setDrag(null); onGesture(false); });

  const left = shown.start * pps;
  const right = shown.end * pps;
  const trimmed = shown.start > 1e-3 || shown.end < song - 1e-3;
  const label = drag || trimmed
    ? `${formatClock(shown.start, true)} – ${formatClock(shown.end, true)} · ${formatClock(shown.end - shown.start, true)}`
    : 'Drag the ends to trim, or pull the end out to go longer';

  return (
    <View style={styles.root} onLayout={e => setW(Math.floor(e.nativeEvent.layout.width))}>
      <View style={[styles.song, { width: Math.min(w, song * pps) }]} />
      <View style={[styles.kept, { left, width: Math.max(2, right - left) }]}>
        <Text style={[styles.label, !drag && !trimmed && styles.labelIdle]} numberOfLines={1}>{label}</Text>
      </View>
      <GestureDetector gesture={pan('start')}>
        <View style={[styles.grip, { left: left - GRIP / 2 }]} accessibilityLabel="Trim the start of the song" hitSlop={{ top: 8, bottom: 8 }}>
          <View style={styles.bar} />
        </View>
      </GestureDetector>
      <GestureDetector gesture={pan('end')}>
        <View style={[styles.grip, { left: right - GRIP / 2 }]} accessibilityLabel="Trim the end of the song, or pull it out to make the song longer" hitSlop={{ top: 8, bottom: 8 }}>
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
