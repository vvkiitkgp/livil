import { useCallback, useEffect, useRef } from 'react';
import { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

/** Home's feed switch (HomeScreen SWITCH_NUDGE / SWITCH_MS), so both screens feel the same. */
const NUDGE = 14;
const OUT_MS = 120;
const IN_MS = 200;

/**
 * The profile's version of Home's tab cross-fade, for its Reposts / Uploads / Albums /
 * Playlists tabs and the list ↔ grid switch.
 *
 * Home keeps both feeds mounted and fades between them. A profile tab is one FlatList whose
 * rows are REPLACED, so here the old rows fade out (drifting away from the new tab's side)
 * and only then is the content swapped (`swap`), the new rows fading in from that side. The
 * caller lights up the pill / switch at once — only the content waits the fade-out.
 *
 * `reveal()` fades content in again without the drift: for when a tab's rows arrive after a
 * loading row, so they do not pop in.
 *
 * A switch made while another is still fading out first applies the older one's swap, then
 * fades for the newer — never drops it: a layout tap followed at once by a tab tap must
 * leave both applied, or the switch would show "grid" over list content.
 */
export function useSwitchFade() {
  const opacity = useSharedValue(1);
  const shift = useSharedValue(0);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); } }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: shift.value }],
  }));

  const fadeIn = useCallback(() => {
    requestAnimationFrame(() => {
      opacity.value = withTiming(1, { duration: IN_MS });
      shift.value = withTiming(0, { duration: IN_MS });
    });
  }, [opacity, shift]);

  /**
   * `direction`: +1 when the new content is to the right of the old, -1 to the left.
   * `swap` gets `stillCurrent()`, false once a newer switch has started — for work it
   * finishes later (a tab's rows arriving), which must not reveal over the newer switch.
   */
  const switchTo = useCallback((direction: number, swap: (stillCurrent: () => boolean) => void) => {
    const mine = ++seq.current;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      const older = pending.current;
      pending.current = null;
      older?.();
    }
    const run = () => swap(() => mine === seq.current);
    pending.current = run;
    opacity.value = withTiming(0, { duration: OUT_MS });
    shift.value = withTiming(-direction * NUDGE, { duration: OUT_MS });
    timer.current = setTimeout(() => {
      timer.current = null;
      pending.current = null;
      run();
      shift.value = direction * NUDGE;
      fadeIn();
    }, OUT_MS);
  }, [opacity, shift, fadeIn]);

  const reveal = useCallback(() => {
    opacity.value = 0;
    fadeIn();
  }, [opacity, fadeIn]);

  return { style, switchTo, reveal };
}
