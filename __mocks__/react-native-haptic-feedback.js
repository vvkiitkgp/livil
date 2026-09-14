/**
 * Jest manual mock for react-native-haptic-feedback.
 *
 * WHY THIS FILE EXISTS
 * The library is a TurboModule: its entry point calls
 * `TurboModuleRegistry.getEnforcing('RNHapticFeedback')` at import time, which
 * throws when no native binary is present. Jest has no native binary, so ANY
 * suite that transitively imports `src/utils/haptics.ts` — which is every suite
 * that renders a `Button` — fails to even load without this.
 *
 * It lives in `<rootDir>/__mocks__/` rather than being `jest.mock()`-ed per file
 * because Jest applies a manual mock for a *node_modules* package AUTOMATICALLY,
 * with no opt-in call. That keeps the requirement invisible: nobody writing a new
 * screen test has to know haptics exist.
 *
 * WHY IT IS HAND-WRITTEN
 * The library ships an official mock at `src/__mocks__/`, but its package.json
 * `exports` map exposes only `.` and `./package.json` — so that path is
 * unreachable and `jest.requireActual` on it throws MODULE_NOT_FOUND. Delegating
 * is not an option; this is the surface `src/utils/haptics.ts` actually uses,
 * plus the neighbouring API so a future call site does not have to touch it.
 *
 * NOTE: @react-native/jest-preset sets `defaultPlatform: 'ios'`, so `haptics.ts`
 * takes its iOS branch under test and `trigger` really is called. Assert on it
 * with `require('react-native-haptic-feedback').trigger`.
 */
const trigger = jest.fn();
const stop = jest.fn();
const impact = jest.fn();
const triggerPattern = jest.fn();
const isSupported = jest.fn().mockReturnValue(true);
const setEnabled = jest.fn();
const isEnabled = jest.fn().mockReturnValue(true);
const playAHAP = jest.fn().mockResolvedValue(undefined);
const getSystemHapticStatus = jest
  .fn()
  .mockResolvedValue({ vibrationEnabled: true, ringerMode: 'normal' });

const RNHapticFeedback = {
  trigger,
  stop,
  impact,
  triggerPattern,
  isSupported,
  setEnabled,
  isEnabled,
  playAHAP,
  getSystemHapticStatus,
};

module.exports = {
  __esModule: true,
  trigger,
  stop,
  impact,
  triggerPattern,
  isSupported,
  setEnabled,
  isEnabled,
  playAHAP,
  getSystemHapticStatus,
  default: RNHapticFeedback,
};
