import {
  getCrashlytics,
  log,
  recordError,
  type Crashlytics,
} from '@react-native-firebase/crashlytics';

/**
 * Crash reporting — Firebase Crashlytics, in the Firebase project push already uses.
 *
 * What reaches the Crashlytics console, and from where:
 *
 *  • Native crashes (Java/Kotlin, ObjC/Swift) — the SDK catches these itself, from the
 *    first line of native code. Nothing here is involved.
 *  • Fatal JS errors — RNFB installs an `ErrorUtils` global handler the first time the
 *    module is created, so `startCrashReporting()` must run at the top of `index.js`,
 *    before the app tree mounts. It chains to React Native's own handler, so the app
 *    still crashes exactly as before — it just leaves a report behind first.
 *  • Unhandled promise rejections — recorded as non-fatals by RNFB (release only).
 *  • Render errors caught by `ErrorBoundary` — these never reach the global handler
 *    (the boundary swallows them to show "Something went wrong"), so the boundary hands
 *    them to `reportRenderError` as non-fatals.
 *
 * Debug builds send NOTHING: RNFB disables collection under `__DEV__`/`DEBUG` unless
 * `crashlytics_debug_enabled` is set in a `firebase.json`, and the repo deliberately has
 * none. Metro reload noise ("Should have a queue", stale-module errors) would bury the
 * crashes real users hit.
 *
 * Privacy: no user id, username or email is attached — a report carries the device,
 * OS, app version, the stack, and the screen-name breadcrumbs below. Route PARAMS are
 * never logged: they carry post, user and conversation ids.
 *
 * Every function is fail-safe. A reporter that throws — native module missing from an
 * old binary, Firebase not configured — must never be the thing that takes the app down.
 */

let instance: Crashlytics | null = null;

function crashlytics(): Crashlytics | null {
  if (instance) {
    return instance;
  }
  try {
    instance = getCrashlytics();
  } catch {
    instance = null;
  }
  return instance;
}

/** Call once, first thing in `index.js`: installs the JS fatal-error handler. */
export function startCrashReporting(): void {
  crashlytics();
}

/** A render error the ErrorBoundary caught. Recorded as a non-fatal, with the component stack. */
export function reportRenderError(error: Error, componentStack: string): void {
  const c = crashlytics();
  if (!c) {
    return;
  }
  try {
    if (componentStack) {
      log(c, `component stack:${componentStack}`);
    }
    recordError(c, error, 'ErrorBoundary');
  } catch {
    // Never let the reporter mask the original error.
  }
}

let lastScreen: string | null = null;

/**
 * Breadcrumb: the screen the user is on. Logs attach to the NEXT report, so a crash
 * shows the last screens visited ("screen: Home"). Name only — never params.
 */
export function noteScreen(name: string): void {
  if (name === lastScreen) {
    return;
  }
  lastScreen = name;
  const c = crashlytics();
  if (!c) {
    return;
  }
  try {
    log(c, `screen: ${name}`);
  } catch {
    // Breadcrumbs are best-effort.
  }
}
