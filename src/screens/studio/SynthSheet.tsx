import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import SheetModal, { SheetScrollView } from '../../components/SheetModal';
import { Icon } from '../../components/Icon';
import { COLORS } from '../../theme/colors';
import { haptics } from '../../utils/haptics';
import { NOTE_NAMES } from '../../utils/magicTune';
import {
  CHORD_LOOPS,
  chordLoopDegrees,
  chordName,
  chordSpans,
  degreeName,
  guitarBar,
  isGuitar,
  keyboardDegrees,
  MAX_NOTE_STEPS,
  sameInstrument,
  SOUND_CHOICES,
  STRUMS,
  strumOf,
  SYNTH_NAMES,
  SYNTH_STEPS,
  synthKeyName,
  type SynthKey,
  type SynthPart,
} from '../../utils/synth';
import type { StudioEngine } from './studioEngine';
import { StudioSlider } from './StudioSlider';

type Props = {
  visible: boolean;
  onClose: () => void;
  engine: StudioEngine;
  playing: boolean;
  onTogglePlay: () => void;
  playhead: number;
  bpm: number;
  part: SynthPart | null;
  /** The key Magic Tune found in the voice, when there is one — the default for a new part. */
  voiceKey: SynthKey | null;
  onPart: (p: SynthPart) => void;
};

type Mode = 'try' | 'record';

/**
 * The 4-bar loop at a glance: one cell per bar with its chord, a tick per played note (on the
 * guitar, a line for as long as each chord is strummed), and the bar now playing outlined.
 * Sized from onLayout in px (a percentage `left` on an absolute view doesn't place it in RN 0.85).
 */
export function SynthStrip({ part, step }: { part: SynthPart; step: number }) {
  const [w, setW] = useState(0);
  const chords = part.chords ? chordLoopDegrees(part.chords, part.key) : null;
  const bar = step >= 0 ? Math.floor(step / 16) : -1;
  const notes = isGuitar(part.sound) ? chordSpans(part) : part.notes;
  return (
    <View style={styles.strip} onLayout={e => setW(Math.floor(e.nativeEvent.layout.width))}>
      {[0, 1, 2, 3].map(b => (
        <View key={b} style={[styles.stripBar, b === bar && styles.stripBarNow]}>
          <Text style={styles.stripChord} numberOfLines={1}>{chords ? chordName(part.key, chords[b]) : ''}</Text>
        </View>
      ))}
      {w > 0 && notes.map((n, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={[styles.tick, {
            left: Math.floor((n.step / SYNTH_STEPS) * w),
            width: Math.max(3, Math.floor((Math.min(n.len, SYNTH_STEPS - n.step) / SYNTH_STEPS) * w) - 1),
            bottom: 3 + (n.degree % 8) * 2,
          }]}
        />
      ))}
    </View>
  );
}

const STROKE_WORDS: Record<string, string> = { D: 'down', U: 'up', X: 'muted', P: 'pick', '.': 'rest' };

/**
 * One bar of the guitar's hand, on the count: an arrow for each stroke, a cross for a muted
 * one, a dot where the hand passes. The accents (2 and 4) are the white ones.
 */
function StrumBar({ bar }: { bar: string }) {
  const all = [...bar].map((c, i) => ({ c, i }));
  // In 8ths, unless the pattern has strokes on the 16ths between.
  const sixteenths = all.some(s => s.i % 2 === 1 && s.c !== '.');
  const slots = all.filter(s => sixteenths || s.i % 2 === 0);
  return (
    <View style={styles.strumBar} accessible accessibilityLabel={`One bar: ${slots.map(s => STROKE_WORDS[s.c]).join(', ')}`}>
      {slots.map(({ c, i }) => {
        const color = i === 4 || i === 12 ? COLORS.white : COLORS.purpleLight;
        return (
          <View key={i} style={styles.strumSlot}>
            <View style={styles.strumStroke}>
              {c === 'D' || c === 'U' || c === 'X'
                ? <Icon name={c === 'D' ? 'arrowDown' : c === 'U' ? 'arrowUp' : 'close'} size={14} color={color} weight="bold" />
                : <View style={[styles.strumDot, c === 'P' && styles.strumPick]} />}
            </View>
            <Text style={styles.strumCount}>{i % 4 === 0 ? String(i / 4 + 1) : i % 4 === 2 ? '&' : ''}</Text>
          </View>
        );
      })}
    </View>
  );
}

type KeyboardProps = {
  degrees: number[];
  label: (degree: number) => string;
  /** "Play" or "Strum", for screen readers. */
  verb: string;
  /** The keys held now. */
  lit: Set<number>;
  onDown: (degree: number) => void;
  onUp: (degree: number) => void;
};

/**
 * The keys, played with as many fingers as you like. One gesture over the row follows each
 * finger by its touch id: a Pressable takes one finger at a time, so a key pressed while
 * another was still down did nothing (two notes at once, or a quick chord change, dropped).
 * A finger keeps the key it landed on until it lifts, even if it slides.
 */
function Keyboard({ degrees, label, verb, lit, onDown, onUp }: KeyboardProps) {
  const [w, setW] = useState(0);
  /** Each finger down now → the key it pressed. */
  const fingers = useRef(new Map<number, number>());
  const keyAt = (x: number) => degrees[Math.min(degrees.length - 1, Math.max(0, Math.floor((x / w) * degrees.length)))];
  const held = (degree: number) => [...fingers.current.values()].includes(degree);
  const lift = (ids: number[]) => {
    for (const id of ids) {
      const d = fingers.current.get(id);
      if (d === undefined) continue;
      fingers.current.delete(id);
      if (!held(d)) onUp(d); // unless another finger is on the same key
    }
  };
  const touch = Gesture.Manual()
    .runOnJS(true)
    .onTouchesDown((e, manager) => {
      if (w <= 0) return;
      // Active from the first touch, so the sheet can't take the finger for a drag or scroll.
      manager.activate();
      for (const t of e.changedTouches) {
        const d = keyAt(t.x);
        const already = held(d);
        fingers.current.set(t.id, d);
        if (!already) onDown(d);
      }
    })
    .onTouchesUp((e, manager) => {
      lift(e.changedTouches.map(t => t.id));
      if (fingers.current.size === 0) manager.end();
    })
    // Cancelled or ended any other way: no key may stay down.
    .onFinalize(() => lift([...fingers.current.keys()]));
  return (
    <GestureDetector gesture={touch}>
      <View style={styles.keyboard} onLayout={e => setW(Math.floor(e.nativeEvent.layout.width))}>
        {degrees.map(d => {
          const on = lit.has(d);
          return (
            <View
              key={d}
              style={[styles.key, (d === 0 || d === 7) && styles.keyRoot, on && styles.keyLit]}
              accessible
              accessibilityRole="button"
              accessibilityLabel={`${verb} ${label(d)}`}
              accessibilityActions={[{ name: 'activate' }]}
              // For screen readers: activating a key presses it and lets go.
              onAccessibilityAction={() => { onDown(d); setTimeout(() => onUp(d), 250); }}
            >
              <Text style={[styles.keyText, on && styles.keyTextLit]}>{label(d)}</Text>
            </View>
          );
        })}
      </View>
    </GestureDetector>
  );
}

/**
 * A synth part: its sound, its key, a chord loop to start from, and a keyboard to play your
 * own notes on top. Everything loops every 4 bars. Try: keys only make sound. Record: a held
 * key lands on the nearest 16th, as long as it was held, and loops from then on.
 *
 * The guitar has a strumming pattern too. Its chord loop plays in that pattern, and each of
 * its keys is a chord: held, it is strummed in the pattern on the beat (recorded on the
 * nearest 8th), taking over from the chord loop for as long as it is held.
 */
export function SynthSheet(props: Props) {
  const { visible, onClose, engine, playing, onTogglePlay, playhead, bpm, part: livePart, voiceKey, onPart } = props;
  // Keep showing the last part while the sheet slides away after it's closed.
  const last = useRef(livePart);
  if (livePart) last.current = livePart;
  const part = livePart ?? last.current;
  const partRef = useRef(part);
  partRef.current = part;
  const [mode, setMode] = useState<Mode>('try');
  const [keyOpen, setKeyOpen] = useState(false);
  const [lit, setLit] = useState<Set<number>>(new Set());
  useEffect(() => { if (!visible) { setMode('try'); setKeyOpen(false); } }, [visible]);

  const stepSec = 60 / bpm / 4;
  const currentStep = playing ? Math.floor(playhead / stepSec) % SYNTH_STEPS : -1;
  /**
   * Keys held right now: the sounding note, and where/when a recorded one started. `until`: on
   * the guitar, the step a later chord took over at, while this key was still down.
   */
  const held = useRef(new Map<number, { note: Promise<{ release: () => void }>; step: number | null; t0: number; until?: number }>());

  if (!part) return null;
  const set = (patch: Partial<SynthPart>) => onPart({ ...partRef.current!, ...patch });

  const press = (degree: number) => {
    haptics.tap();
    setLit(s => new Set(s).add(degree));
    const rec = mode === 'record' && engine.playing;
    // A note lands on the nearest 16th; a guitar chord on the nearest 8th, where strokes fall.
    const step = !rec ? null : isGuitar(part.sound) ? engine.chordStep() : Math.round(engine.position() / stepSec) % SYNTH_STEPS;
    // One guitar, one chord: this one takes over from any still held, here and in the engine.
    if (step !== null && isGuitar(part.sound)) for (const h of held.current.values()) h.until ??= step;
    held.current.set(degree, { note: engine.pressSynth(part, degree), step, t0: Date.now() });
  };
  const releaseKey = (degree: number) => {
    setLit(s => { const n = new Set(s); n.delete(degree); return n; });
    const h = held.current.get(degree);
    if (!h) return;
    held.current.delete(degree);
    void h.note.then(n => n.release());
    const from = h.step;
    if (from === null) return;
    const steps = (Date.now() - h.t0) / 1000 / stepSec;
    const cur = partRef.current!;
    if (isGuitar(cur.sound)) {
      // Held in 8ths, for up to the whole loop — or until a later chord took over. It replaces
      // any chord recorded earlier that starts under it.
      if (h.until === from) return; // replaced on the very 8th it started on
      const len = h.until !== undefined
        ? (h.until - from + SYNTH_STEPS) % SYNTH_STEPS
        : Math.min(SYNTH_STEPS, 2 * Math.max(1, Math.round(steps / 2)));
      const under = (n: { step: number }) => (n.step - (n.step % 2) - from + SYNTH_STEPS) % SYNTH_STEPS < len;
      set({ notes: [...cur.notes.filter(n => !under(n)), { step: from, degree, len }] });
      return;
    }
    const len = Math.min(MAX_NOTE_STEPS, Math.max(1, Math.round(steps)));
    set({ notes: [...cur.notes.filter(n => n.step !== from || n.degree !== degree), { step: from, degree, len }] });
  };

  const fromVoice = !!voiceKey && voiceKey.tonic === part.key.tonic && voiceKey.mode === part.key.mode;
  const guitar = isGuitar(part.sound);
  const keyLabel = (d: number) => (guitar ? chordName(part.key, d) : degreeName(part.key, d));

  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      halfShare={0.7}
      header={
        <View style={styles.header}>
          <Text style={styles.title}>{`${SYNTH_NAMES[part.sound]} · ${synthKeyName(part.key)}`}</Text>
          <Pressable onPress={onTogglePlay} style={styles.play} accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'}>
            <Icon name={playing ? 'pause' : 'play'} size={18} color={COLORS.purpleNeon} weight="fill" />
          </Pressable>
        </View>
      }
    >
      <SheetScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.chips}>
          {SOUND_CHOICES.map(s => {
            const on = sameInstrument(part.sound, s);
            return (
              <Pressable
                key={s}
                onPress={() => { haptics.select(); if (!on) set({ sound: s }); }}
                style={[styles.chip, on && styles.chipOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{SYNTH_NAMES[s]}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.keyRow}>
          <Text style={styles.label}>Key</Text>
          <Text style={styles.keyName}>{synthKeyName(part.key)}</Text>
          {fromVoice && <Text style={styles.keyFrom}>from your voice</Text>}
          <View style={{ flex: 1 }} />
          <Pressable onPress={() => setKeyOpen(o => !o)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Change the key">
            <Text style={styles.link}>{keyOpen ? 'Done' : 'Change'}</Text>
          </Pressable>
        </View>
        {keyOpen && (
          <View style={{ gap: 8 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {NOTE_NAMES.map((n, t) => (
                <Pressable key={n} onPress={() => set({ key: { ...part.key, tonic: t } })} style={[styles.chip, styles.chipSm, part.key.tonic === t && styles.chipOn]}>
                  <Text style={[styles.chipText, part.key.tonic === t && styles.chipTextOn]}>{n}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.chips}>
              {(['major', 'minor'] as const).map(m => (
                <Pressable key={m} onPress={() => set({ key: { ...part.key, mode: m } })} style={[styles.chip, part.key.mode === m && styles.chipOn]}>
                  <Text style={[styles.chipText, part.key.mode === m && styles.chipTextOn]}>{m === 'major' ? 'Major' : 'Minor'}</Text>
                </Pressable>
              ))}
              {voiceKey && !fromVoice && (
                <Pressable onPress={() => set({ key: voiceKey })} style={styles.chip}>
                  <Text style={[styles.chipText, { color: COLORS.purpleLight }]}>Use the voice’s key</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        {guitar && (
          <>
            <Text style={styles.section}>Strumming</Text>
            <View style={styles.chips}>
              {STRUMS.map(g => {
                const on = part.sound === 'strum' && strumOf(part) === g.id;
                return (
                  <Pressable
                    key={g.id}
                    onPress={() => { haptics.select(); set({ sound: 'strum', strum: g.id }); }}
                    style={[styles.chip, on && styles.chipOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{g.name}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => { haptics.select(); set({ sound: 'pick' }); }}
                style={[styles.chip, part.sound === 'pick' && styles.chipOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: part.sound === 'pick' }}
              >
                <Text style={[styles.chipText, part.sound === 'pick' && styles.chipTextOn]}>Fingerpick</Text>
              </Pressable>
            </View>
            <StrumBar bar={guitarBar(part)} />
          </>
        )}

        <Text style={styles.section}>Chords</Text>
        <View style={styles.loops}>
          {CHORD_LOOPS.map(c => {
            const on = part.chords === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => { haptics.select(); set({ chords: on ? null : c.id }); }}
                style={[styles.loop, on && styles.loopOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.loopName, on && { color: COLORS.purpleNeon }]}>{c.name}</Text>
                <Text style={styles.loopChords} numberOfLines={1}>
                  {chordLoopDegrees(c.id, part.key).map(d => chordName(part.key, d)).join('  ')}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <SynthStrip part={part} step={currentStep} />

        <Text style={styles.section}>Play your own</Text>
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
            ? guitar
              ? 'Every key is a chord in your key, so nothing sounds wrong. Hold one and the guitar strums it in the pattern above; let go and it rings out. Nothing is saved.'
              : 'Only notes in your key, so nothing sounds wrong. Nothing is saved.'
            : guitar
              ? 'Hold each chord for as long as you want it strummed. It lands on the beat, takes over from the chord loop while it plays, and loops every 4 bars.'
              : 'Play along with the song. Hold a key for a longer note. It lands on the beat and loops every 4 bars.'}
        </Text>
        <Keyboard
          degrees={keyboardDegrees(part.sound)}
          label={keyLabel}
          verb={guitar ? 'Strum' : 'Play'}
          lit={lit}
          onDown={press}
          onUp={releaseKey}
        />
        {part.notes.length > 0 && (
          <View style={styles.notesRow}>
            <Text style={styles.notesCount}>{`${part.notes.length} ${guitar ? 'chord' : 'note'}${part.notes.length > 1 ? 's' : ''} played`}</Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => set({ notes: part.notes.slice(0, -1) })} hitSlop={8} accessibilityRole="button">
              <Text style={styles.link}>Undo</Text>
            </Pressable>
            <Pressable onPress={() => set({ notes: [] })} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.link, { color: COLORS.textSecondary }]}>Clear</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.volRow}>
          <Text style={styles.label}>Volume</Text>
          <StudioSlider compact value={part.volume} max={1.5} onChange={v => set({ volume: v })} accessibilityLabel={`${SYNTH_NAMES[part.sound]} volume`} style={{ flex: 1 }} />
        </View>
      </SheetScrollView>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 8 },
  title: { color: COLORS.white, fontSize: 18, fontWeight: '800' },
  play: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: COLORS.purple, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 20, paddingBottom: 40, gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 34, paddingHorizontal: 14, borderRadius: 17, borderWidth: 1, borderColor: COLORS.border, justifyContent: 'center' },
  chipSm: { paddingHorizontal: 11 },
  chipOn: { borderColor: COLORS.purpleNeon, backgroundColor: COLORS.purpleDim },
  chipText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: COLORS.purpleNeon },
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700' },
  keyName: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  keyFrom: { color: COLORS.textMuted, fontSize: 12 },
  link: { color: COLORS.purpleNeon, fontSize: 13, fontWeight: '700' },
  section: { color: COLORS.white, fontSize: 15, fontWeight: '800', marginTop: 6 },
  loops: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  loop: { width: '48%', flexGrow: 1, borderRadius: 14, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.surface, padding: 12, gap: 4 },
  loopOn: { borderColor: COLORS.purpleNeon, backgroundColor: COLORS.purpleDim },
  loopName: { color: COLORS.white, fontSize: 14, fontWeight: '800' },
  loopChords: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  strip: { flexDirection: 'row', height: 34, gap: 2 },
  stripBar: { flex: 1, borderRadius: 6, backgroundColor: COLORS.card, paddingHorizontal: 6, paddingTop: 3 },
  stripBarNow: { borderWidth: 1.5, borderColor: COLORS.white },
  stripChord: { color: COLORS.purpleLight, fontSize: 10, fontWeight: '800' },
  tick: { position: 'absolute', height: 3, borderRadius: 1.5, backgroundColor: COLORS.purpleNeon },
  segment: { flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: 12, padding: 3 },
  segBtn: { flex: 1, height: 36, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  segOn: { backgroundColor: COLORS.card },
  segText: { color: COLORS.textSecondary, fontWeight: '700', fontSize: 14 },
  segTextOn: { color: COLORS.white },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.error },
  hint: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 18 },
  keyboard: { flexDirection: 'row', gap: 4, height: 120 },
  key: {
    flex: 1, borderRadius: 10, backgroundColor: COLORS.surface, borderWidth: 1.5, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 10,
  },
  keyRoot: { borderColor: COLORS.purpleDeep },
  keyLit: { borderColor: COLORS.purpleNeon, backgroundColor: COLORS.purpleGlow },
  keyText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '800' },
  keyTextLit: { color: COLORS.white },
  strumBar: { flexDirection: 'row', borderRadius: 10, backgroundColor: COLORS.surface, paddingVertical: 8, paddingHorizontal: 6 },
  strumSlot: { flex: 1, alignItems: 'center', gap: 3 },
  strumStroke: { height: 16, alignItems: 'center', justifyContent: 'center' },
  strumDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: COLORS.textMuted },
  strumPick: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.purpleLight },
  strumCount: { color: COLORS.textMuted, fontSize: 10, fontWeight: '700', height: 13 },
  notesRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  notesCount: { color: COLORS.textSecondary, fontSize: 13 },
  volRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
});
