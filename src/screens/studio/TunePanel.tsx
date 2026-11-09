import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { GradientFill } from '../../components/GradientFill';
import { Icon } from '../../components/Icon';
import { COLORS } from '../../theme/colors';
import {
  analyzeTake,
  applyMagicTune,
  CHROMATIC,
  keyName,
  sameKey,
  strengthLabel,
  type Key,
  type TuneAnalysis,
  type TuneCurve,
} from '../../utils/magicTune';
import { CLEAN_VERSION, cleanTake } from '../../utils/audioClean';
import { MagicButton } from './MagicButton';
import { PitchTrail } from './PitchTrail';
import { formatClock } from './RecordPanel';
import { StudioSlider } from './StudioSlider';
import type { StudioEngine, TuneChoice } from './studioEngine';

export const DEFAULT_STRENGTH = 0.7;

type Props = {
  engine: StudioEngine;
  /** The take as recorded (before cleanup). */
  take: { samples: Float32Array; sampleRate: number };
  /** Header title, e.g. "Take 2" or "Voice 2". */
  title: string;
  /**
   * Reopening a voice from the Editor: its last settings, and its already-cleaned audio (so
   * cleanup doesn't run again). The panel skips the question and opens on the controls.
   */
  editing?: { choice: TuneChoice; cleaned: Float32Array | null };
  onBack: () => void;
  /**
   * `base` is the take the Editor plays as "raw" (background-cleaned when that is on).
   * `tuned` is kept even when the user keeps it raw, so the Editor's switch is instant.
   */
  onNext: (result: { base: Float32Array; tuned: Float32Array | null; tuneOn: boolean; choice: TuneChoice }) => void;
};

type Phase = 'ask' | 'busy' | 'ready';

/** The "Magic Tune this take?" screen: process in place, listen, compare, choose. */
export function TunePanel({ engine, take, title, editing, onBack, onNext }: Props) {
  const [phase, setPhase] = useState<Phase>(editing ? 'busy' : 'ask');
  const [progress, setProgress] = useState(0);
  const [analysis, setAnalysis] = useState<TuneAnalysis | null>(null);
  const [key, setKey] = useState<Key | null>(null);
  const [strength, setStrength] = useState(editing?.choice.strength ?? DEFAULT_STRENGTH);
  const [applied, setApplied] = useState<{ tuned: Float32Array; curve: TuneCurve } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [barW, setBarW] = useState(0);
  const [cleanOn, setCleanOn] = useState(editing?.choice.clean ?? true);
  const [busyLabel, setBusyLabel] = useState('Finding your notes…');
  const cleaned = useRef<Float32Array | null>(editing?.cleaned ?? null);
  const base = useRef<Float32Array>(take.samples);
  const preview = useRef<{ setRaw: (on: boolean) => void; stop: () => void; position: () => number } | null>(null);
  /** Playhead in seconds: where play starts from, and where playback is while playing. */
  const [pos, setPos] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const holding = useRef(false);

  const stopPreview = useCallback(() => {
    if (preview.current) setPos(preview.current.position());
    preview.current?.stop();
    preview.current = null;
    setPlaying(false);
  }, []);
  useEffect(() => stopPreview, [stopPreview]);

  /** The take with or without background cleanup; the cleanup runs once and is cached. */
  const baseFor = useCallback(async (clean: boolean): Promise<Float32Array> => {
    if (!clean) return take.samples;
    if (!cleaned.current) {
      setBusyLabel('Cleaning up background…');
      setProgress(0);
      const t = Date.now();
      cleaned.current = await cleanTake(take.samples, take.sampleRate, setProgress);
      console.log(`[LIVIL][CLEANUP] ${(take.samples.length / take.sampleRate).toFixed(1)} s take cleaned in ${Date.now() - t} ms`);
    }
    return cleaned.current;
  }, [take]);

  const start = useCallback(async () => {
    setPhase('busy');
    setProgress(0);
    const t0 = Date.now();
    base.current = await baseFor(cleanOn);
    setBusyLabel('Finding your notes…');
    setProgress(0);
    const a = await analyzeTake(base.current, take.sampleRate, setProgress);
    const best = editing?.choice.key ?? a.keys[0] ?? CHROMATIC;
    const res = applyMagicTune(base.current, a, { key: best, strength });
    setElapsedMs(Date.now() - t0);
    console.log(`[LIVIL][MAGICTUNE] ${(take.samples.length / take.sampleRate).toFixed(1)} s take processed in ${Date.now() - t0} ms, key ${keyName(best)}`);
    setAnalysis(a);
    setKey(best);
    setApplied(res);
    setPhase('ready');
  }, [take, baseFor, cleanOn, editing, strength]);

  // Reopened from the Editor: go straight to the controls with the voice's settings.
  useEffect(() => {
    if (editing) void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-tune when the key or the slider (on release) changes.
  const retune = useCallback((k: Key, s: number) => {
    if (!analysis) return;
    stopPreview();
    setApplied(applyMagicTune(base.current, analysis, { key: k, strength: s }));
  }, [analysis, stopPreview]);

  const toggleClean = useCallback(async (on: boolean) => {
    setCleanOn(on);
    if (phase !== 'ready' || !analysis || !key) return;
    stopPreview();
    setPhase('busy');
    base.current = await baseFor(on);
    setApplied(applyMagicTune(base.current, analysis, { key, strength }));
    setPhase('ready');
  }, [phase, analysis, key, strength, baseFor, stopPreview]);

  const keepRaw = useCallback(async () => {
    setPhase('busy');
    const b = await baseFor(cleanOn);
    onNext({ base: b, tuned: null, tuneOn: false, choice: { key: null, strength, clean: cleanOn, cleanVersion: CLEAN_VERSION } });
  }, [baseFor, cleanOn, strength, onNext]);

  /**
   * Next / Keep it raw instead. Opening the Editor blocks the JS thread for a moment (seconds
   * on an old phone), so the tapped button shows its spinner first: without it the screen
   * looked stuck. A ref guards it, because taps queue up while the phone is busy.
   */
  const leavingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [leaving, setLeaving] = useState<'tuned' | 'raw' | null>(null);
  useEffect(() => () => { if (leavingRef.current) clearTimeout(leavingRef.current); }, []);
  const finish = useCallback((tuneOn: boolean) => {
    if (leavingRef.current) return;
    stopPreview();
    setLeaving(tuneOn ? 'tuned' : 'raw');
    const result = { base: base.current, tuned: applied?.tuned ?? null, tuneOn, choice: { key, strength, clean: cleanOn, cleanVersion: CLEAN_VERSION } };
    // Let the spinner paint before the Editor's first render takes the thread.
    leavingRef.current = setTimeout(() => onNext(result), 50);
  }, [stopPreview, applied, key, strength, cleanOn, onNext]);

  const playFrom = useCallback(async (from: number) => {
    const duration = take.samples.length / take.sampleRate;
    const start = from >= duration - 0.05 ? 0 : from;
    preview.current?.stop();
    preview.current = await engine.previewAB(take.samples, applied?.tuned ?? null, take.sampleRate, () => {
      preview.current = null;
      setPlaying(false);
      setPos(0);
    }, start);
    preview.current.setRaw(holding.current);
    setPos(start);
    setPlaying(true);
  }, [engine, take, applied]);

  const togglePlay = useCallback(async () => {
    if (playing) { stopPreview(); return; }
    await playFrom(pos);
  }, [playing, pos, playFrom, stopPreview]);

  /** The seek bar / a tap on the trail: jump there, and keep playing if it was. */
  const seek = useCallback((sec: number) => {
    setPos(sec);
    if (playing) void playFrom(sec);
  }, [playing, playFrom]);

  // Move the playhead while playing (not while the finger is on the seek bar).
  useEffect(() => {
    if (!playing || scrubbing) return;
    const id = setInterval(() => { if (preview.current) setPos(preview.current.position()); }, 50);
    return () => clearInterval(id);
  }, [playing, scrubbing]);

  const holdRaw = useCallback(async (on: boolean) => {
    holding.current = on;
    if (on && !preview.current) await togglePlay();
    preview.current?.setRaw(on);
  }, [togglePlay]);

  const chips: Key[] = analysis ? [...analysis.keys.slice(0, 4), CHROMATIC] : [];
  // A key picked earlier that isn't in the top four still shows, first.
  if (key && !chips.some(k => sameKey(k, key))) chips.unshift(key);
  const duration = take.samples.length / take.sampleRate;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { stopPreview(); onBack(); }} style={styles.headerSide} accessibilityLabel={editing ? 'Back to the Editor' : 'Back to recorder'} hitSlop={10}>
          <Icon name="back" size={22} color={COLORS.white} />
        </TouchableOpacity>
        <Text style={styles.title}>{`${title} · ${formatClock(duration)}`}</Text>
        <View style={styles.headerSide} />
      </View>

      <ScrollView contentContainerStyle={styles.body} bounces={false}>
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>
              {phase === 'ready' ? `Magic Tuned · ${key ? keyName(key) : ''}` : phase === 'busy' ? 'Listening to your take…' : 'Your take'}
            </Text>
            {phase === 'ready' && <Text style={styles.cardMeta}>{`${(elapsedMs / 1000).toFixed(1)} s on this phone`}</Text>}
          </View>
          <PitchTrail
            sung={applied?.curve.sungMidi ?? null}
            tuned={applied?.curve.tunedMidi ?? null}
            musicKey={key}
            playhead={phase === 'ready' ? pos / duration : null}
            onSeek={phase === 'ready' ? f => seek(f * duration) : undefined}
          />
          <View style={styles.legend}>
            <View style={styles.legendItem}><View style={[styles.swatch, { backgroundColor: COLORS.textMuted }]} /><Text style={styles.legendText}>Your take</Text></View>
            <View style={styles.legendItem}>
              <View style={[styles.swatch, { overflow: 'hidden' }]}><GradientFill width={14} height={3} /></View>
              <Text style={styles.legendText}>Magic Tuned</Text>
            </View>
          </View>
        </View>

        {phase !== 'busy' && (
          <View style={styles.cleanRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.cleanTitle}>Clean up background</Text>
              <Text style={styles.cleanBody}>Removes fan, AC and room hum, and quiets the gaps between lines</Text>
            </View>
            <Switch
              value={cleanOn}
              onValueChange={v => void toggleClean(v)}
              trackColor={{ false: COLORS.inputBg, true: COLORS.purple }}
              thumbColor={COLORS.white}
              ios_backgroundColor={COLORS.inputBg}
              accessibilityLabel="Clean up background"
            />
          </View>
        )}

        {phase === 'ask' && (
          <View style={styles.ask}>
            <Text style={styles.askTitle}>Magic Tune this take?</Text>
            <Text style={styles.askBody}>Snaps every note of your voice to the key. From a gentle polish to full robot.</Text>
          </View>
        )}

        {phase === 'busy' && (
          <View style={styles.ask}>
            <Text style={styles.busyTitle}>{busyLabel}</Text>
            <Text style={styles.askBody}>On your phone, nothing uploaded</Text>
            <View style={styles.progress} onLayout={e => setBarW(Math.floor(e.nativeEvent.layout.width))}>
              <View style={{ width: progress * barW, height: 6, borderRadius: 3, overflow: 'hidden' }}>
                <GradientFill width={barW} height={6} borderRadius={3} />
              </View>
            </View>
          </View>
        )}

        {phase === 'ready' && (
          <View style={styles.ready}>
            <Text style={styles.label}>Key</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {chips.map(k => {
                const on = !!key && sameKey(k, key);
                return (
                  <Pressable
                    key={keyName(k)}
                    onPress={() => { setKey(k); retune(k, strength); }}
                    style={[styles.chip, on && styles.chipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{keyName(k)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.strengthHead}>
              <Text style={styles.label}>Natural</Text>
              <Text style={styles.strengthNow}>{strengthLabel(strength)}</Text>
              <Text style={styles.label}>Robot</Text>
            </View>
            <StudioSlider
              value={strength}
              onChange={setStrength}
              onDone={s => key && retune(key, s)}
              accessibilityLabel="Magic Tune strength, from natural to robot"
            />

            <View style={styles.listenRow}>
              <Pressable
                onPress={() => void togglePlay()}
                style={({ pressed }) => [styles.play, pressed && { opacity: 0.8 }]}
                accessibilityRole="button"
                accessibilityLabel={playing ? 'Stop' : 'Play the Magic Tuned take'}
              >
                <Icon name={playing ? 'pause' : 'play'} size={20} color={COLORS.purpleNeon} weight="fill" />
              </Pressable>
              <Pressable
                onPressIn={() => void holdRaw(true)}
                onPressOut={() => void holdRaw(false)}
                style={({ pressed }) => [styles.hold, pressed && styles.holdOn]}
                accessibilityRole="button"
                accessibilityLabel="Hold to hear the raw take"
              >
                <Icon name="eye" size={16} color={COLORS.white} />
                <Text style={styles.holdText}>Hold to hear the raw take</Text>
              </Pressable>
            </View>

            <View style={styles.seekRow}>
              <Text style={styles.seekTime}>{formatClock(pos)}</Text>
              <StudioSlider
                compact
                value={pos}
                max={duration}
                onChange={v => { setScrubbing(true); setPos(v); }}
                onDone={v => { setScrubbing(false); seek(v); }}
                accessibilityLabel="Position in the take"
                style={{ flex: 1 }}
              />
              <Text style={styles.seekTime}>{formatClock(duration)}</Text>
            </View>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {phase === 'ask' && (
          <>
            <MagicButton label="Magic Tune my voice" onPress={() => void start()} />
            <Button label="Keep it raw" variant="ghost" onPress={() => void keepRaw()} />
          </>
        )}
        {phase === 'ready' && (
          <>
            <Button label={editing ? 'Done' : 'Next'} size="lg" fullWidth busy={leaving === 'tuned'} disabled={leaving === 'raw'} onPress={() => finish(true)} />
            <Button label="Keep it raw instead" variant="ghost" busy={leaving === 'raw'} disabled={leaving === 'tuned'} onPress={() => finish(false)} />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 4 },
  headerSide: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.white, fontSize: 17, fontWeight: '700' },
  body: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, gap: 18 },
  card: { backgroundColor: COLORS.surface, borderRadius: 18, padding: 12, gap: 8 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  cardTitle: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700' },
  cardMeta: { color: COLORS.textMuted, fontSize: 11 },
  legend: { flexDirection: 'row', gap: 14, paddingHorizontal: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 14, height: 3, borderRadius: 2 },
  legendText: { color: COLORS.textMuted, fontSize: 11 },
  ask: { alignItems: 'center', gap: 10, marginTop: 8 },
  askTitle: { color: COLORS.white, fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  busyTitle: { color: COLORS.white, fontSize: 20, fontWeight: '800' },
  askBody: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 300 },
  progress: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: COLORS.card, overflow: 'hidden', marginTop: 8 },
  ready: { gap: 12 },
  label: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700' },
  chips: { gap: 8 },
  chip: { height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: COLORS.surface, borderWidth: 1.5, borderColor: COLORS.border, justifyContent: 'center' },
  chipOn: { borderColor: COLORS.purple },
  chipText: { color: COLORS.white, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: COLORS.purpleNeon },
  strengthHead: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  strengthNow: { color: COLORS.purpleLight, fontSize: 12, fontWeight: '700' },
  listenRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 4 },
  play: { width: 52, height: 52, borderRadius: 26, borderWidth: 1.5, borderColor: COLORS.purple, alignItems: 'center', justifyContent: 'center' },
  hold: {
    flex: 1, height: 52, borderRadius: 26, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  holdOn: { borderColor: COLORS.purpleLight },
  holdText: { color: COLORS.white, fontSize: 14, fontWeight: '600' },
  seekRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  seekTime: { color: COLORS.textSecondary, fontSize: 12, fontVariant: ['tabular-nums'], minWidth: 34, textAlign: 'center' },
  cleanRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.surface, borderRadius: 14, padding: 12 },
  cleanTitle: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  cleanBody: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 16 },
  footer: { paddingHorizontal: 20, paddingBottom: 24, gap: 6 }, // see EditorPanel's footer
});
