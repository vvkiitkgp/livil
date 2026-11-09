import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AudioManager } from 'react-native-audio-api';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { COLORS } from '../../theme/colors';
import { haptics } from '../../utils/haptics';
import { TempoTracker, firstLineOffset, gridShift, tempoHint, type SungTempo } from '../../utils/tempo';
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
  /** Auto BPM: no tempo to set, Livil takes it from the first voice. Off = Set BPM (the click). */
  autoTempo: boolean;
  onAutoTempo: (on: boolean) => void;
  onClose: () => void;
  onError: (message: string) => void;
};

const BARS = 40;
const CANCELLED = 'Recording was cancelled.';

export type RecordedTake = FinishedTake;

/**
 * The tempo heard in a take. `beat` (one of its beats) and `voice` (where the singing starts)
 * are seconds into the finished take, so on the timeline they sit at `take.offset +` that.
 */
type Sung = SungTempo & { beat: number; voice: number };
/** Closer to the set tempo than this, the singer followed it: nothing to offer. */
const SAME_TEMPO = 0.015;

export function formatClock(sec: number, tenths = false): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const base = `${m}:${String(s).padStart(2, '0')}`;
  return tenths ? `${base}.${Math.floor((sec % 1) * 10)}` : base;
}

/** Record one take. Stop, Retake, or Done (→ Magic Tune). */
export function RecordPanel(props: Props) {
  const { engine, takeNumber, overBacking, onDone, onClose, onError, bpm, onBpm, metronome, onMetronome, autoTempo, onAutoTempo } = props;
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
  const tempo = useRef<TempoTracker | null>(null);
  const tempoMs = useRef(0);
  const [liveBpm, setLiveBpm] = useState<number | null>(null);
  /** The detector's running guess: on screen from the first seconds, before it is sure. */
  const [liveGuess, setLiveGuess] = useState<number | null>(null);
  const [sung, setSung] = useState<Sung | null>(null);
  /** Auto BPM listened to the whole take and found no steady pulse. */
  const [noTempo, setNoTempo] = useState(false);
  /** The take was moved so its first line starts on a bar (the card's second suggestion). */
  const [onBar, setOnBar] = useState(false);
  // Only the first voice can give the song its tempo: later ones are sung to the grid it set.
  const auto = autoTempo && !overBacking;
  const clickOn = metronome && !auto;
  // The mic hears only the voice: no click and no other tracks coming out of the speaker.
  const hearsVoice = headphones || (!clickOn && !overBacking);
  // stop() runs from timers and listeners: it reads the latest of these, not a stale closure.
  const latest = useRef({ auto, onBpm });
  latest.current = { auto, onBpm };

  const stop = useCallback(() => {
    const raw = engine.stopRecording();
    setRecording(false);
    const tracker = tempo.current;
    tempo.current = null;
    setLiveBpm(null);
    setLiveGuess(null);
    if (!raw) return;
    const heard = tracker?.finish() ?? null;
    if (tracker) console.log(`[LIVIL][TEMPO] take: ${heard ? `${heard.bpm} BPM${heard.sure ? '' : ' (from the live readings, not sure)'}, beat at ${heard.phase.toFixed(3)} s, ${heard.steady ? 'steady' : `moved ${heard.low}–${heard.high}`}` : 'no tempo heard'} · analysis ${Math.round(tempoMs.current)} ms`);
    setProcessing(raw.clicks.length > 0);
    // Let "Removing the click…" paint before the (sub-second) cleanup blocks the JS thread.
    setTimeout(() => {
      let t = finishTake(engine, raw);
      setProcessing(false);
      if (t.samples.length <= t.sampleRate * 0.3) { onError('That take was too short. Try again.'); return; }
      // finishTake cuts off whatever was recorded before the timeline's zero.
      const cut = Math.max(0, -raw.offset);
      const found: Sung | null = heard ? { ...heard, beat: heard.phase - cut, voice: Math.max(0, heard.voiceAt - cut) } : null;
      if (found?.sure && latest.current.auto) {
        // Auto BPM: the song takes the singer's tempo, and the take slides onto its beat.
        // A tempo that only held for part of the take is offered on the card instead.
        const shift = gridShift(t.offset + found.beat, found.bpm, t.offset);
        console.log(`[LIVIL][TEMPO] auto: ${found.bpm} BPM, take moved ${Math.round(shift * 1000)} ms, singing starts at ${found.voice.toFixed(2)} s`);
        t = { ...t, offset: t.offset + shift };
        latest.current.onBpm(found.bpm);
      }
      setTake(t);
      setSung(found);
      setNoTempo(!!tracker && !heard);
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
    setSung(null);
    setNoTempo(false);
    setOnBar(false);
    setElapsed(0);
    setLevels(new Array(BARS).fill(0));
  }, [stopListening]);

  const start = useCallback(async () => {
    stopListening();
    setTake(null);
    setSung(null);
    setNoTempo(false);
    setOnBar(false);
    setElapsed(0);
    setLevels(new Array(BARS).fill(0));
    setCounting(true);
    tempo.current = null;
    tempoMs.current = 0;
    // Always a count-in bar: with the metronome off it is silent and only the dots show it.
    const err = await engine.startRecording(
      rms => { pendingLevel.current = Math.max(pendingLevel.current, rms); },
      overBacking,
      true,
      hearsVoice
        ? (chunk, sampleRate) => {
          const t = Date.now();
          if (!tempo.current) tempo.current = new TempoTracker(sampleRate, bpm);
          tempo.current.push(chunk);
          tempoMs.current += Date.now() - t;
        }
        : undefined,
    );
    setCounting(false);
    if (err) { if (err !== CANCELLED) onError(err); return; }
    haptics.impact();
    startedAt.current = Date.now();
    setRecording(true);
  }, [engine, overBacking, onError, stopListening, hearsVoice, bpm]);

  /** Take the tempo from the voice, and slide the take so its beats sit on the new grid. */
  const applySungTempo = useCallback(() => {
    if (!take || !sung) return;
    const at = Math.max(0, take.offset);
    const shift = gridShift(at + sung.beat, sung.bpm, at);
    console.log(`[LIVIL][TEMPO] using ${sung.bpm} BPM, take moved ${Math.round(shift * 1000)} ms`);
    setTake({ ...take, offset: at + shift });
    setOnBar(false);
    onBpm(sung.bpm);
  }, [take, sung, onBpm]);

  /**
   * Put the first line on the first beat of a bar: crop silent lead-in, or add silence in
   * front, whichever keeps everything that was sung. Nothing is deleted: a negative offset
   * becomes the clip's trim in the Editor, where it can be dragged back out.
   */
  const startOnBar = useCallback((on: boolean) => {
    if (!take || !sung) return;
    const offset = on ? firstLineOffset(sung.beat, sung.voice, sung.bpm) : gridShift(sung.beat, sung.bpm, 0);
    console.log(`[LIVIL][TEMPO] first line ${on ? 'on a bar' : 'back on its beat'}: take offset ${offset.toFixed(2)} s (singing starts at ${sung.voice.toFixed(2)} s)`);
    setTake({ ...take, offset });
    setOnBar(on);
  }, [take, sung]);

  // Headphones decide whether the click is heard. On the phone speaker the mic would
  // record it, so there it stays silent and only the beat dots show it.
  useEffect(() => {
    let alive = true;
    const check = () => { void engine.headphonesConnected().then(h => { if (alive) setHeadphones(h); }); };
    check();
    const sub = AudioManager.addSystemEventListener('routeChange', check);
    return () => { alive = false; sub.remove(); };
  }, [engine]);
  useEffect(() => { engine.setMetronome(clickOn, headphones); }, [engine, clickOn, headphones]);
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
      setLiveBpm(tempo.current?.bpm ?? null);
      setLiveGuess(tempo.current?.guess ?? null);
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

  // Fast or slow against the tempo that was set. Auto BPM has none to be off from.
  const liveHint = recording && liveBpm != null && !auto ? tempoHint(liveBpm, bpm) : null;
  const liveLine = take || counting
    ? ''
    : !hearsVoice
      ? (recording ? '' : 'To see your tempo as you sing, turn the click off or use headphones.')
      : !recording
        ? (auto ? 'Just sing. Your tempo shows here.' : 'Your tempo shows here as you sing.')
        : liveBpm == null
          // Not sure yet: the number is shown anyway and moves until the rhythm is clear.
          ? `You: ${liveGuess ?? '--'} BPM`
          : liveHint
            ? `You: ${liveBpm} BPM · ${liveHint === 'on' ? 'on tempo' : liveHint === 'fast' ? 'a bit fast' : 'a bit slow'}`
            : `You: ${liveBpm} BPM`;
  const liveColor = liveHint ? (liveHint === 'on' ? COLORS.success : COLORS.warning) : recording && liveBpm != null ? COLORS.purpleLight : null;
  const busy = recording || counting;
  // Only the first voice can set the tempo: later it would pull the grid out from under the others.
  const sungCard = take && sung && !overBacking && !processing ? sung : null;
  const sungIsSet = !!sungCard && sungCard.bpm === bpm;
  const sungOnTempo = !!sungCard && !sungIsSet && Math.abs(sungCard.bpm / bpm - 1) < SAME_TEMPO;
  // Second suggestion, once the tempo is the singer's: first line on a bar. Negative = crop.
  const barOffset = sungCard ? firstLineOffset(sungCard.beat, sungCard.voice, sungCard.bpm) : 0;
  const barAmount = `${Math.abs(barOffset).toFixed(1)} s`;
  const canStartOnBar = sungIsSet && !onBar && !!take && Math.abs(barOffset - take.offset) >= 0.02;

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

      {/* Auto BPM has no tempo to count yet: the number and the dots keep their room, unseen. */}
      <Text style={[styles.beatBpm, auto && styles.unseen]} accessibilityElementsHidden={auto}>{`${bpm} BPM`}</Text>
      <View style={[styles.beats, auto && styles.unseen]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {[0, 1, 2, 3].map(i => {
          const on = !!beat && (beat.countIn != null ? beat.countIn - 1 === i : beat.beat === i);
          return <View key={i} style={[styles.beatDot, i === 0 && styles.beatDotOne, on && (i === 0 ? styles.beatDotAccentOn : styles.beatDotOn)]} />;
        })}
      </View>
      <Text style={[styles.liveTempo, liveColor != null && { color: liveColor }]} accessibilityLiveRegion="polite">
        {liveLine}
      </Text>

      <View style={{ flex: 1 }} />

      {takeNumber === 1 && !auto && !take && !recording && !counting && (
        <View style={styles.bpmTip} accessibilityRole="text">
          <Icon name="metronome" size={16} color={COLORS.purpleLight} />
          <Text style={styles.bpmTipText}>
            <Text style={styles.bpmTipStrong}>Set the BPM before you record. </Text>
            Beats and loops line up to it, so pick your song's tempo now. Changing it later won't speed up or slow down your voice.
            {' '}Not sure of it? Switch to Auto BPM.
          </Text>
        </View>
      )}
      {sungCard && (
        <View style={styles.sungCard}>
          <View style={styles.sungRow}>
            <Icon name={sungIsSet || sungOnTempo ? 'check' : 'metronome'} size={16} color={sungIsSet || sungOnTempo ? COLORS.success : COLORS.purpleLight} />
            <Text style={styles.bpmTipText}>
              <Text style={styles.bpmTipStrong}>
                {sungIsSet
                  ? `Beats now follow your voice at ${sungCard.bpm} BPM. `
                  : sungOnTempo
                    ? `You stayed on tempo at ${bpm} BPM. `
                    : sungCard.sure
                      ? `You sang at about ${sungCard.bpm} BPM. `
                      : `You sang at about ${sungCard.bpm} BPM for most of this take. `}
              </Text>
              {sungIsSet || sungOnTempo
                ? ''
                : 'Use it, and beats and instruments line up with your voice. Your take slides a fraction of a second to sit on the beat.'}
              {!sungOnTempo && !sungCard.steady && ` Your tempo moved between ${sungCard.low} and ${sungCard.high}, so beats may slip later in the song. Singing with the click keeps it steady.`}
              {canStartOnBar && (barOffset < 0
                ? ` Crop the first ${barAmount} of silence and your first line starts on the first beat of a bar. Nothing you sang is cut.`
                : ` Add ${barAmount} of silence in front and your first line starts on the first beat of a bar. Nothing is cut.`)}
              {sungIsSet && onBar && ` Your first line starts on the first beat of a bar (${barOffset < 0 ? `first ${barAmount} cropped` : `${barAmount} of silence added`}).`}
            </Text>
          </View>
          {!sungIsSet && !sungOnTempo && (
            <Button label={`Use ${sungCard.bpm} BPM`} onPress={applySungTempo} size="sm" fullWidth haptic="impact" />
          )}
          {canStartOnBar && <Button label={barOffset < 0 ? `Crop the first ${barAmount}` : `Add ${barAmount} in front`} onPress={() => startOnBar(true)} size="sm" fullWidth haptic="impact" />}
          {sungIsSet && onBar && <Button label="Undo" onPress={() => startOnBar(false)} size="sm" variant="secondary" fullWidth />}
        </View>
      )}
      {auto && noTempo && take && !processing && (
        <View style={styles.sungCard}>
          <View style={styles.sungRow}>
            <Icon name="info" size={16} color={COLORS.purpleLight} />
            <Text style={styles.bpmTipText}>
              <Text style={styles.bpmTipStrong}>No steady tempo found in this take. </Text>
              {`Beats stay at ${bpm} BPM. Sing a little longer, or switch to Set BPM.`}
            </Text>
          </View>
        </View>
      )}

      {!overBacking && (
        <View style={[styles.modes, busy && styles.dim]} pointerEvents={busy ? 'none' : 'auto'} accessibilityRole="radiogroup">
          <Button label="Auto BPM" size="sm" variant={auto ? 'selected' : 'secondary'} onPress={() => onAutoTempo(true)} haptic="select" style={styles.mode} />
          <Button label="Set BPM" size="sm" variant={auto ? 'secondary' : 'selected'} onPress={() => onAutoTempo(false)} haptic="select" style={styles.mode} />
        </View>
      )}
      {!auto && (
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
      )}
      {take && !take.clickReport && clickOn && !headphones && (
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
        {auto
          ? 'Just sing. Livil finds your tempo and lines the beats and instruments up to your voice.'
          : !metronome
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
  liveTempo: { alignSelf: 'center', color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'], marginTop: 10, minHeight: 18, textAlign: 'center' },
  sungCard: { gap: 12, marginBottom: 10, padding: 12, borderRadius: 14, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.purpleDim },
  sungRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  modes: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  mode: { flex: 1 },
  unseen: { opacity: 0 },
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
