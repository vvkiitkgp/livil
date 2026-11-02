import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AudioManager } from 'react-native-audio-api';
import SheetModal from '../../components/SheetModal';
import { Icon } from '../../components/Icon';
import { COLORS } from '../../theme/colors';
import { haptics } from '../../utils/haptics';
import type { Mic } from '../../utils/audioDevices';
import type { StudioEngine } from './studioEngine';

type State = Awaited<ReturnType<StudioEngine['mics']>>;

/**
 * Which mic is recording, and (iPhone) a sheet to pick another: the phone's own, wired or
 * USB earphones' mic, a USB mic. Re-reads whenever something is plugged in or out.
 */
export function MicPicker({ engine, disabled }: { engine: StudioEngine; disabled: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => { void engine.mics().then(setState); }, [engine]);
  useEffect(() => {
    refresh();
    const sub = AudioManager.addSystemEventListener('routeChange', refresh);
    return () => sub.remove();
  }, [refresh]);

  if (!state) return null;
  const { list, current, canChoose, bluetoothOut } = state;
  const name = current?.label ?? 'Phone mic';

  const choose = async (m: Mic) => {
    haptics.select();
    if (m.id !== current?.id) await engine.chooseMic(m.id);
    refresh();
    setOpen(false);
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        hitSlop={6}
        style={({ pressed }) => [styles.chip, disabled && styles.dim, pressed && { opacity: 0.8 }]}
        accessibilityRole="button"
        accessibilityLabel={`Recording with the ${name}. ${canChoose ? 'Tap to choose another mic.' : 'Tap for details.'}`}
      >
        <Icon name="mic" size={13} color={COLORS.purpleLight} />
        <Text style={styles.chipText} numberOfLines={1}>{current?.detail ? `${name} · ${current.detail}` : name}</Text>
        <Icon name="collapse" size={11} color={COLORS.textSecondary} />
      </Pressable>

      <SheetModal
        visible={open}
        onClose={() => setOpen(false)}
        fit
        header={<Text style={styles.title}>Record with</Text>}
      >
        <View style={styles.body}>
          {list.map(m => {
            const on = m.id === current?.id;
            return (
              <Pressable
                key={m.id}
                onPress={() => void choose(m)}
                disabled={!canChoose}
                style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && canChoose && { opacity: 0.8 }]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, disabled: !canChoose }}
              >
                <Icon name="mic" size={18} color={on ? COLORS.purpleNeon : COLORS.textSecondary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowLabel, on && { color: COLORS.white }]}>{m.label}</Text>
                  {m.detail && <Text style={styles.rowDetail}>{m.detail}</Text>}
                </View>
                {on && <Icon name="check" size={18} color={COLORS.purpleNeon} />}
              </Pressable>
            );
          })}
          {!canChoose && (
            <Text style={styles.note}>Android picks the mic itself: the earphones mic when wired or USB earphones are plugged in, otherwise the phone mic.</Text>
          )}
          {canChoose && list.length < 2 && (
            <Text style={styles.note}>Plug in wired or USB earphones with a mic to record with them instead.</Text>
          )}
          {bluetoothOut && (
            <Text style={styles.note}>You hear the song in your Bluetooth earphones. Their mic isn't offered: it only records in phone-call quality, so the phone mic records you instead.</Text>
          )}
        </View>
      </SheetModal>
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, maxWidth: '80%',
    paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, borderColor: COLORS.border,
  },
  chipText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', flexShrink: 1 },
  dim: { opacity: 0.4 },
  title: { color: COLORS.white, fontSize: 18, fontWeight: '800', paddingHorizontal: 20, paddingBottom: 8 },
  body: { paddingHorizontal: 20, paddingBottom: 32, gap: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14,
    borderRadius: 14, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  rowOn: { borderColor: COLORS.purpleNeon },
  rowLabel: { color: COLORS.textSecondary, fontSize: 15, fontWeight: '700' },
  rowDetail: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  note: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 4 },
});
