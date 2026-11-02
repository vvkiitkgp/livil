import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import SheetModal, { SheetScrollView } from '../../components/SheetModal';
import { Icon } from '../../components/Icon';
import { COLORS } from '../../theme/colors';
import { haptics } from '../../utils/haptics';
import {
  clonePattern,
  DRUM_IDS,
  DRUM_NAMES,
  DRUM_PRESETS,
  emptyPattern,
  nearestStep,
  STEPS,
  type DrumId,
  type DrumPattern,
} from '../../utils/drums';
import { barSeconds, type StudioEngine } from './studioEngine';
import { StudioSlider } from './StudioSlider';

type Props = {
  visible: boolean;
  onClose: () => void;
  engine: StudioEngine;
  playing: boolean;
  onTogglePlay: () => void;
  playhead: number;
  pattern: DrumPattern;
  bpm: number;
  drumVolume: number;
  onPattern: (p: DrumPattern) => void;
  /** A preset's pattern — the tempo stays the song's. */
  onPreset: (p: DrumPattern) => void;
  onVolume: (v: number) => void;
};

type Mode = 'try' | 'record';

/**
 * The drum sheet. One bar, 16 squares, looping under whatever is playing — no bar-length
 * menu (the owner found BandLab's 1/4/8/16-bar choice hard to use, 2026-10-30).
 * Try: pads only make sound. Record: pad taps snap to the nearest square and stay.
 */
export function BeatsSheet(props: Props) {
  const { visible, onClose, engine, playing, onTogglePlay, playhead, pattern, bpm, drumVolume, onPattern, onPreset, onVolume } = props;
  const [mode, setMode] = useState<Mode>('try');
  const [lit, setLit] = useState<DrumId | null>(null);
  const [gridW, setGridW] = useState(0);
  const bar = barSeconds(bpm);
  const currentStep = playing ? Math.floor((playhead % bar) / (bar / STEPS)) : -1;

  useEffect(() => {
    if (!lit) return;
    const t = setTimeout(() => setLit(null), 140);
    return () => clearTimeout(t);
  }, [lit]);

  const tap = (id: DrumId) => {
    haptics.tap();
    setLit(id);
    void engine.tapDrum(id);
    if (mode === 'record' && engine.playing) {
      const step = nearestStep(engine.position() % bar, bpm);
      console.log(`[LIVIL][BEATS] tap ${id} at ${engine.position().toFixed(3)} s → step ${step}`);
      if (!pattern[id][step]) {
        const next = clonePattern(pattern);
        next[id][step] = true;
        onPattern(next);
      }
    }
  };

  const toggleCell = (id: DrumId, step: number) => {
    const next = clonePattern(pattern);
    next[id][step] = !next[id][step];
    onPattern(next);
  };

  const cell = gridW > 0 ? Math.floor((gridW - 52) / STEPS) : 0;

  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      halfShare={0.6}
      header={
        <View style={styles.header}>
          <Text style={styles.title}>Beats</Text>
          <Pressable onPress={onTogglePlay} style={styles.play} accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'}>
            <Icon name={playing ? 'pause' : 'play'} size={18} color={COLORS.purpleNeon} weight="fill" />
          </Pressable>
        </View>
      }
    >
      <SheetScrollView contentContainerStyle={styles.body}>
        <View style={styles.segment} accessibilityRole="tablist">
          {(['try', 'record'] as Mode[]).map(m => (
            <Pressable
              key={m}
              onPress={() => { setMode(m); if (m === 'record' && !playing) onTogglePlay(); }}
              style={[styles.segBtn, mode === m && styles.segOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === m }}
            >
              {m === 'record' && <View style={[styles.recDot, mode !== m && { opacity: 0.4 }]} />}
              <Text style={[styles.segText, mode === m && styles.segTextOn]}>{m === 'try' ? 'Try' : 'Record'}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>
          {mode === 'try'
            ? 'Tap the pads to play along. Nothing is saved.'
            : 'Tap along with the song. Each tap lands on the nearest square and loops from then on.'}
        </Text>

        <View style={styles.pads}>
          {DRUM_IDS.map(id => (
            <Pressable
              key={id}
              onPressIn={() => tap(id)}
              style={[styles.pad, lit === id && styles.padLit]}
              accessibilityRole="button"
              accessibilityLabel={DRUM_NAMES[id]}
            >
              <Text style={[styles.padText, lit === id && { color: COLORS.white }]}>{DRUM_NAMES[id]}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.grid} onLayout={e => setGridW(Math.floor(e.nativeEvent.layout.width))}>
          {cell > 0 && DRUM_IDS.map(id => (
            <View key={id} style={styles.gridRow}>
              <Text style={styles.gridLabel}>{DRUM_NAMES[id]}</Text>
              {Array.from({ length: STEPS }, (_, s) => {
                const on = pattern[id][s];
                return (
                  <Pressable
                    key={s}
                    onPress={() => toggleCell(id, s)}
                    hitSlop={2}
                    style={[
                      styles.cell,
                      { width: cell - 3, height: cell - 3 },
                      s % 4 === 0 && styles.cellBeat,
                      on && styles.cellOn,
                      s === currentStep && styles.cellNow,
                    ]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${DRUM_NAMES[id]} step ${s + 1}`}
                  />
                );
              })}
            </View>
          ))}
        </View>

        <View style={styles.presets}>
          {DRUM_PRESETS.map(p => (
            <Pressable key={p.name} onPress={() => onPreset(clonePattern(p.pattern))} style={styles.preset} accessibilityRole="button">
              <Text style={styles.presetText}>{p.name}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => onPattern(emptyPattern())} style={styles.preset} accessibilityRole="button">
            <Text style={[styles.presetText, { color: COLORS.textSecondary }]}>Clear</Text>
          </Pressable>
        </View>

        <View style={styles.volRow}>
          <Text style={styles.volLabel}>Drum volume</Text>
          <StudioSlider compact value={drumVolume} max={1.5} onChange={onVolume} accessibilityLabel="Drum volume" style={{ flex: 1 }} />
        </View>
      </SheetScrollView>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 8 },
  title: { color: COLORS.white, fontSize: 18, fontWeight: '800' },
  play: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: COLORS.purple, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 20, paddingBottom: 40, gap: 14 },
  segment: { flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: 12, padding: 3 },
  segBtn: { flex: 1, height: 36, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  segOn: { backgroundColor: COLORS.card },
  segText: { color: COLORS.textSecondary, fontWeight: '700', fontSize: 14 },
  segTextOn: { color: COLORS.white },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.error },
  hint: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 18 },
  pads: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  pad: {
    width: '48%', flexGrow: 1, height: 72, borderRadius: 16, backgroundColor: COLORS.surface, borderWidth: 1.5,
    borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center',
  },
  padLit: { borderColor: COLORS.purpleNeon, backgroundColor: COLORS.purpleGlow },
  padText: { color: COLORS.textSecondary, fontSize: 15, fontWeight: '700' },
  grid: { gap: 3 },
  gridRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  gridLabel: { width: 46, color: COLORS.textMuted, fontSize: 11, fontWeight: '600' },
  cell: { borderRadius: 4, backgroundColor: COLORS.surface },
  cellBeat: { backgroundColor: COLORS.card },
  cellOn: { backgroundColor: COLORS.purple },
  cellNow: { borderWidth: 1.5, borderColor: COLORS.white },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preset: { height: 34, paddingHorizontal: 14, borderRadius: 17, borderWidth: 1, borderColor: COLORS.border, justifyContent: 'center' },
  presetText: { color: COLORS.white, fontSize: 13, fontWeight: '600' },
  volRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  volLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700' },
});
