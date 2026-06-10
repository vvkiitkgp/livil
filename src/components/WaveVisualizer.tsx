import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Reanimated, {
  useSharedValue,
  useAnimatedProps,
  withRepeat,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { usePlayback } from '../contexts/PlaybackContext';
import { sampleEnvelope, type WaveformData } from '../services/waveform';

/**
 * Material-style "wavy progress" visualizer for the FloatingPlayer's minimized
 * white line. A single continuous sine stroke that SCROLLS horizontally while
 * music plays and crisply FLATTENS back to a straight line when paused — the
 * stroke width is constant, so the line stays sharp as the amplitude shrinks to
 * zero (no fade). Both the scroll (phase) and the flatten (amplitude) run on the
 * UI thread via Reanimated driving react-native-svg's Path `d`, so it's 60fps and
 * never competes with the JS pollers / gestures the FloatingPlayer already runs.
 *
 * Visibility/coexistence with the pill morph is the PARENT's job (FloatingPlayer
 * wraps this in an Animated.View whose opacity is the inverse of morphAnim), so
 * this only cares about play/pause.
 */

const AnimatedPath = Reanimated.createAnimatedComponent(Path);

const HEIGHT = 30;       // SVG canvas height (mid-line at HEIGHT/2)
const STROKE = 2.5;      // constant line thickness — stays crisp when flattened
const AMP = 4;           // decorative amplitude while playing without an envelope (±4px)
// Beat-synced range: when a track's loudness envelope is available we ride the
// amplitude between these by the envelope value at the live position — quiet
// sections calm toward AMP_MIN, loud sections swell toward AMP_MAX. Kept inside
// the 30px canvas (mid 15 ± AMP_MAX + stroke).
const AMP_MIN = 1;       // quiet sections — never fully flat, so it stays alive
const AMP_MAX = 7;       // loud sections (chorus / drop)
const ENV_TICK_MS = 40;  // envelope sampling cadence (25Hz) — cheap JS-thread poll
// Match the decorative intro delay so on FS-close the straight line shows FIRST,
// then the waves start (the pill collapses to the line before it ripples).
const ENV_INTRO_DELAY_MS = 260;
const WAVELENGTHS = 2;   // full sine periods across the width
const STEPS = 40;        // polyline resolution
// Scroll speed is anchored to a reference wavelength so the wave's PIXEL speed
// stays CONSTANT across wavelengths: a wider wave takes proportionally longer to
// scroll one period, so it glides at the same readable right→left pace as a
// narrow one (instead of zipping a whole big wavelength per cycle, which reads as
// a standing shimmer rather than motion). Anchored to how WAVELENGTHS=4 felt.
const REF_WAVELENGTHS = 4;
const REF_TRAVEL_MS = 700;
const TRAVEL_MS = REF_TRAVEL_MS * (REF_WAVELENGTHS / WAVELENGTHS); // 1400ms @ WL=2

// Build the sine polyline path on the UI thread. Advancing `phase` by 2π shifts
// the wave by exactly one period, so the repeat loops with no visible seam.
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
  /** Beat-synced loudness envelope for the active track (null = none yet → the
   *  wave keeps its decorative constant-amplitude ripple). */
  waveform?: WaveformData | null;
}) {
  // positionRef is the live ABSOLUTE full-track position (a ref — no re-renders);
  // the envelope spans the full track, so we index it directly by position.
  const { positionRef } = usePlayback();
  const phase = useSharedValue(0);
  const amp = useSharedValue(0);

  // Continuous scroll (invisible while amp = 0, so it's free to run always).
  useEffect(() => {
    phase.value = withRepeat(
      withTiming(2 * Math.PI, { duration: TRAVEL_MS, easing: Easing.linear }),
      -1,
      false,
    );
  }, [phase]);

  // Amplitude, by cause — this is what coordinates the wave with the FS morph:
  //  • suppressed (FS opening / jam): flatten FAST to a straight line so it's a
  //    clean line BEFORE the pill expands (beats the morph's open delay).
  //  • paused (and resting): gentle calm-down into the line.
  //  • playing + envelope: RIDE the song's loudness at the live position — swell
  //    in loud parts, calm in quiet ones — sampled on a cheap JS-thread interval.
  //  • playing + no envelope: original decorative ripple to a constant amplitude.
  // Both playing paths DELAY the start so the straight line shows FIRST on FS close.
  useEffect(() => {
    if (suppressed) {
      amp.value = withTiming(0, { duration: 130, easing: Easing.out(Easing.quad) });
      return;
    }
    if (!playing) {
      amp.value = withTiming(0, { duration: 520, easing: Easing.inOut(Easing.quad) });
      return;
    }
    if (!waveform) {
      amp.value = withDelay(260, withTiming(AMP, { duration: 360, easing: Easing.inOut(Easing.quad) }));
      return;
    }
    // Envelope mode: poll positionRef and ease the amplitude toward the loudness
    // at that moment. withTiming (≈2 ticks) smooths between samples for a fluid,
    // music-following motion. Delayed start preserves the "line first" intro.
    let interval: ReturnType<typeof setInterval> | null = null;
    const startTimer = setTimeout(() => {
      interval = setInterval(() => {
        const env = sampleEnvelope(waveform, positionRef.current);
        const target = env == null ? AMP : AMP_MIN + (AMP_MAX - AMP_MIN) * env;
        amp.value = withTiming(target, { duration: ENV_TICK_MS * 2, easing: Easing.linear });
      }, ENV_TICK_MS);
    }, ENV_INTRO_DELAY_MS);
    return () => {
      clearTimeout(startTimer);
      if (interval) { clearInterval(interval); }
    };
  }, [playing, suppressed, waveform, amp, positionRef]);

  const animatedProps = useAnimatedProps(() => ({
    d: buildPath(phase.value, amp.value, width),
  }));

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
