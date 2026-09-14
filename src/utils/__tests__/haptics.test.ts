/**
 * iOS haptics. Android's behaviour is unchanged and already shipped; what is new
 * — and what this covers — is the iOS branch and the two ways it can go wrong:
 *
 *   1. A wrong feedback NAME fails silently. The library accepts ~30 names but
 *      most are Android `HapticFeedbackConstants` that do nothing on iOS, so a
 *      plausible-looking typo produces no tap and no error.
 *
 *   2. `enableVibrateFallback: true` would turn every button press on a
 *      Taptic-less device into the ~400 ms phone-call buzz. That is the exact
 *      reason this module used to no-op on iOS, so it is worth pinning down.
 *
 * @react-native/jest-preset sets defaultPlatform: 'ios', so the iOS branch is
 * what runs here. `react-native-haptic-feedback` is auto-mocked from
 * <rootDir>/__mocks__ — it is a TurboModule and throws on import otherwise.
 */
import { trigger } from 'react-native-haptic-feedback';
import haptics, { setHapticsEnabled, areHapticsEnabled } from '../haptics';

const mockTrigger = trigger as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  setHapticsEnabled(true);
});

describe('iOS feedback mapping', () => {
  it.each([
    ['tap', 'impactMedium'],
    ['select', 'rigid'],
    ['tick', 'effectClick'],
    ['impact', 'impactHeavy'],
    ['toggleOn', 'impactMedium'],
    ['success', 'notificationSuccess'],
    ['warning', 'notificationWarning'],
    ['error', 'notificationError'],
  ])('haptics.%s() fires %s', (intent, expected) => {
    haptics[intent as keyof typeof haptics]();
    expect(mockTrigger).toHaveBeenCalledTimes(1);
    expect(mockTrigger.mock.calls[0][0]).toBe(expected);
  });

  /**
   * The regression this suite exists for. The first iOS mapping used `selection`
   * (Core Haptics intensity 0.20) and `impactLight` (0.30) because they read as
   * the semantically obvious choices. On device nothing below roughly 0.4 is
   * felt through a hand gripping a phone, so next/prev and the clip-handle
   * ratchet appeared to have NO haptic at all — while firing correctly the whole
   * time. A unit test cannot measure a vibration, but it can refuse the handful
   * of names known to sit under that floor.
   */
  it('never maps an intent onto a below-perception feedback', () => {
    const TOO_FAINT_TO_FEEL = [
      'selection',        // 0.20
      'segmentTick',      // 0.20
      'segmentFrequentTick',
      'keyboardRelease',  // 0.20
      'textHandleMove',   // 0.15
      'clockTick',        // 0.25
      'impactLight',      // 0.30
      'soft',             // 0.30
      'gestureStart',     // 0.30
    ];
    Object.values(haptics).forEach(fire => fire());

    expect(mockTrigger.mock.calls.length).toBeGreaterThan(0);
    mockTrigger.mock.calls.forEach(([type]) => {
      expect(TOO_FAINT_TO_FEEL).not.toContain(type);
    });
  });
});

describe('the 400 ms buzz guard', () => {
  it('never enables the vibrate fallback', () => {
    haptics.tap();
    expect(mockTrigger.mock.calls[0][1]).toMatchObject({
      enableVibrateFallback: false,
    });
  });
});

describe('the master switch', () => {
  it('silences iOS too, not just Android', () => {
    setHapticsEnabled(false);
    haptics.tap();
    haptics.error();
    expect(mockTrigger).not.toHaveBeenCalled();
  });

  it('reports its own state and resumes when switched back on', () => {
    setHapticsEnabled(false);
    expect(areHapticsEnabled()).toBe(false);

    setHapticsEnabled(true);
    expect(areHapticsEnabled()).toBe(true);

    haptics.tap();
    expect(mockTrigger).toHaveBeenCalledTimes(1);
  });
});
