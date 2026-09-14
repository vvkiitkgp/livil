import { Platform, Vibration } from 'react-native';
import { trigger } from 'react-native-haptic-feedback';
// Type-only: `HapticFeedbackTypes` is a runtime enum in the library, but importing
// it as a value would drag the native TurboModule into every Jest suite that so
// much as renders a Button. `keyof typeof` gives the same compile-time safety —
// a typo below still fails `tsc` — with nothing left at runtime.
import type { HapticFeedbackTypes, HapticOptions } from 'react-native-haptic-feedback';

/**
 * The app's haptic vocabulary.
 *
 * Call sites name an INTENT (`tap`, `select`, `impact`, …) rather than a
 * duration, so the whole app's feel can be tuned in one place. Before this,
 * three call sites each carried their own magic number and drifted.
 *
 * ── Two backends, one vocabulary ─────────────────────────────────────────────
 * Android and iOS expose fundamentally different hardware, so each intent is
 * defined TWICE — once per platform — and `fire()` picks the backend. Call
 * sites never learn which one ran.
 *
 *   Android → a vibration MOTOR, driven by duration in milliseconds. Arbitrary
 *             values are allowed, so the feel is tuned by hand (see below).
 *   iOS     → the TAPTIC ENGINE, which takes no duration at all: you choose
 *             from a fixed set of system-defined feedbacks. Apple tunes the
 *             waveform; we only pick which one matches the intent.
 *
 * ── Why these Android durations ──────────────────────────────────────────────
 * Anything under ~15 ms is unreliable: several Android ROMs (OxygenOS notably)
 * clamp very short vibrations to nothing, so the feedback silently vanishes on
 * exactly the devices it was tuned on. 20 ms is the floor that survives
 * everywhere, and 35 ms is as long as a UI tick can go before it reads as a
 * buzz rather than a tap.
 *
 * Android pattern arrays are [wait, vibrate, wait, vibrate, …] — the leading 0
 * means "start now". Two short pulses read as a distinct event rather than a
 * longer version of a tap.
 *
 * ── Which of the library's ~30 names are safe on iOS ─────────────────────────
 * Many are borrowed from Android's `HapticFeedbackConstants` (`clockTick`,
 * `keyboardTap`, `effectClick`, …). They are NOT dead on iOS: the library runs
 * two different backends and both handle them.
 *
 *   Core Haptics (iPhone 8+) — `eventsForType:` defines an explicit
 *     intensity/sharpness for every name, including the Android-flavoured ones.
 *   UIKit generators (iPhone 7 and older) — `playUIKitHaptic:` matches a subset
 *     by name and sends EVERYTHING ELSE to `UIImpactFeedbackStyleMedium`.
 *
 * So an unrecognised name never goes silent; it degrades to a medium tap on old
 * hardware. What actually matters is the intensity it resolves to — see the
 * calibration table on IOS_FEEDBACK below, which is the real specification here.
 *
 * ── Why `enableVibrateFallback: false` ───────────────────────────────────────
 * On hardware with no Taptic Engine (iPhone 6 and older, every iPad) that flag
 * would fall back to `AudioServicesPlaySystemSound`, i.e. the standard ~400 ms
 * system vibration — the same one a phone call uses. Defensible once, on a
 * deliberate gesture; unbearable on every button press. Silence is the correct
 * degradation, and it is why this module previously no-opped on iOS entirely.
 *
 * Android requires `android.permission.VIBRATE` (already in AndroidManifest.xml).
 * Without it the platform API silently no-ops.
 */

type Intent =
  | 'tap'
  | 'select'
  | 'tick'
  | 'impact'
  | 'toggleOn'
  | 'success'
  | 'warning'
  | 'error';

const IS_ANDROID = Platform.OS === 'android';
const IS_IOS = Platform.OS === 'ios';

/** Duration in ms, or an [wait, vibrate, …] pattern. Android only. */
const ANDROID_PATTERN: Record<Intent, number | number[]> = {
  tap: 25,
  select: 20,
  // Same 20 ms `select` used before `tick` was split out, so the Android ratchet
  // feels EXACTLY as it did. The split exists for iOS; Android must not shift.
  tick: 20,
  impact: 35,
  toggleOn: 25,
  success: [0, 22, 70, 34],
  warning: [0, 34, 80, 34],
  error: [0, 40, 90, 40],
};

/**
 * iOS only.
 *
 * ── CALIBRATION: these names are not interchangeable labels ──────────────────
 * On a Core Haptics device (iPhone 8 and later) the library maps each name to a
 * FIXED intensity/sharpness pair, and the spread is enormous. The values it uses
 * — read from RNHapticFeedback.mm, `eventsForType:` — are:
 *
 *     selection      0.20 / 0.50      impactMedium   0.60 / 0.60
 *     impactLight    0.30 / 0.30      rigid          0.80 / 1.00
 *     effectClick    0.50 / 0.60      impactHeavy    1.00 / 0.80
 *
 * The first mapping here used `impactLight` (0.3) and `selection` (0.2) because
 * they read as the semantically obvious choices. On device that was a mistake:
 * 0.2 is below the threshold a hand notices while gripping a phone, so anything
 * on `selection` — the clip ratchet, the next/prev swipe — appeared to have no
 * haptic at all, and the whole app felt limp next to Android. Nothing was
 * broken; it was firing the whole time, too faintly to feel.
 *
 * TREAT THE NUMBER, NOT THE NAME, AS THE SPEC. If you change a mapping, check
 * the intensity it lands on above -- a name that sounds heavier ("rigid") is not
 * necessarily more intense, it is SHARPER.
 *
 * `toggleOn` matches `tap`: a like turning on should feel like the press that
 * caused it, not like a separate event. (Both Android durations agree at 25 ms.)
 */
const IOS_FEEDBACK: Record<Intent, keyof typeof HapticFeedbackTypes> = {
  tap: 'impactMedium',
  select: 'rigid',
  tick: 'effectClick',          // 0.50 — felt in a rapid train without fusing to a buzz
  impact: 'impactHeavy',
  toggleOn: 'impactMedium',
  success: 'notificationSuccess',
  warning: 'notificationWarning',
  error: 'notificationError',
};

const IOS_OPTIONS: HapticOptions = {
  // See "Why enableVibrateFallback: false" above — silence beats a 400 ms buzz.
  enableVibrateFallback: false,
  // Respect the user's system haptics setting rather than overriding it.
  ignoreAndroidSystemSettings: false,
};

/**
 * Master switch, for a future "Haptic feedback" settings row. Kept here so the
 * toggle has exactly one thing to flip and no call site needs a condition.
 *
 * Deliberately NOT delegated to the library's own `setEnabled`: that would gate
 * iOS only, leaving Android (which never touches the library) still buzzing.
 */
let enabled = true;

export function setHapticsEnabled(value: boolean) {
  enabled = value;
}

export function areHapticsEnabled(): boolean {
  return enabled;
}

function fire(intent: Intent) {
  if (!enabled) { return; }

  if (IS_ANDROID) {
    // `repeat` is explicitly false: a pattern that loops would keep buzzing
    // until something cancelled it, and nothing here ever cancels.
    Vibration.vibrate(ANDROID_PATTERN[intent], false);
    return;
  }

  if (IS_IOS) {
    trigger(IOS_FEEDBACK[intent], IOS_OPTIONS);
  }
}

export const haptics = {
  /** A control was pressed. The default for buttons and taps. */
  tap: () => fire('tap'),

  /** A value changed without committing: tab switch, segment, next/previous track. */
  select: () => fire('select'),

  /**
   * ONE DETENT of a continuous drag — the clip-handle ratchet, a scrub crossing a
   * bar. Split from `select` because the two have opposite requirements: `select`
   * fires once and must be unmissable, while `tick` fires up to ~22×/second and
   * must stay light enough that the train reads as texture rather than a buzz.
   * Rate-limit at the CALL SITE (see WaveformScrubber's TICK_MIN_INTERVAL_MS).
   */
  tick: () => fire('tick'),

  /** Something engaged under the finger: long-press, a drag crossing its
   *  threshold, a sheet opening. Firmer so it reads as a different event. */
  impact: () => fire('impact'),

  /** A state turned ON — liked, reposted, followed. Never fire on the way off:
   *  undoing is not an achievement, and double-buzzing a rapid toggle is noise. */
  toggleOn: () => fire('toggleOn'),

  /** An action completed: posted, uploaded, saved. */
  success: () => fire('success'),

  /** A destructive or irreversible action was committed. */
  warning: () => fire('warning'),

  /** Something failed. Heaviest of the set — it should be felt, not noticed. */
  error: () => fire('error'),
};

export default haptics;
