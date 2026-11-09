import React, { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { GradientFill } from '../../components/GradientFill';
import { Icon } from '../../components/Icon';
import { COLORS } from '../../theme/colors';
import { anyFx, VOLUME_MAX } from '../../utils/audioFx/effects';
import { DRUM_IDS, STEPS } from '../../utils/drums';
import { CHORD_LOOPS, guitarStyleName, isGuitar, SYNTH_NAMES, SYNTH_STEPS, synthKeyName, type SynthPart } from '../../utils/synth';
import { BpmStepper } from './BpmStepper';
import { ClipTrack, peaksOf } from './ClipTrack';
import { formatClock } from './RecordPanel';
import { barSeconds, clipEnd, projectLength, songRange, type Project, type VoiceLane } from './studioEngine';
import { SongTrim } from './SongTrim';
import type { SongRange } from './timeline';
import { StudioSlider } from './StudioSlider';
import { SynthStrip } from './SynthSheet';
import { TimeRuler } from './TimeRuler';

type Props = {
  project: Project;
  playing: boolean;
  playhead: number;
  /** The live mix's peak, dB under the safety ceiling (engine.level), while playing. */
  level: number | null;
  onTogglePlay: () => void;
  onSeek: (sec: number) => void;
  onLane: (lane: VoiceLane, restart: boolean) => void;
  onRemoveLane: (lane: VoiceLane) => void;
  /** Reopen Magic Tune on this voice (key, strength, cleanup, or raw). */
  onOpenTune: (lane: VoiceLane) => void;
  onOpenFx: (lane: VoiceLane) => void;
  /** Flip "Clean up background" on this voice (rebuilds it from the recording). */
  onToggleClean: (lane: VoiceLane) => void;
  /** The voice being cleaned right now, and how far (0..1). */
  cleaning: { laneId: string; progress: number } | null;
  onBpm: (bpm: number) => void;
  /** The whole-song trim changed (null = no trim). */
  onRange: (range: SongRange | null) => void;
  onDrumVolume: (v: number) => void;
  /** The whole song's volume. */
  onMasterVolume: (v: number) => void;
  onOpenBeats: () => void;
  onAddVoice: () => void;
  onAddInstrument: () => void;
  onOpenSynth: (part: SynthPart) => void;
  onSynth: (part: SynthPart) => void;
  onRemoveSynth: (part: SynthPart) => void;
  onClose: () => void;
  /** Set once saved or opened from drafts. */
  draftTitle: string | null;
  unsaved: boolean;
  saving: boolean;
  onSave: () => void;
  /** On to "Your song": the finished mix, then Save draft or Create post. */
  onNext: () => void;
};

const LOOPS = [1, 2, 4, 8];

function MagicPill({ on, name, onPress }: { on: boolean; name: string; onPress: () => void }) {
  const [w, setW] = useState(0);
  return (
    <Pressable
      onPress={onPress}
      onLayout={e => setW(Math.floor(e.nativeEvent.layout.width))}
      style={[styles.pill, !on && styles.pillOff]}
      accessibilityRole="button"
      accessibilityLabel={`Magic Tune ${on ? 'on' : 'off'} for ${name}. Tap to change it.`}
    >
      {on && (
        <View style={[StyleSheet.absoluteFill, { borderRadius: 13, overflow: 'hidden' }]}>
          <GradientFill width={w} height={26} borderRadius={13} />
        </View>
      )}
      <Icon name="ai" size={12} color={on ? COLORS.white : COLORS.textSecondary} />
      <Text style={[styles.pillText, !on && { color: COLORS.textSecondary }]}>{on ? 'MAGIC TUNE' : 'RAW'}</Text>
      <Icon name="forward" size={11} color={on ? COLORS.white : COLORS.textSecondary} />
    </Pressable>
  );
}

/**
 * How loud the live mix is, in words: Low (turn things up), Good, or Too loud (the safety
 * step is squashing it — turn Song volume or the loudest part down). The posted song is
 * mastered either way; this is for getting the balance right while you work.
 */
function LevelReadout({ db }: { db: number | null }) {
  if (db == null) return <Text style={styles.level}>Level · press play</Text>;
  const [word, color] = db < -18 ? ['Low', COLORS.textSecondary] : db <= -3 ? ['Good', COLORS.success] : ['Too loud', COLORS.warning];
  return (
    <Text style={styles.level} accessibilityLabel={`Level ${db} decibels, ${word}`}>
      {`Level ${db} dB · `}<Text style={{ color, fontWeight: '800' }}>{word}</Text>
    </Text>
  );
}

/** The Editor: transport, one row per voice, the drum loop, and the add-lanes under them. */
export function EditorPanel(p: Props) {
  const { project } = p;
  const [frozenView, setFrozenView] = useState<number | null>(null);
  const bar = barSeconds(project.bpm);
  const len = projectLength(project);
  const range = songRange(project);
  const liveView = Math.max(8, Math.ceil((project.voices.reduce((m, v) => Math.max(m, clipEnd(v)), 0) + bar) / bar) * bar);
  // The timeline only ever widens: trimming a clip shorter must not zoom every row under your finger.
  const widest = useRef(0);
  widest.current = Math.max(widest.current, liveView);
  const viewLen = frozenView ?? widest.current;
  const [scrub, setScrub] = useState<number | null>(null);
  const playhead = scrub ?? p.playhead;
  const drumSteps = DRUM_IDS.reduce((n, id) => n + project.pattern[id].filter(Boolean).length, 0);
  const synthStep = p.playing ? Math.floor(playhead / (60 / project.bpm / 4)) % SYNTH_STEPS : -1;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={p.onClose} style={styles.headerSide} accessibilityLabel="Close the Editor" hitSlop={10}>
          <Icon name="close" size={22} color={COLORS.white} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.title}>Editor</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {p.draftTitle ? `${p.draftTitle}${p.unsaved ? ' · edited' : ' · saved'}` : 'Not saved yet'}
          </Text>
        </View>
        <TouchableOpacity
          onPress={p.onSave}
          disabled={p.saving || (!p.unsaved && !!p.draftTitle) || project.voices.length === 0}
          style={styles.headerSide}
          accessibilityRole="button"
          accessibilityLabel="Save to drafts on this phone"
          hitSlop={10}
        >
          {p.saving
            ? <ActivityIndicator size="small" color={COLORS.purpleLight} />
            : <Text style={[styles.save, (!p.unsaved && !!p.draftTitle) || project.voices.length === 0 ? styles.saveOff : null]}>Save</Text>}
        </TouchableOpacity>
      </View>

      <View style={styles.transport}>
        <Pressable onPress={p.onTogglePlay} style={styles.play} accessibilityRole="button" accessibilityLabel={p.playing ? 'Pause' : 'Play'}>
          <Icon name={p.playing ? 'pause' : 'play'} size={22} color={COLORS.purpleNeon} weight="fill" />
        </Pressable>
        <View>
          <Text style={styles.time}>{`${formatClock(playhead, true)} / ${formatClock(len)}`}</Text>
          <LevelReadout db={p.level} />
        </View>
        <View style={{ flex: 1 }} />
        <BpmStepper bpm={project.bpm} onBpm={p.onBpm} />
      </View>

      <View style={styles.master}>
        <Icon name="faders" size={13} color={COLORS.purpleLight} />
        <Text style={styles.masterLabel}>Song volume</Text>
        <StudioSlider compact value={project.masterVolume} max={VOLUME_MAX} onChange={p.onMasterVolume} accessibilityLabel="Whole song volume" style={{ flex: 1 }} />
        <Text style={[styles.volPct, project.masterVolume > 1.005 && { color: COLORS.purpleNeon }]}>{`${Math.round(project.masterVolume * 100)}%`}</Text>
      </View>

      <View style={styles.ruler}>
        <TimeRuler
          viewLen={viewLen}
          length={len}
          barSec={bar}
          playhead={playhead}
          onScrub={setScrub}
          onScrubEnd={sec => { p.onSeek(sec); setScrub(null); }}
        />
        <SongTrim
          viewLen={viewLen}
          full={len}
          range={range}
          bpm={project.bpm}
          onGesture={active => setFrozenView(active ? viewLen : null)}
          onCommit={p.onRange}
        />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {project.voices.map(v => (
          <View key={v.id} style={styles.lane}>
            <View style={styles.laneHead}>
              <Icon name="mic" size={14} color={COLORS.purpleLight} />
              <Text style={styles.laneName}>{v.name}</Text>
              <View style={{ flex: 1 }} />
              <Pressable
                onPress={() => p.onLane({ ...v, loops: LOOPS[(LOOPS.indexOf(v.loops) + 1) % LOOPS.length] }, true)}
                style={styles.loopBtn}
                accessibilityRole="button"
                accessibilityLabel={`Loop: plays ${v.loops} time${v.loops > 1 ? 's' : ''}. Tap to change.`}
              >
                <Icon name="repeat" size={13} color={v.loops > 1 ? COLORS.purpleNeon : COLORS.textSecondary} />
                <Text style={[styles.loopText, v.loops > 1 && { color: COLORS.purpleNeon }]}>{`×${v.loops}`}</Text>
              </Pressable>
              <Pressable onPress={() => p.onRemoveLane(v)} hitSlop={8} accessibilityLabel={`Remove ${v.name}`}>
                <Icon name="trash" size={16} color={COLORS.textMuted} />
              </Pressable>
            </View>
            <View style={styles.chips}>
              <MagicPill on={v.tuneOn} name={v.name} onPress={() => p.onOpenTune(v)} />
              <Pressable
                onPress={() => p.onToggleClean(v)}
                disabled={!!p.cleaning}
                style={[styles.fxBtn, styles.cleanBtn, v.take.tune.clean && styles.fxBtnOn, !!p.cleaning && p.cleaning.laneId !== v.id && styles.dim]}
                accessibilityRole="switch"
                accessibilityState={{ checked: v.take.tune.clean, busy: p.cleaning?.laneId === v.id }}
                accessibilityLabel={`Clean up background for ${v.name}`}
              >
                {p.cleaning?.laneId === v.id ? (
                  <>
                    <ActivityIndicator size="small" color={COLORS.purpleLight} />
                    <Text style={styles.fxText}>{`${Math.round(p.cleaning.progress * 100)}%`}</Text>
                  </>
                ) : (
                  <>
                    <Icon name="wave" size={12} color={v.take.tune.clean ? COLORS.purpleNeon : COLORS.textSecondary} />
                    <Text style={[styles.fxText, v.take.tune.clean && { color: COLORS.purpleNeon }]}>CLEAN</Text>
                  </>
                )}
              </Pressable>
              <Pressable
                onPress={() => p.onOpenFx(v)}
                style={[styles.fxBtn, anyFx(v.fx) && styles.fxBtnOn]}
                accessibilityRole="button"
                accessibilityLabel={`Effects for ${v.name}${anyFx(v.fx) ? ', some on' : ''}`}
              >
                <Text style={[styles.fxText, anyFx(v.fx) && { color: COLORS.purpleNeon }]}>FX</Text>
              </Pressable>
            </View>
            <ClipTrack
              clip={{ name: v.name, start: v.start, trimStart: v.trimStart, trimEnd: v.trimEnd, loops: v.loops }}
              takeLen={v.take.raw.length / v.take.sampleRate}
              peaks={peaksOf(v.take.raw, v.take.sampleRate)}
              viewLen={viewLen}
              bpm={project.bpm}
              barSec={bar}
              playhead={playhead}
              range={range}
              onGesture={active => setFrozenView(active ? liveView : null)}
              onCommit={c => p.onLane({ ...v, start: c.start, trimStart: c.trimStart, trimEnd: c.trimEnd }, true)}
              onSeek={sec => p.onSeek(Math.min(sec, Math.max(0, len - 0.05)))}
            />
            <View style={styles.volRow}>
              <Icon name="faders" size={13} color={COLORS.textMuted} />
              <StudioSlider compact value={v.volume} max={VOLUME_MAX} onChange={vol => p.onLane({ ...v, volume: vol }, false)} accessibilityLabel={`${v.name} volume`} style={{ flex: 1 }} />
              <Text style={[styles.volPct, v.volume > 1.005 && { color: COLORS.purpleNeon }]}>{`${Math.round(v.volume * 100)}%`}</Text>
            </View>
          </View>
        ))}

        <View style={styles.lane}>
          {/* Only the name and the pattern open the beat maker: the volume slider below is
              outside the Pressable, so dragging it never counts as a tap on the card. */}
          <Pressable onPress={p.onOpenBeats} style={styles.drumsTap} accessibilityRole="button" accessibilityLabel="Drums. Open the beat maker.">
            <View style={styles.laneHead}>
              <Icon name="drum" size={14} color={COLORS.purpleLight} />
              <Text style={styles.laneName}>Drums</Text>
              <Text style={styles.laneMeta}>{drumSteps ? 'Tap to edit the beat' : 'Tap to add a beat'}</Text>
            </View>
            <View style={styles.miniGrid}>
              {DRUM_IDS.map(id => (
                <View key={id} style={styles.miniRow}>
                  {Array.from({ length: STEPS }, (_, s) => (
                    <View key={s} style={[styles.miniCell, project.pattern[id][s] && styles.miniCellOn]} />
                  ))}
                </View>
              ))}
            </View>
          </Pressable>
          <View style={styles.volRow}>
            <Icon name="faders" size={13} color={COLORS.textMuted} />
            <StudioSlider compact value={project.drumVolume} max={1.5} onChange={p.onDrumVolume} accessibilityLabel="Drum volume" style={{ flex: 1 }} />
            <Text style={styles.volPct}>{`${Math.round(project.drumVolume * 100)}%`}</Text>
          </View>
        </View>

        {project.synths.map(s => {
          const loop = CHORD_LOOPS.find(c => c.id === s.chords);
          const guitar = isGuitar(s.sound);
          const meta = [
            synthKeyName(s.key),
            loop && `${loop.name} chords`,
            guitar && guitarStyleName(s),
            s.notes.length > 0 && `${s.notes.length} ${guitar ? 'chords' : 'notes'}`,
          ].filter(Boolean).join(' · ');
          return (
            <View key={s.id} style={styles.lane}>
              <Pressable onPress={() => p.onOpenSynth(s)} style={styles.drumsTap} accessibilityRole="button" accessibilityLabel={`${SYNTH_NAMES[s.sound]}. Open it.`}>
                <View style={styles.laneHead}>
                  <Icon name={guitar ? 'guitar' : 'piano'} size={14} color={COLORS.purpleLight} />
                  <Text style={styles.laneName}>{SYNTH_NAMES[s.sound]}</Text>
                  <Text style={[styles.laneMeta, { flex: 1 }]} numberOfLines={1}>{meta}</Text>
                </View>
                <SynthStrip part={s} step={synthStep} />
              </Pressable>
              <View style={styles.volRow}>
                <Icon name="faders" size={13} color={COLORS.textMuted} />
                <StudioSlider compact value={s.volume} max={1.5} onChange={vol => p.onSynth({ ...s, volume: vol })} accessibilityLabel={`${SYNTH_NAMES[s.sound]} volume`} style={{ flex: 1 }} />
                <Text style={styles.volPct}>{`${Math.round(s.volume * 100)}%`}</Text>
                <Pressable onPress={() => p.onRemoveSynth(s)} hitSlop={8} accessibilityLabel={`Remove ${SYNTH_NAMES[s.sound]}`}>
                  <Icon name="trash" size={16} color={COLORS.textMuted} />
                </Pressable>
              </View>
            </View>
          );
        })}

        <View style={styles.adds}>
          <Pressable onPress={p.onAddVoice} style={styles.add} accessibilityRole="button">
            <Icon name="mic" size={16} color={COLORS.purpleLight} />
            <Text style={styles.addText}>Voice</Text>
          </Pressable>
          <Pressable onPress={p.onAddInstrument} style={styles.add} accessibilityRole="button">
            <Icon name="piano" size={16} color={COLORS.purpleLight} />
            <Text style={styles.addText}>Instrument</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>Drag a clip to move it, drag its edges to trim, tap ×1 to loop it. Drag the playhead at the top, or tap a row, to jump there.</Text>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label="Next"
          size="lg"
          fullWidth
          disabled={project.voices.length === 0}
          onPress={p.onNext}
          accessibilityLabel="Next: hear your finished song"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 4 },
  headerSide: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.white, fontSize: 17, fontWeight: '700' },
  save: { color: COLORS.purpleNeon, fontSize: 15, fontWeight: '700' },
  saveOff: { color: COLORS.textMuted },
  subtitle: { color: COLORS.textMuted, fontSize: 11 },
  transport: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  play: { width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, borderColor: COLORS.purple, alignItems: 'center', justifyContent: 'center' },
  time: { color: COLORS.white, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  level: { color: COLORS.textMuted, fontSize: 11, fontWeight: '600', marginTop: 2, fontVariant: ['tabular-nums'] },
  master: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  masterLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700' },
  // Inset to line up with the clip rows (body padding + lane padding).
  ruler: { marginHorizontal: 26, marginBottom: 6 },
  body: { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },
  lane: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 10, gap: 8 },
  laneHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  laneName: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  laneMeta: { color: COLORS.textMuted, fontSize: 12 },
  pill: { height: 26, paddingHorizontal: 10, borderRadius: 13, flexDirection: 'row', alignItems: 'center', gap: 5 },
  pillOff: { borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.bg },
  pillText: { color: COLORS.white, fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  fxBtn: { height: 26, paddingHorizontal: 9, borderRadius: 13, borderWidth: 1, borderColor: COLORS.border, justifyContent: 'center' },
  fxBtnOn: { borderColor: COLORS.purple },
  cleanBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dim: { opacity: 0.4 },
  fxText: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  loopBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, height: 26, borderRadius: 13, borderWidth: 1, borderColor: COLORS.border },
  loopText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700' },
  volPct: { width: 40, textAlign: 'right', color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  volRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  miniGrid: { gap: 2, paddingVertical: 4 },
  miniRow: { flexDirection: 'row', gap: 2 },
  miniCell: { flex: 1, height: 6, borderRadius: 2, backgroundColor: COLORS.card },
  miniCellOn: { backgroundColor: COLORS.purple },
  drumsTap: { gap: 8 },
  adds: { flexDirection: 'row', gap: 10 },
  add: {
    flex: 1, height: 48, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: COLORS.border,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  addText: { color: COLORS.purpleLight, fontSize: 14, fontWeight: '700' },
  // 24 like Upload: an iOS page-sheet modal reaches the screen's bottom edge with no safe
  // area of its own, so a smaller gap put the button's glow on the edge (2026-10-31).
  footer: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  hint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 6 },
});
