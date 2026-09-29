import { useEffect } from 'react';
import {
  cancelAnimation,
  Easing,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

/**
 * One looping clock per illustration: `t` runs 0 → 1 over `durationMs`, forever,
 * on the UI thread. Every animated element derives its style from `t` with `kf`, so
 * a whole card is a single animation the way a CSS keyframe loop is — nothing to
 * sequence, nothing to keep in step, and unmounting the card cancels all of it.
 *
 * The cards were designed as CSS keyframes (percent → value), and `kf` takes those
 * stops verbatim. Porting a card is transcribing its stops, not re-choreographing it.
 */
export function useLoop(durationMs: number): SharedValue<number> {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = 0;
    t.value = withRepeat(
      withTiming(1, { duration: durationMs, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(t);
  }, [t, durationMs]);
  return t;
}

/** A keyframe stop: [percent of the loop 0–100, value at that point]. */
export type Stop = [number, number];

/**
 * Piecewise-linear lookup of `t` (0–1) against keyframe stops, clamped at both ends.
 * Plain arithmetic rather than Reanimated's `interpolate` so it is testable without
 * the native worklet runtime — and so a repeated percentage is a hold, not a NaN
 * (`interpolate` divides by the gap between neighbouring inputs).
 */
export function kf(t: number, stops: Stop[]): number {
  'worklet';
  const n = stops.length;
  if (n === 0) { return 0; }
  const p = t * 100;
  if (p <= stops[0][0]) { return stops[0][1]; }
  if (p >= stops[n - 1][0]) { return stops[n - 1][1]; }
  for (let i = 1; i < n; i++) {
    const [p1, v1] = stops[i];
    if (p < p1) {
      const [p0, v0] = stops[i - 1];
      const span = p1 - p0;
      return span <= 0 ? v1 : v0 + ((p - p0) / span) * (v1 - v0);
    }
  }
  return stops[n - 1][1];
}
