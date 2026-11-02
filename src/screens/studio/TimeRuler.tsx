import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { COLORS } from '../../theme/colors';

const HEIGHT = 30;
const KNOB = 14;

type Props = {
  /** Seconds the ruler spans — the same scale as the clip rows under it. */
  viewLen: number;
  /** The song's length; the playhead can't go past it. */
  length: number;
  barSec: number;
  playhead: number;
  /** Every move of the finger (to draw the playhead there). */
  onScrub: (sec: number) => void;
  /** The finger lifted — jump playback here. */
  onScrubEnd: (sec: number) => void;
};

/** Bar numbers over the clip rows, with a playhead you drag (or tap) to jump through the song. */
export function TimeRuler({ viewLen, length, barSec, playhead, onScrub, onScrubEnd }: Props) {
  const [w, setW] = useState(0);
  const pps = w > 0 ? w / viewLen : 1;
  const last = useRef(0);
  const toSec = (x: number) => Math.min(Math.max(0, length - 0.05), Math.max(0, x / pps));

  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin(e => { last.current = toSec(e.x); onScrub(last.current); })
    .onUpdate(e => { last.current = toSec(e.x); onScrub(last.current); })
    .onFinalize(() => onScrubEnd(last.current));

  const bars: number[] = [];
  for (let b = 0, i = 0; b < viewLen - 1e-6; b += barSec, i++) bars.push(i);
  const step = Math.max(1, Math.ceil(bars.length / 8));

  return (
    <GestureDetector gesture={pan}>
      <View
        style={styles.root}
        onLayout={e => setW(Math.floor(e.nativeEvent.layout.width))}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Playhead. Drag to move through the song."
      >
        <View style={[styles.song, { width: Math.min(w, length * pps) }]} />
        {bars.map(i => (
          <View key={i} style={[styles.tick, { left: i * barSec * pps }]}>
            {i % step === 0 && <Text style={styles.num}>{i + 1}</Text>}
          </View>
        ))}
        <View pointerEvents="none" style={[styles.head, { left: playhead * pps - KNOB / 2 }]}>
          <View style={styles.knob} />
          <View style={styles.stem} />
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { height: HEIGHT, justifyContent: 'flex-end' },
  song: { position: 'absolute', left: 0, bottom: 0, height: 4, borderRadius: 2, backgroundColor: COLORS.purpleDim },
  tick: { position: 'absolute', bottom: 0, height: 10, width: 1, backgroundColor: COLORS.border },
  num: { position: 'absolute', bottom: 10, left: 3, color: COLORS.textMuted, fontSize: 10, fontWeight: '600', width: 24 },
  head: { position: 'absolute', top: 0, bottom: -1, width: KNOB, alignItems: 'center' },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: COLORS.white },
  stem: { flex: 1, width: 2, backgroundColor: COLORS.white },
});
