import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { COLORS } from '../../theme/colors';
import { formatClock } from './RecordPanel';
import type { Mix } from './renderMix';
import type { Project, StudioEngine } from './studioEngine';
import { StudioSlider } from './StudioSlider';

const BARS = 64;

type Props = {
  engine: StudioEngine;
  project: Project;
  /** The rendered song; null while it is being mixed. */
  mix: Mix | null;
  /** Mixing + mastering progress while `mix` is null, 0..1. */
  mixProgress: number;
  busy: string | null;
  onBack: () => void;
  onSaveDraft: () => void;
  onCreatePost: () => void;
};

/**
 * "Your song": the finished mix exactly as it will be posted, to listen to before choosing
 * Save draft or Create post.
 */
export function FinalPanel({ engine, project, mix, mixProgress, busy, onBack, onSaveDraft, onCreatePost }: Props) {
  const preview = useRef<{ stop: () => void; position: () => number } | null>(null);
  const [playing, setPlaying] = useState(false);
  /** A tap is starting playback (the first one can take a moment while audio wakes up). */
  const [starting, setStarting] = useState(false);
  const tapGen = useRef(0);
  /** The song is loaded and the audio awake: Play starts at once. */
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    if (!mix) return;
    let alive = true;
    const done = () => { if (alive) setReady(true); };
    // Never wait forever on the audio waking up: after 3 s, Play and Create post work anyway
    // (playing retries the wake-up itself).
    const timer = setTimeout(() => { console.log('[LIVIL][STUDIO] preview still not ready after 3 s'); done(); }, 3000);
    engine.preparePreview(mix.channels[0], mix.sampleRate)
      .catch(e => console.log('[LIVIL][STUDIO] preview prepare failed', e))
      .finally(() => { clearTimeout(timer); done(); });
    return () => { alive = false; clearTimeout(timer); };
  }, [engine, mix]);
  const [pos, setPos] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const duration = mix?.seconds ?? 0;

  const stop = useCallback(() => {
    tapGen.current++; // a start still in flight lands stopped
    setStarting(false);
    if (preview.current) setPos(preview.current.position());
    preview.current?.stop();
    preview.current = null;
    setPlaying(false);
  }, []);
  useEffect(() => stop, [stop]);

  const playFrom = useCallback(async (from: number) => {
    if (!mix) return;
    const gen = ++tapGen.current;
    preview.current?.stop();
    preview.current = null;
    const start = from >= duration - 0.05 ? 0 : from;
    setStarting(true);
    const handle = await engine.previewAB(mix.channels[0], null, mix.sampleRate, () => {
      if (preview.current !== handle) return;
      preview.current = null;
      setPlaying(false);
      setPos(0);
    }, start);
    // Paused or tapped again while this was starting: this one never plays.
    if (gen !== tapGen.current) { handle.stop(); return; }
    preview.current = handle;
    setStarting(false);
    setPos(start);
    setPlaying(true);
  }, [engine, mix, duration]);

  useEffect(() => {
    if (!playing || scrubbing) return;
    const id = setInterval(() => { if (preview.current) setPos(preview.current.position()); }, 50);
    return () => clearInterval(id);
  }, [playing, scrubbing]);

  const bars = useMemo(() => {
    if (!mix) return [];
    const x = mix.channels[0];
    const per = Math.max(1, Math.floor(x.length / BARS));
    const out: number[] = [];
    let max = 1e-6;
    for (let b = 0; b < BARS; b++) {
      let m = 0;
      for (let i = b * per; i < Math.min(x.length, (b + 1) * per); i += 8) m = Math.max(m, Math.abs(x[i]));
      out.push(m);
      max = Math.max(max, m);
    }
    return out.map(v => v / max);
  }, [mix]);

  const tuned = project.voices.some(v => v.tuneOn && v.take.tuned);
  const facts = [
    `${project.voices.length} ${project.voices.length === 1 ? 'voice' : 'voices'}`,
    `${project.bpm} BPM`,
    ...(tuned ? ['Magic Tuned'] : []),
    'Lossless',
  ].join(' · ');

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { stop(); onBack(); }} style={styles.headerSide} accessibilityLabel="Back to the Editor" hitSlop={10}>
          <Icon name="back" size={22} color={COLORS.white} />
        </TouchableOpacity>
        <Text style={styles.title}>Your song</Text>
        <View style={styles.headerSide} />
      </View>

      <View style={styles.body}>
        {!mix ? (
          <View style={styles.mixing}>
            <ActivityIndicator color={COLORS.purpleNeon} />
            <Text style={styles.mixingText}>{mixProgress < 0.3 ? 'Mixing your song…' : `Mastering your song… ${Math.round(mixProgress * 100)}%`}</Text>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.wave} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {bars.map((v, i) => (
                <View
                  key={i}
                  style={[styles.bar, { height: 6 + v * 90 }, duration > 0 && i / BARS < pos / duration ? styles.barPlayed : null]}
                />
              ))}
            </View>
            <View style={styles.controls}>
              <Pressable
                disabled={!ready}
                onPress={() => (playing || starting ? stop() : void playFrom(pos))}
                style={({ pressed }) => [styles.play, pressed && { opacity: 0.8 }]}
                accessibilityRole="button"
                accessibilityLabel={!ready ? 'Getting your song ready' : playing || starting ? 'Pause' : 'Play your song'}
              >
                {starting || !ready
                  ? <ActivityIndicator color={COLORS.purpleNeon} />
                  : <Icon name={playing ? 'pause' : 'play'} size={24} color={COLORS.purpleNeon} weight="fill" />}
              </Pressable>
              <View style={styles.seek}>
                <StudioSlider
                  compact
                  value={pos}
                  max={Math.max(0.01, duration)}
                  onChange={v => { setScrubbing(true); setPos(v); }}
                  onDone={v => { setScrubbing(false); setPos(v); if (playing) void playFrom(v); }}
                  accessibilityLabel="Position in your song"
                />
                <View style={styles.times}>
                  <Text style={styles.time}>{formatClock(pos)}</Text>
                  <Text style={styles.time}>{formatClock(duration)}</Text>
                </View>
              </View>
            </View>
            <Text style={styles.facts}>{facts}</Text>
          </View>
        )}
        <Text style={styles.note}>This is exactly what will be posted. Go back to change anything.</Text>
      </View>

      <View style={styles.footer}>
        {/* Both wait until the song is ready: a Create post tapped while it was still loading
            fired once loading finished, cutting the song off after a second (2026-10-31). */}
        <Button
          label={!mix || !ready ? 'Getting your song ready…' : 'Create post'}
          size="lg"
          fullWidth
          disabled={!mix || !ready || !!busy}
          onPress={() => { console.log('[LIVIL][POST] Create post pressed'); stop(); onCreatePost(); }}
        />
        <Button label="Save draft" variant="ghost" fullWidth disabled={!mix || !ready || !!busy} onPress={() => { stop(); onSaveDraft(); }} />
      </View>
      {busy ? (
        <View style={styles.busy} accessibilityLiveRegion="polite">
          <ActivityIndicator color={COLORS.purpleNeon} />
          <Text style={styles.busyText}>{busy}</Text>
          <Text style={styles.busySub}>Your draft stays saved on this phone until the post goes out.</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 4 },
  headerSide: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.white, fontSize: 17, fontWeight: '700' },
  body: { flex: 1, paddingHorizontal: 20, paddingTop: 20, gap: 14 },
  mixing: { height: 220, alignItems: 'center', justifyContent: 'center', gap: 12 },
  mixingText: { color: COLORS.textSecondary, fontSize: 15, fontWeight: '600' },
  card: { backgroundColor: COLORS.surface, borderRadius: 18, padding: 16, gap: 16 },
  wave: { height: 100, flexDirection: 'row', alignItems: 'center', gap: 2 },
  bar: { flex: 1, borderRadius: 2, backgroundColor: COLORS.purpleDeep },
  barPlayed: { backgroundColor: COLORS.purpleNeon },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  play: { width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, borderColor: COLORS.purple, alignItems: 'center', justifyContent: 'center' },
  seek: { flex: 1, gap: 2 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: COLORS.textSecondary, fontSize: 12, fontVariant: ['tabular-nums'] },
  facts: { color: COLORS.textSecondary, fontSize: 13 },
  note: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  footer: { paddingHorizontal: 20, paddingBottom: 24, gap: 6 }, // see EditorPanel's footer
  busy: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(10, 10, 15, 0.94)', alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32,
  },
  busyText: { color: COLORS.white, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  busySub: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
