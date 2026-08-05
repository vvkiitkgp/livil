import { Platform, Vibration } from 'react-native';

/**
 * The app's haptic vocabulary.
 *
 * Call sites name an INTENT (`tap`, `select`, `impact`, …) rather than a
 * duration, so the whole app's feel can be tuned in one place. Before this,
 * three call sites each carried their own magic number and drifted.
 *
 * ── Why these durations ──────────────────────────────────────────────────────
 * Anything under ~15 ms is unreliable: several Android ROMs (OxygenOS notably)
 * clamp very short vibrations to nothing, so the feedback silently vanishes on
 * exactly the devices it was tuned on. 20 ms is the floor that survives
 * everywhere, and 35 ms is as long as a UI tick can go before it reads as a
 * buzz rather than a tap.
 *
 * ── Why Android only ─────────────────────────────────────────────────────────
 * iOS ignores the duration entirely: `Vibration.vibrate(20)` fires the standard
 * ~400 ms system vibration, the same one a phone call uses. That is defensible
 * once, on a deliberate gesture — it is unbearable on every button press. So
 * this module NO-OPS on iOS rather than shipping a jackhammer.
 *
 * Fixing that means real Taptic Engine calls (UIImpactFeedbackGenerator), which
 * needs a native module — `react-native-haptic-feedback` or our own. When that
 * lands, it plugs in HERE and every call site keeps working unchanged: that is
 * the point of naming intents instead of durations.
 *
 * Requires `android.permission.VIBRATE` (already in AndroidManifest.xml).
 * Without it the platform API silently no-ops.
 */

const SUPPORTED = Platform.OS === 'android';

/**
 * Master switch, for a future "Haptic feedback" settings row. Kept here so the
 * toggle has exactly one thing to flip and no call site needs a condition.
 */
let enabled = true;

export function setHapticsEnabled(value: boolean) {
  enabled = value;
}

export function areHapticsEnabled(): boolean {
  return enabled;
}

function fire(pattern: number | number[]) {
  if (!SUPPORTED || !enabled) { return; }
  // `repeat` is explicitly false: a pattern that loops would keep buzzing until
  // something cancelled it, and nothing here ever cancels.
  Vibration.vibrate(pattern, false);
}

/**
 * Android pattern arrays are [wait, vibrate, wait, vibrate, …] — the leading 0
 * means "start now". Two short pulses read as a distinct event rather than a
 * longer version of a tap.
 */
export const haptics = {
  /** A control was pressed. The default for buttons and taps. */
  tap: () => fire(25),

  /** A value changed without committing: tab switch, segment, slider notch. */
  select: () => fire(20),

  /** Something engaged under the finger: long-press, a drag crossing its
   *  threshold, a sheet opening. Firmer so it reads as a different event. */
  impact: () => fire(35),

  /** A state turned ON — liked, reposted, followed. Never fire on the way off:
   *  undoing is not an achievement, and double-buzzing a rapid toggle is noise. */
  toggleOn: () => fire(25),

  /** An action completed: posted, uploaded, saved. */
  success: () => fire([0, 22, 70, 34]),

  /** A destructive or irreversible action was committed. */
  warning: () => fire([0, 34, 80, 34]),

  /** Something failed. Heaviest of the set — it should be felt, not noticed. */
  error: () => fire([0, 40, 90, 40]),
};

export default haptics;
