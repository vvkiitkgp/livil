import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { COLORS } from '../../theme/colors';
import { formatClock } from './RecordPanel';
import { clipLength, type VoiceLane } from './studioEngine';

/**
 * A clip's place on the timeline — NO audio. React 19 dev builds diff a component's changed
 * props for DevTools and walk every element of any array within three levels (props.lane.take.raw):
 * a new take's 3.3M samples became gigabytes of strings and iOS killed the app (2026-11-02).
 * Audio stays out of props; this row gets its geometry, length and a small peak summary.
 */
export type Clip = Pick<VoiceLane, 'name' | 'start' | 'trimStart' | 'trimEnd' | 'loops'>;
import type { SongRange } from './timeline';

const HEIGHT = 56;
/** The trim grip you see at each end of a clip. */
const GRIP_W = 6;
const GRIP_H = 32;
/**
 * The strip that takes the touch is far wider than the grip: this much outside the clip and
 * this much into it. An 18dp strip centred on the edge was hard to catch, and at the row's
 * left edge half of it (and of the grip) was cut off.
 */
const HANDLE_OUT = 14;
const HANDLE_IN = 26;
const MIN_CLIP = 0.1;
/** One waveform bar every this many dp, on a grid fixed to the take (so trimming never reshuffles it). */
const COL = 3;
/** Inside height of a clip box (row minus its 4dp insets and 1dp border). */
const CLIP_INNER = HEIGHT - 10;

const peakCache = new WeakMap<Float32Array, Float32Array>();
/** ~100 peaks per second of take, computed once per take. */
export function peaksOf(samples: Float32Array, sampleRate: number): Float32Array {
  const hit = peakCache.get(samples);
  if (hit) return hit;
  const per = Math.max(1, Math.floor(sampleRate / 100));
  const out = new Float32Array(Math.ceil(samples.length / per));
  let max = 1e-6;
  for (let i = 0; i < out.length; i++) {
    let m = 0;
    const end = Math.min(samples.length, (i + 1) * per);
    for (let j = i * per; j < end; j++) { const a = Math.abs(samples[j]); if (a > m) m = a; }
    out[i] = m;
    if (m > max) max = m;
  }
  for (let i = 0; i < out.length; i++) out[i] /= max;
  peakCache.set(samples, out);
  return out;
}

type Kind = 'move' | 'left' | 'right';

type Props = {
  clip: Clip;
  /** The whole take's length, seconds (the most a trim can open up to). */
  takeLen: number;
  /** `peaksOf` the take — ~100 per second, small enough to pass around. */
  peaks: Float32Array;
  viewLen: number;
  bpm: number;
  barSec: number;
  playhead: number;
  /** The song trim: the parts outside it are dimmed. */
  range: SongRange;
  onGesture: (active: boolean) => void;
  onCommit: (clip: Clip) => void;
  onSeek: (sec: number) => void;
};

/** Applies a drag of `d` seconds to the clip, keeping it inside the take and the timeline. */
export function dragClip<C extends Clip>(lane: C, takeLen: number, kind: Kind, d: number): C {
  if (kind === 'move') return { ...lane, start: Math.max(0, lane.start + d) };
  if (kind === 'left') {
    const lo = Math.max(-lane.trimStart, -lane.start);
    const hi = lane.trimEnd - MIN_CLIP - lane.trimStart;
    const dd = Math.min(hi, Math.max(lo, d));
    return { ...lane, start: lane.start + dd, trimStart: lane.trimStart + dd };
  }
  const trimEnd = Math.min(takeLen, Math.max(lane.trimStart + MIN_CLIP, lane.trimEnd + d));
  return { ...lane, trimEnd };
}

/** One voice's timeline row: drag the clip to move it, drag its edges to trim. */
export function ClipTrack({ clip: lane, takeLen, peaks, viewLen, bpm, barSec, playhead, range, onGesture, onCommit, onSeek }: Props) {
  const [w, setW] = useState(0);
  const [drag, setDrag] = useState<{ kind: Kind; dx: number } | null>(null);
  const pps = w > 0 ? w / viewLen : 1;
  const stepSec = 60 / bpm / 4;
  const snap = (sec: number) => Math.round(sec / stepSec) * stepSec;

  // The preview snaps exactly like the commit, so what you see when you let go is where it lands.
  const shown = drag ? dragClip(lane, takeLen, drag.kind, snap(drag.dx / pps)) : lane;
  const len = clipLength(shown);

  const pan = (kind: Kind) =>
    Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-6, 6])
      .failOffsetY([-14, 14])
      .onStart(() => onGesture(true))
      .onUpdate(e => setDrag({ kind, dx: e.translationX }))
      .onEnd(e => onCommit(dragClip(lane, takeLen, kind, snap(e.translationX / pps))))
      .onFinalize(() => { setDrag(null); onGesture(false); });

  // A tap anywhere on the row (clip included) moves the playhead; a drag on the clip wins over it.
  const tap = Gesture.Tap().runOnJS(true).maxDistance(8).onEnd(e => onSeek(Math.max(0, e.x / pps)));

  const bars: number[] = [];
  for (let b = 0; b <= viewLen; b += barSec) bars.push(b);

  // Waveform bars sit at fixed points of the TAKE, not of the clip: trimming an edge only
  // covers or uncovers bars, it never squeezes or shifts the ones you are lining up against.
  const segW = len * pps;
  // The handles never take more than a third of the clip each, so a short one can still be moved.
  const inner = Math.min(HANDLE_IN, segW / 3);
  const startX = shown.start * pps;
  const endX = (shown.start + len) * pps;
  // Drawn on the edge, but kept whole when the edge is the row's own.
  const gripLeft = (x: number) => Math.min(Math.max(0, w - GRIP_W), Math.max(0, x - GRIP_W / 2));
  const colSec = COL / pps;
  const offsetPx = shown.trimStart * pps;
  const wave: { x: number; p: number }[] = [];
  for (let c = Math.floor(shown.trimStart / colSec); c * colSec < shown.trimEnd; c++) {
    const t = c * colSec;
    wave.push({ x: c * COL - offsetPx, p: peaks[Math.min(peaks.length - 1, Math.floor(t * 100))] ?? 0 });
  }
  const edge = drag && drag.kind !== 'move'
    ? { left: (drag.kind === 'left' ? shown.start : shown.start + len) * pps, label: `${drag.kind === 'left' ? 'Start' : 'End'} ${formatClock(drag.kind === 'left' ? shown.start : shown.start + len, true)} · ${formatClock(len, true)} long` }
    : null;

  return (
    <GestureDetector gesture={tap}>
    <View style={styles.root} onLayout={e => setW(Math.floor(e.nativeEvent.layout.width))}>
      {bars.map(b => <View key={b} pointerEvents="none" style={[styles.barLine, { left: b * pps }]} />)}

      {Array.from({ length: shown.loops }, (_, rep) => (
        <View
          key={rep}
          pointerEvents="none"
          style={[styles.clip, rep > 0 && styles.clipLoop, { left: (shown.start + rep * len) * pps, width: Math.max(4, segW - 1) }]}
        >
          {wave.map(b => {
            const h = 4 + b.p * (HEIGHT - 18);
            return <View key={b.x} style={[styles.waveBar, { left: b.x, top: (CLIP_INNER - h) / 2, height: h }]} />;
          })}
        </View>
      ))}

      <GestureDetector gesture={pan('move')}>
        <View
          style={[styles.hit, { left: startX + inner, width: Math.max(8, segW * shown.loops - inner - (shown.loops > 1 ? 0 : inner)) }]}
          accessibilityLabel={`${lane.name} clip. Drag to move.`}
        />
      </GestureDetector>
      <GestureDetector gesture={pan('left')}>
        <View style={[styles.handle, { left: startX - HANDLE_OUT, width: HANDLE_OUT + inner }]} accessibilityLabel="Trim the start" />
      </GestureDetector>
      <GestureDetector gesture={pan('right')}>
        <View style={[styles.handle, { left: endX - inner, width: HANDLE_OUT + inner }]} accessibilityLabel="Trim the end" />
      </GestureDetector>
      <View pointerEvents="none" style={[styles.grip, { left: gripLeft(startX) }]} />
      <View pointerEvents="none" style={[styles.grip, { left: gripLeft(endX) }]} />

      <View pointerEvents="none" style={[styles.cut, { left: 0, width: Math.max(0, range.start * pps) }]} />
      <View pointerEvents="none" style={[styles.cut, { left: range.end * pps, right: 0 }]} />
      {edge && (
        <>
          <View pointerEvents="none" style={[styles.edgeLine, { left: edge.left - 1 }]} />
          <View pointerEvents="none" style={[styles.edgeTag, edge.left > w / 2 ? { right: w - edge.left + 6 } : { left: edge.left + 6 }]}>
            <Text style={styles.edgeText}>{edge.label}</Text>
          </View>
        </>
      )}
      <View pointerEvents="none" style={[styles.playhead, { left: playhead * pps }]} />
    </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { height: HEIGHT, borderRadius: 10, backgroundColor: COLORS.bg, overflow: 'hidden' },
  barLine: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: COLORS.border },
  clip: {
    position: 'absolute', top: 4, bottom: 4, borderRadius: 8, backgroundColor: 'rgba(139, 61, 255, 0.22)',
    borderWidth: 1, borderColor: COLORS.purple, justifyContent: 'center', overflow: 'hidden',
  },
  clipLoop: { backgroundColor: 'rgba(139, 61, 255, 0.10)', borderStyle: 'dashed' },
  waveBar: { position: 'absolute', width: 2, borderRadius: 1, backgroundColor: COLORS.purpleNeon },
  hit: { position: 'absolute', top: 0, bottom: 0 },
  handle: { position: 'absolute', top: 0, bottom: 0 },
  grip: { position: 'absolute', top: (HEIGHT - GRIP_H) / 2, width: GRIP_W, height: GRIP_H, borderRadius: GRIP_W / 2, backgroundColor: COLORS.purpleLight },
  cut: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(10, 10, 15, 0.65)' },
  edgeLine: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: COLORS.purpleLight },
  edgeTag: { position: 'absolute', top: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: COLORS.bg },
  edgeText: { color: COLORS.white, fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: COLORS.white },
});
