import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

/** iOS only: how long to wait for `onDismiss` before running anyway. A fade is ~300ms. */
const DISMISS_FALLBACK_MS = 700;

/**
 * Run something once a closing RN <Modal> has actually finished closing.
 *
 * WHY: every RN <Modal> is a presented view controller on iOS, and iOS silently refuses to
 * present one while another is still animating closed. "Close this sheet, then open that
 * dialog" in the same tick opens the dialog into nothing — and RN's iOS modal still
 * believes it is showing. The same class of bug PostDetailScreen (sheets during a push) and
 * UploadScreen (the file picker during a slide-in) already wait out.
 *
 *   iOS     — waits for the closing Modal's `onDismiss` (pass the returned `onDismiss` to
 *             it), with a fallback timer in case that event never arrives.
 *   Android — RN implements `onDismiss` on iOS only, and Android has no such refusal, so
 *             the callback runs on the next tick, as it always has.
 *
 * One pending callback at a time: a newer one replaces it. Unmounting cancels it.
 */
export function useRunAfterDismiss(): {
  runAfterDismiss: (fn: () => void) => void;
  onDismiss: () => void;
} {
  const pendingRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const fn = pendingRef.current;
    pendingRef.current = null;
    fn?.();
  }, []);

  const runAfterDismiss = useCallback((fn: () => void) => {
    pendingRef.current = fn;
    if (timerRef.current) { clearTimeout(timerRef.current); }
    timerRef.current = setTimeout(flush, Platform.OS === 'ios' ? DISMISS_FALLBACK_MS : 0);
  }, [flush]);

  useEffect(() => () => {
    if (timerRef.current) { clearTimeout(timerRef.current); }
    pendingRef.current = null;
  }, []);

  return { runAfterDismiss, onDismiss: flush };
}
