import React, { useEffect, useRef } from 'react';
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

type Props = {
  bpm: number;
  onBpm: (bpm: number) => void;
  disabled?: boolean;
};

/** − 92 BPM +. Tap for one BPM, hold to keep going (faster and faster); a tick on every step. */
export function BpmStepper({ bpm, onBpm, disabled }: Props) {
  // The interval reads the latest value, not the one from when the finger went down.
  const current = useRef(bpm);
  current.current = bpm;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const step = (dir: 1 | -1) => {
    const next = Math.min(MAX_BPM, Math.max(MIN_BPM, current.current + dir));
    if (next === current.current) return false;
    current.current = next;
    haptics.tick();
    onBpm(next);
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
  useEffect(() => stopRepeat, []);
  useEffect(() => { if (disabled) stopRepeat(); }, [disabled]);

  const button = (dir: 1 | -1) => (
    <Pressable
      onPressIn={() => startRepeat(dir)}
      onPressOut={stopRepeat}
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
      accessibilityValue={{ text: `${bpm} BPM` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={e => { if (!disabled) step(e.nativeEvent.actionName === 'increment' ? 1 : -1); }}
    >
      {button(-1)}
      <Text style={styles.text}>{`${bpm} BPM`}</Text>
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
