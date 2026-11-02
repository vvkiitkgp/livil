import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AudioManager } from 'react-native-audio-api';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../components/Icon';
import { COLORS } from '../../theme/colors';
import { haptics } from '../../utils/haptics';
import { MAX_TRACK_SECONDS } from '../../../shared/constants/media';
import { BpmStepper } from './BpmStepper';
import type { StudioEngine } from './studioEngine';
import { finishTake, type FinishedTake } from './finishTake';
import { MicPicker } from './MicPicker';

type Props = {
  engine: StudioEngine;
  takeNumber: number;
  /** The project's other tracks play underneath (Add voice). */
  overBacking: boolean;
  onDone: (take: RecordedTake) => void;
  bpm: number;
  onBpm: (bpm: number) => void;
  metronome: boolean;
  onMetronome: (on: boolean) => void;
  onClose: () => void;
  onError: (message: string) => void;
};

const BARS = 40;
const CANCELLED = 'Recording was cancelled.';

export type RecordedTake = FinishedTake;

export function formatClock(sec: number, tenths = false): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const base = `${m}:${String(s).padStart(2, '0')}`;
  return tenths ? `${base}.${Math.floor((sec % 1) * 10)}` : base;
}

/** Record one take. Stop, Retake, or Done (→ Magic Tune). */
export function RecordPanel(props: Props) {
  const { engine, takeNumber, overBacking, onDone, onClose, onError, bpm, onBpm, metronome, onMetronome } = props;
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => new Array(BARS).fill(0));
  const [take, setTake] = useState<RecordedTake | null>(null);
  const [counting, setCounting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [listening, setListening] = useState(false);
  const [listenSec, setListenSec] = useState(0);
  const listenRef = useRef<{ stop: () => void; position: () => number } | null>(null);
  const listenStarted = useRef(0);
  const [beat, setBeat] = useState<{ countIn: number | null; beat: number } | null>(null);
  const [headphones, setHeadphones] = useState(false);
  const startedAt = useRef(0);
  const pendingLevel = useRef(0);

  const stop = useCallback(() => {
    const raw = engine.stopRecording();
    setRecording(false);
    if (!raw) return;
    setProcessing(raw.clicks.length > 0);
    // Let "Removing the click…" paint before the (sub-second) cleanup blocks the JS thread.
    setTimeout(() => {
      const t = finishTake(engine, raw);
      setProcessing(false);
      if (t.samples.length > t.sampleRate * 0.3) setTake(t);
      else onError('That take was too short. Try again.');
    }, 30);
  }, [engine, onError]);

  const stopListening = useCallback(() => {
    listenRef.current?.stop();
    listenRef.current = null;
    setListening(false);
  }, []);
  useEffect(() => stopListening, [stopListening]);

  /** Play the take back before deciding: keep it (Done) or Retake. */
  const toggleListen = useCallback(async () => {
    if (listening) { stopListening(); return; }
    if (!take) return;
    listenRef.current = await engine.previewAB(take.samples, null, take.sampleRate, () => {
      listenRef.current = null;
      setListening(false);
    });
    listenStarted.current = Date.now();
    setListenSec(0);
    setListening(true);
  }, [listening, take, engine, stopListening]);

  useEffect(() => {
    if (!listening) return;
    const id = setInterval(() => setListenSec((Date.now() - listenStarted.current) / 1000), 100);
    return () => clearInterval(id);
  }, [listening]);

  /** Throw the take away and wait for the record button (no surprise auto-start). */
  const retake = useCallback(() => {
    stopListening();
    setTake(null);
    setElapsed(0);
    setLevels(new Array(BARS).fill(0));
  }, [stopListening]);

  const start = useCallback(async () => {
    stopListening();
    setTake(null);
    setElapsed(0);
    setLevels(new Array(BARS).fill(0));
    setCounting(true);
    // Always a count-in bar: with the metronome off it is silent and only the dots show it.
    const err = await engine.startRecording(
      rms => { pendingLevel.current = Math.max(pendingLevel.current, rms); },
      overBacking,
      true,
    );
    setCounting(false);
    if (err) { if (err !== CANCELLED) onError(err); return; }
    haptics.impact();
    startedAt.current = Date.now();
    setRecording(true);
  }, [engine, overBacking, onError, stopListening]);

  // Headphones decide whether the click is heard. On the phone speaker the mic would
  // record it, so there it stays silent and only the beat dots show it.
  useEffect(() => {
    let alive = true;
    const check = () => { void engine.headphonesConnected().then(h => { if (alive) setHeadphones(h); }); };
    check();
    const sub = AudioManager.addSystemEventListener('routeChange', check);
    return () => { alive = false; sub.remove(); };
  }, [engine]);
  useEffect(() => { engine.setMetronome(metronome, headphones); }, [engine, metronome, headphones]);
  // The click belongs to recording only: the Editor's playback never ticks.
  useEffect(() => () => engine.setMetronome(false, false), [engine]);

  // Visual beat while counting in or recording — metronome on or off (off = dots only).
  useEffect(() => {
    if (!recording && !counting) { setBeat(null); return; }
    let lastCount: number | null = null;
    const id = setInterval(() => {
      const b = engine.beatState();
      // Feel the count-in: a heavy tap on the 1, lighter on 2-3-4 (the take's start is the
      // impact fired in start()).
      const c = b?.countIn ?? null;
      if (c != null && c !== lastCount) { if (c === 1) haptics.impact(); else haptics.tap(); }
      lastCount = c;
      setBeat(prev => (prev?.countIn === b?.countIn && prev?.beat === b?.beat ? prev : b));
    }, 30);
    return () => clearInterval(id);
  }, [engine, recording, counting]);

  // Clock + level meter at ~12 fps; the 15:00 cap stops the take by itself.
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      const sec = (Date.now() - startedAt.current) / 1000;
      setElapsed(sec);
      const lvl = Math.min(1, pendingLevel.current * 6);
      pendingLevel.current = 0;
      setLevels(prev => [...prev.slice(1), lvl]);
      if (sec >= MAX_TRACK_SECONDS) stop();
    }, 80);
    return () => clearInterval(id);
  }, [recording, stop]);

  // Leaving the app stops the take and keeps what was recorded (ADR-0034).
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s !== 'active' && engine.isRecording) stop(); });
    return () => sub.remove();
  }, [engine, stop]);

  useEffect(() => () => { if (engine.isRecording) engine.stopRecording(); }, [engine]);

  const duration = take ? take.samples.length / take.sampleRate : elapsed;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.headerSide} accessibilityLabel="Close" hitSlop={10}>
          <Icon name="close" size={22} color={COLORS.white} />
        </TouchableOpacity>
        <Text style={styles.title}>Record</Text>
        <View style={styles.headerSide} />
      </View>
      <MicPicker engine={engine} disabled={recording || counting} />

      <View style={styles.clockWrap}>
        {beat?.countIn != null ? (
          <Text style={[styles.clock, { color: COLORS.purpleNeon }]} accessibilityLiveRegion="assertive">{String(beat.countIn)}</Text>
        ) : (
          <Text style={styles.clock}>{formatClock(duration, true)}</Text>
        )}
        <Text style={styles.sub}>{`of ${formatClock(MAX_TRACK_SECONDS)} · Take ${takeNumber}`}</Text>
      </View>

      <View style={styles.meter} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {levels.map((l, i) => (
          <View
            key={i}
            style={[styles.bar, {
              height: 8 + l * 150,
              backgroundColor: recording ? (i % 7 === 0 ? COLORS.purpleNeon : COLORS.purple) : COLORS.purpleDeep,
            }]}
          />
        ))}
      </View>

      <View style={styles.status}>
        {processing ? (
          <Text style={styles.statusText}>Removing the click from your voice…</Text>
        ) : counting ? (
          <Text style={styles.statusText}>Get ready… recording starts after the count</Text>
        ) : recording ? (
          <View style={styles.row}>
            <View style={styles.dot} />
            <Text style={styles.statusText}>Listening… tap the button to stop</Text>
          </View>
        ) : take ? (
          <Pressable
            onPress={() => void toggleListen()}
            style={({ pressed }) => [styles.listen, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={listening ? 'Stop listening' : 'Listen to this take'}
          >
            <Icon name={listening ? 'pause' : 'play'} size={16} color={COLORS.purpleNeon} weight="fill" />
            <Text style={styles.listenText}>
              {listening ? `Listening · ${formatClock(Math.min(listenSec, duration))} / ${formatClock(duration)}` : `Listen to take ${takeNumber} · ${formatClock(duration)}`}
            </Text>
          </Pressable>
        ) : (
          <Text style={styles.statusText}>Tap the red button to start</Text>
        )}
      </View>

      <Text style={styles.beatBpm}>{`${bpm} BPM`}</Text>
      <View style={styles.beats} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {[0, 1, 2, 3].map(i => {
          const on = !!beat && (beat.countIn != null ? beat.countIn - 1 === i : beat.beat === i);
          return <View key={i} style={[styles.beatDot, i === 0 && styles.beatDotOne, on && (i === 0 ? styles.beatDotAccentOn : styles.beatDotOn)]} />;
        })}
      </View>

      <View style={{ flex: 1 }} />

      {takeNumber === 1 && !take && !recording && !counting && (
        <View style={styles.bpmTip} accessibilityRole="text">
          <Icon name="metronome" size={16} color={COLORS.purpleLight} />
          <Text style={styles.bpmTipText}>
            <Text style={styles.bpmTipStrong}>Set the BPM before you record. </Text>
            Beats and loops line up to it, so pick your song's tempo now. Changing it later won't speed up or slow down your voice.
          </Text>
        </View>
      )}

      <View style={styles.metro}>
        <Pressable
          onPress={() => onMetronome(!metronome)}
          disabled={recording || counting}
          style={[styles.metroToggle, metronome && styles.metroToggleOn, (recording || counting) && styles.dim]}
          accessibilityRole="switch"
          accessibilityState={{ checked: metronome, disabled: recording || counting }}
          accessibilityLabel="Metronome"
        >
          <Icon name="metronome" size={16} color={metronome ? COLORS.purpleNeon : COLORS.textSecondary} />
          <Text style={[styles.metroText, metronome && { color: COLORS.purpleNeon }]}>{metronome ? 'Click on' : 'Click off'}</Text>
        </Pressable>
        <BpmStepper bpm={bpm} onBpm={onBpm} disabled={recording || counting} />
      </View>
      {take && !take.clickReport && metronome && !headphones && (
        <Text style={styles.debug}>Click remover did not run: no speaker clicks were logged</Text>
      )}
      {take?.clickReport && (
        // PROTOTYPE readout: tells us on a real phone whether the click remover found the
        // count-in and how much it took out. Remove before the feature ships.
        <Text style={styles.debug}>
          {take.clickReport.skipped
            ? `Click remover skipped: ${take.clickReport.skipped}`
            : `Click remover: ${take.clickReport.removed} clicks · timing ${take.clickReport.lagMs} ms · learned ${take.clickReport.learned.accent}+${take.clickReport.learned.beat} · −${take.clickReport.reductionDb} dB`}
        </Text>
      )}
      <Text style={styles.metroNote}>
        {!metronome
          ? 'Click off: no sound, just follow the dots to stay on the beat.'
          : headphones
            ? 'You hear the click in your headphones. The mic records only your voice.'
            : 'The click plays on the speaker. Livil removes it from your voice after the take, so keep the phone still and the volume low.'}
      </Text>

      <View style={styles.controls}>
        <Pressable
          onPress={() => { haptics.tap(); retake(); }}
          disabled={recording || counting || !take}
          style={({ pressed }) => [styles.side, (recording || !take) && styles.dim, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Retake"
        >
          <Icon name="repeat" size={18} color={COLORS.white} />
          <Text style={styles.sideLabel}>Retake</Text>
        </Pressable>

        <Pressable
          onPress={() => { haptics.tap(); if (recording) stop(); else if (counting) engine.stop(); else void start(); }}
          style={({ pressed }) => [styles.recBtn, recording && styles.recBtnOn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Stop recording' : counting ? 'Cancel the count-in' : 'Start recording'}
        >
          <View style={recording || counting ? styles.recCoreStop : styles.recCore} />
        </Pressable>

        <Pressable
          onPress={() => { haptics.success(); stopListening(); if (take) onDone(take); }}
          disabled={!take || recording || processing}
          style={({ pressed }) => [styles.side, styles.doneBtn, (!take || recording) && styles.dim, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Use this take"
        >
          <Icon name="check" size={18} color={COLORS.purpleNeon} />
          <Text style={[styles.sideLabel, { color: COLORS.purpleNeon, fontWeight: '700' }]}>Done</Text>
        </Pressable>
      </View>

      <Text style={styles.foot}>
        {overBacking
          ? 'Your other tracks play while you record. Use headphones so they stay out of this take.'
          : 'Your music is paused while you record. Headphones recommended.'}
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 },
  headerSide: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.white, fontSize: 17, fontWeight: '700' },
  clockWrap: { alignItems: 'center', gap: 6, marginTop: 20 },
  clock: { color: COLORS.white, fontSize: 56, fontWeight: '700', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  sub: { color: COLORS.textSecondary, fontSize: 13 },
  meter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, height: 170, marginTop: 16 },
  bar: { width: 5, borderRadius: 3 },
  status: { alignItems: 'center', marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.error },
  statusText: { color: COLORS.textSecondary, fontSize: 13 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 40 },
  side: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  doneBtn: { borderColor: COLORS.purple, borderWidth: 1.5 },
  sideLabel: { color: COLORS.white, fontSize: 10 },
  dim: { opacity: 0.35 },
  pressed: { opacity: 0.8 },
  recBtn: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: COLORS.surface, borderWidth: 2, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  recBtnOn: { borderColor: COLORS.error, shadowColor: COLORS.error, shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 0 } },
  recCore: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.error },
  recCoreStop: { width: 30, height: 30, borderRadius: 6, backgroundColor: COLORS.error },
  beats: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 6, height: 16, alignItems: 'center' },
  beatDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.card },
  beatDotOne: { width: 14, height: 14, borderRadius: 7 },
  beatDotOn: { backgroundColor: COLORS.purpleLight },
  beatDotAccentOn: { backgroundColor: COLORS.purpleNeon },
  metro: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  metroToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: 18,
    borderWidth: 1, borderColor: COLORS.border,
  },
  metroToggleOn: { borderColor: COLORS.purple },
  metroText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '700' },
  beatBpm: { alignSelf: 'center', color: COLORS.purpleLight, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 18 },
  bpmTip: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 10, padding: 12,
    borderRadius: 14, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.purpleDim,
  },
  bpmTipText: { flex: 1, color: COLORS.textSecondary, fontSize: 13, lineHeight: 18 },
  bpmTipStrong: { color: COLORS.white, fontWeight: '700' },
  metroNote: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 16 },
  listen: {
    flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 16, borderRadius: 20,
    borderWidth: 1.5, borderColor: COLORS.purple,
  },
  listenText: { color: COLORS.purpleNeon, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  debug: { color: COLORS.warning, fontSize: 11, textAlign: 'center', marginBottom: 8, fontVariant: ['tabular-nums'] },
  foot: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center', marginTop: 20, marginBottom: 24 }, // see EditorPanel's footer
});
