import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import SheetModal, { SheetScrollView } from '../../components/SheetModal';
import { Icon } from '../../components/Icon';
import { COLORS } from '../../theme/colors';
import { PITCH_RANGE, pitchLabel, type VoiceFx } from '../../utils/audioFx/effects';
import { StudioSlider } from './StudioSlider';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** The voice being edited (null while closed). */
  name: string;
  fx: VoiceFx | null;
  playing: boolean;
  onTogglePlay: () => void;
  /**
   * Every change. Reverb applies live; a pitch change arrives once, when the finger lifts,
   * with `restart` — the shifted voice is set up as playback (re)starts.
   */
  onFx: (fx: VoiceFx, restart: boolean) => void;
};

function Card({ title, body, on, onToggle, children }: {
  title: string;
  body: string;
  on: boolean;
  onToggle: (on: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.card, on && styles.cardOn]}>
      <View style={styles.cardHead}>
        <View style={styles.cardText}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardBody}>{body}</Text>
        </View>
        <Switch
          value={on}
          onValueChange={onToggle}
          trackColor={{ false: COLORS.inputBg, true: COLORS.purple }}
          thumbColor={COLORS.white}
          ios_backgroundColor={COLORS.inputBg}
          accessibilityLabel={title}
        />
      </View>
      {on && <View style={styles.controls}>{children}</View>}
    </View>
  );
}

function Row({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <StudioSlider compact value={value} onChange={onChange} accessibilityLabel={label} style={styles.rowSlider} />
    </View>
  );
}

/** Pitch and reverb for one voice. */
export function EffectsSheet({ visible, onClose, name, fx: liveFx, playing, onTogglePlay, onFx }: Props) {
  // Keep showing the last voice while the sheet slides away after it's closed.
  const last = useRef({ fx: liveFx, name });
  if (liveFx) last.current = { fx: liveFx, name };
  const fx = liveFx ?? last.current.fx;
  // The pitch while the finger is on the slider; committed on release.
  const [pitch, setPitch] = useState(fx?.pitch ?? 0);
  useEffect(() => { if (fx) setPitch(fx.pitch); }, [fx]);
  if (!fx) return null;
  const setReverb = (patch: Partial<VoiceFx['reverb']>) => onFx({ ...fx, reverb: { ...fx.reverb, ...patch } }, false);
  const commitPitch = (v: number) => {
    const p = Math.round(v);
    setPitch(p);
    if (p !== fx.pitch) onFx({ ...fx, pitch: p }, true);
  };

  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      halfShare={0.6}
      header={
        <View style={styles.header}>
          <Text style={styles.title}>{`Effects · ${liveFx ? name : last.current.name}`}</Text>
          <Pressable onPress={onTogglePlay} style={styles.play} accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'}>
            <Icon name={playing ? 'pause' : 'play'} size={18} color={COLORS.purpleNeon} weight="fill" />
          </Pressable>
        </View>
      }
    >
      <SheetScrollView contentContainerStyle={styles.body}>
        <View style={[styles.card, pitch !== 0 && styles.cardOn]}>
          <View style={styles.cardHead}>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>Pitch</Text>
              <Text style={styles.cardBody}>Your voice higher or lower, same speed</Text>
            </View>
            <Text style={[styles.pitchNow, pitch !== 0 && { color: COLORS.purpleNeon }]}>{pitchLabel(pitch)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Lower</Text>
            <StudioSlider
              compact
              value={pitch}
              min={-PITCH_RANGE}
              max={PITCH_RANGE}
              onChange={v => setPitch(Math.round(v))}
              onDone={commitPitch}
              accessibilityLabel="Pitch, in semitones"
              style={styles.rowSlider}
            />
            <Text style={styles.rowLabelEnd}>Higher</Text>
          </View>
          {pitch !== 0 && (
            <Pressable onPress={() => commitPitch(0)} style={styles.reset} accessibilityRole="button">
              <Text style={styles.resetText}>Back to as sung</Text>
            </Pressable>
          )}
        </View>

        <Card title="Reverb" body="Sing in a room, a hall, or a cathedral" on={fx.reverb.on} onToggle={on => setReverb({ on })}>
          <Row label="Room" value={fx.reverb.size} onChange={v => setReverb({ size: v })} />
          <Row label="Level" value={fx.reverb.mix} onChange={v => setReverb({ mix: v })} />
        </Card>
      </SheetScrollView>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 8 },
  title: { color: COLORS.white, fontSize: 18, fontWeight: '800' },
  play: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: COLORS.purple, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 20, paddingBottom: 40, gap: 12 },
  card: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 12, gap: 10, borderWidth: 1, borderColor: COLORS.surface },
  cardOn: { borderColor: COLORS.purpleDim },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  cardBody: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 16 },
  controls: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 34 },
  rowLabel: { width: 60, color: COLORS.textSecondary, fontSize: 12, fontWeight: '700' },
  rowSlider: { flex: 1 },
  rowLabelEnd: { width: 46, color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  pitchNow: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  reset: { alignSelf: 'flex-start', paddingVertical: 4 },
  resetText: { color: COLORS.purpleLight, fontSize: 13, fontWeight: '600' },
});
