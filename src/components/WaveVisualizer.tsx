import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Reanimated, {
  useSharedValue,
  useAnimatedProps,
  useFrameCallback,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { usePlayback } from '../contexts/PlaybackContext';
import { sampleFeatures, type WaveformData } from '../services/waveform';

/**
 * Material-style "wavy progress" visualizer for the FloatingPlayer's minimized
 * white line — now BEAT-REACTIVE. A single continuous sine stroke that SCROLLS
 * horizontally while music plays and crisply FLATTENS to a straight line when
 * paused. When a track's analysis (waveform_peaks v2) is available it rides the
 * music: it stays SMALL but PUNCHES on every kick (a fast-attack/slow-decay
 * amplitude spike gated by low-band onset/flux) and SCROLLS FASTER on bright/
 * high-pitch moments (scroll speed tracks spectral centroid). The intensity is
 * carried by punch + speed, not height — so the line reads as "locked to the
 * song" while staying a slim bar.
 *
 * Everything animates on the UI thread: ONE AnimatedPath / one buildPath worklet,
 * a useFrameCallback phase integrator (so speed can vary smoothly), and a cheap
 * ~30Hz JS poll that samples the precomputed features at positionRef and feeds
 * shared values. Falls back to the old decorative ripple when there's no data.
 */

const AnimatedPath = Reanimated.createAnimatedComponent(Path);

const HEIGHT = 30;       // SVG canvas height (mid-line at HEIGHT/2)
const STROKE = 2.5;      // constant line thickness — stays crisp when flattened
const AMP = 4;           // decorative amplitude while playing without analysis (±4px)

// Beat-reactive amplitude: a small RESTING swell driven by bass, plus a transient
// KICK spiked on each onset. Total is capped so even a big punch stays in-canvas.
const AMP_MIN = 1;       // quiet sections — never fully flat, stays alive
const AMP_MAX = 5;       // loud bass sections — resting swell ceiling (kept small)
const KICK_MIN = 3;      // weakest detected beat adds this much
const KICK_PEAK = 6;     // strongest beat adds this much on top of the resting swell
const AMP_CAP = 11;      // hard ceiling: mid(15) ± 11 + stroke stays inside 30px
const KICK_ATTACK_MS = 45;   // snap UP fast — the "hit"
const KICK_DECAY_MS = 230;   // ease DOWN slow — the "ring out"

// Onset gate (adaptive): fire a kick on a RISING edge of flux above a threshold
// that floats with the track's recent low-band energy, so it auto-gains across
// quiet and loud songs and doesn't machine-gun.
const FLUX_FLOOR = 0.22;
const FLUX_RATIO = 1.4;
const MIN_KICK_GAP_MS = 110;  // ≤ ~9 kicks/sec — avoids double-firing one beat

const ENV_TICK_MS = 33;       // feature sampling cadence (~30Hz) — cheap JS poll
const ENV_INTRO_DELAY_MS = 260; // line shows FIRST on FS-close, then it ripples

const WAVELENGTHS = 2;   // full sine periods across the width
const STEPS = 40;        // polyline resolution
// Baseline scroll pace (rad/ms), anchored to the old constant-speed feel. Bright
// moments scroll toward FAST, dull/low ones toward SLOW.
const REF_WAVELENGTHS = 4;
const REF_TRAVEL_MS = 700;
const TRAVEL_MS = REF_TRAVEL_MS * (REF_WAVELENGTHS / WAVELENGTHS); // 1400ms @ WL=2
const TWO_PI = 2 * Math.PI;
const SPEED_BASE = TWO_PI / TRAVEL_MS;   // rad/ms — decorative / mid pace
const SPEED_SLOW = SPEED_BASE * 0.7;     // dull/low → slower glide
const SPEED_FAST = SPEED_BASE * 2.3;     // bright/high → faster, tighter scroll

// Build the sine polyline path on the UI thread. Advancing `phase` by 2π shifts
// the wave by exactly one period, so the scroll loops with no visible seam.
function buildPath(phase: number, amp: number, width: number): string {
  'worklet';
  const midY = HEIGHT / 2;
  const k = (WAVELENGTHS * 2 * Math.PI) / width;
  let d = '';
  for (let i = 0; i <= STEPS; i++) {
    const x = (i / STEPS) * width;
    const y = midY + amp * Math.sin(k * x + phase);
    d += i === 0 ? `M${x} ${y}` : `L${x} ${y}`;
  }
  return d;
}

export default function WaveVisualizer({
  playing,
  suppressed,
  width,
  color = '#FFFFFF',
  waveform = null,
}: {
  playing: boolean;
  /** True while the pill is expanded (FS open / jam) — flatten FAST so the line
   *  is ready before the pill expands, and don't re-ripple until it collapses. */
  suppressed: boolean;
  width: number;
  color?: string;
  /** Beat-reactive analysis for the active track (null = none yet → the wave
   *  keeps its decorative constant-amplitude ripple). */
  waveform?: WaveformData | null;
}) {
  // positionRef is the live ABSOLUTE full-track position (a ref — no re-renders);
  // the analysis spans the full track, so we index it directly by position.
  const { positionRef } = usePlayback();
  const phase = useSharedValue(0);
  const baseAmp = useSharedValue(0); // resting swell (eased from bass / loudness)
  const kick = useSharedValue(0);    // transient punch on each onset
  const speed = useSharedValue(SPEED_BASE); // rad/ms — scroll pace (from brightness)

  // Phase integrator (UI thread): phase advances by speed·dt every frame, kept in
  // [0,2π). Lets brightness modulate scroll speed smoothly — unlike a fixed-
  // duration withRepeat loop, there's no seam when the speed changes mid-flight.
  useFrameCallback(frame => {
    'worklet';
    const dt = frame.timeSincePreviousFrame ?? 16;
    let p = phase.value + speed.value * dt;
    if (p >= TWO_PI) { p -= TWO_PI * Math.floor(p / TWO_PI); }
    phase.value = p;
  });

  // Amplitude + speed driver, by cause:
  //  • suppressed (FS opening / jam): flatten FAST to a clean line.
  //  • paused: gentle calm-down into the line.
  //  • playing + analysis: RIDE the music — baseAmp from bass, KICK on flux onsets,
  //    scroll SPEED from brightness — sampled on a ~30Hz JS poll.
  //  • playing + no analysis: original decorative ripple at constant amp + pace.
  useEffect(() => {
    if (suppressed) {
      baseAmp.value = withTiming(0, { duration: 130, easing: Easing.out(Easing.quad) });
      kick.value = withTiming(0, { duration: 130 });
      return;
    }
    if (!playing) {
      baseAmp.value = withTiming(0, { duration: 520, easing: Easing.inOut(Easing.quad) });
      kick.value = withTiming(0, { duration: 300 });
      return;
    }
    if (!waveform) {
      // Decorative: constant swell + constant pace, delayed so the line shows first.
      baseAmp.value = withTiming(AMP, { duration: 360, easing: Easing.inOut(Easing.quad) });
      speed.value = withTiming(SPEED_BASE, { duration: 200 });
      return;
    }

    // Beat-reactive mode. Reset state and start the poll after the intro delay.
    baseAmp.value = withTiming(0, { duration: 120 });
    kick.value = 0;
    let prevAbove = false;
    let fluxEma = 0;
    let lastKickAt = 0;
    let elapsed = 0;
    let interval: ReturnType<typeof setInterval> | null = null;

    const startTimer = setTimeout(() => {
      interval = setInterval(() => {
        elapsed += ENV_TICK_MS;
        const f = sampleFeatures(waveform, positionRef.current);
        if (!f) {
          baseAmp.value = withTiming(AMP, { duration: 200 });
          speed.value = withTiming(SPEED_BASE, { duration: 200 });
          return;
        }
        // Resting swell from bass (falls back to loudness on v1 rows).
        const rest = AMP_MIN + (AMP_MAX - AMP_MIN) * f.bass;
        baseAmp.value = withTiming(rest, { duration: ENV_TICK_MS * 2, easing: Easing.out(Easing.quad) });
        // Scroll speed from brightness.
        speed.value = withTiming(SPEED_SLOW + (SPEED_FAST - SPEED_SLOW) * f.centroid, { duration: 120 });
        // Onset → kick. Adaptive, rising-edge, rate-limited.
        fluxEma = fluxEma * 0.9 + f.flux * 0.1;
        const threshold = Math.max(FLUX_FLOOR, fluxEma * FLUX_RATIO);
        const above = f.flux > threshold;
        if (above && !prevAbove && elapsed - lastKickAt >= MIN_KICK_GAP_MS) {
          lastKickAt = elapsed;
          const peak = KICK_MIN + (KICK_PEAK - KICK_MIN) * f.flux;
          kick.value = withSequence(
            withTiming(peak, { duration: KICK_ATTACK_MS, easing: Easing.out(Easing.quad) }),
            withTiming(0, { duration: KICK_DECAY_MS, easing: Easing.in(Easing.quad) }),
          );
        }
        prevAbove = above;
      }, ENV_TICK_MS);
    }, ENV_INTRO_DELAY_MS);

    return () => {
      clearTimeout(startTimer);
      if (interval) { clearInterval(interval); }
    };
  }, [playing, suppressed, waveform, baseAmp, kick, speed, positionRef]);

  const animatedProps = useAnimatedProps(() => {
    const amp = Math.min(AMP_CAP, baseAmp.value + kick.value);
    return { d: buildPath(phase.value, amp, width) };
  });

  return (
    <Svg width={width} height={HEIGHT} style={styles.svg}>
      <AnimatedPath
        animatedProps={animatedProps}
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  svg: { overflow: 'visible' },
});
