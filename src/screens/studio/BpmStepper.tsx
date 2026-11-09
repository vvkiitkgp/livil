import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../components/Icon';
import { COLORS } from '../../theme/colors';
import { haptics } from '../../utils/haptics';

export const MIN_BPM = 60;
export const MAX_BPM = 180;
/** Hold this long before repeating starts, then repeat this often, speeding up the longer you hold. */
const HOLD_MS = 380;
const REPEAT_MS = 110;
const FASTEST_MS = 40;
/** With `settle`: the tempo is handed over this long after the last step. */
const SETTLE_MS = 300;

type Props = {
  bpm: number;
  onBpm: (bpm: number) => void;
  disabled?: boolean;
  /**
   * For a screen where a new tempo is expensive. In the Editor every BPM restarts playback
   * and redraws every track, and a held button asked for that up to 25 times a second: the
   * number crawled, taps lagged and the ticks bunched up. With this the number runs ahead by
   * itself and `onBpm` is called once, when the stepping stops.
   */
  settle?: boolean;
};

/** − 92 BPM +. Tap for one BPM, hold to keep going (faster and faster); a tick on every step. */
export function BpmStepper({ bpm, onBpm, disabled, settle }: Props) {
  // The interval reads the latest value, not the one from when the finger went down.
  const current = useRef(bpm);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Stepped to, not yet handed over (`settle`). While it waits, the number shown is ours. */
  const waiting = useRef(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const down = useRef(false);
  const [ahead, setAhead] = useState(bpm);
  if (!waiting.current) current.current = bpm;
  const shown = waiting.current ? ahead : bpm;
  const latestOnBpm = useRef(onBpm);
  latestOnBpm.current = onBpm;
  const handOver = () => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    if (!waiting.current) return;
    waiting.current = false;
    latestOnBpm.current(current.current);
  };
  /** Hand over once the stepping has stopped: never under a finger that is still down. */
  const settleSoon = () => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(handOver, SETTLE_MS);
  };

  const step = (dir: 1 | -1) => {
    // A tempo taken from the singer's voice can be 96.4: a step goes to the next whole BPM.
    const whole = dir > 0 ? Math.floor(current.current) + 1 : Math.ceil(current.current) - 1;
    const next = Math.min(MAX_BPM, Math.max(MIN_BPM, whole));
    if (next === current.current) return false;
    current.current = next;
    haptics.tick();
    if (!settle) { onBpm(next); return true; }
    waiting.current = true;
    setAhead(next);
    if (!down.current) settleSoon();
    return true;
  };
  const stopRepeat = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const startRepeat = (dir: 1 | -1) => {
    stopRepeat();
    if (!step(dir)) return;
    let wait = REPEAT_MS;
    const again = () => {
      if (!step(dir)) { stopRepeat(); return; }
      wait = Math.max(FASTEST_MS, wait * 0.9);
      timer.current = setTimeout(again, wait);
    };
    timer.current = setTimeout(again, HOLD_MS);
  };
  // Leaving with a tempo still waiting: hand it over, never drop it.
  useEffect(() => () => { stopRepeat(); handOver(); }, []);
  useEffect(() => { if (disabled) stopRepeat(); }, [disabled]);

  const button = (dir: 1 | -1) => (
    <Pressable
      onPressIn={() => {
        down.current = true;
        if (pending.current) clearTimeout(pending.current);
        startRepeat(dir);
      }}
      onPressOut={() => {
        down.current = false;
        stopRepeat();
        if (waiting.current) settleSoon();
      }}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => pressed && styles.pressed}
      accessibilityRole="button"
      accessibilityLabel={dir > 0 ? 'Faster' : 'Slower'}
    >
      <Icon name={dir > 0 ? 'add' : 'minusCircle'} size={22} color={COLORS.textSecondary} />
    </Pressable>
  );

  return (
    <View
      style={[styles.row, disabled && styles.dim]}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Tempo"
      accessibilityValue={{ text: `${shown} BPM` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={e => { if (!disabled) step(e.nativeEvent.actionName === 'increment' ? 1 : -1); }}
    >
      {button(-1)}
      <Text style={styles.text}>{`${shown} BPM`}</Text>
      {button(1)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { color: COLORS.white, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'], minWidth: 58, textAlign: 'center' },
  pressed: { opacity: 0.6 },
  dim: { opacity: 0.4 },
});
