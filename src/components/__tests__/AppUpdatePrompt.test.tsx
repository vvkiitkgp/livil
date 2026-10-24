/**
 * The update prompt on screen. Pins: gentle has Later, blocking does not; Later snoozes
 * and hides; Update opens the store; a blocking prompt clears itself when the policy is
 * lowered, on the next return to the foreground — without an app restart.
 *
 * Android (Google Play In-App Updates): Update runs Play's flexible flow from the gentle
 * prompt and the immediate flow from the blocking one; a finished download comes back as
 * "Update ready — Restart"; anything Play can't do falls back to the store listing. iOS
 * never touches Play.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState, Keyboard, Linking, Platform } from 'react-native';
import type { PlayInstallStatus, PlayUpdateInfo } from '../../native/playInAppUpdate';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

let appStateListener: ((state: string) => void) | undefined;
jest.spyOn(AppState, 'addEventListener').mockImplementation(((
  _event: string,
  handler: (state: string) => void,
) => {
  appStateListener = handler;
  return { remove: () => { appStateListener = undefined; } };
}) as unknown as typeof AppState.addEventListener);

const mockOpenURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
const mockDismissKeyboard = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});

let mockPolicy: { latestBuild: number; minimumBuild: number; message: string | null } | null = null;
const mockSnooze = jest.fn();
let mockSnoozed = false;
jest.mock('../../services/appUpdate', () => {
  const actual = jest.requireActual('../../services/appUpdate');
  return {
    ...actual,
    fetchUpdatePolicy: () => Promise.resolve(mockPolicy),
    isUpdateSnoozed: () => Promise.resolve(mockSnoozed),
    snoozeUpdate: (...a: unknown[]) => mockSnooze(...a),
    storeUrls: () => ({ primary: 'store://primary', fallback: 'https://store/fallback' }),
  };
});

jest.mock('../Logo', () => ({ Logo: () => null }));

const mockShowToast = jest.fn();
jest.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

let mockPlayInfo: PlayUpdateInfo | null = null;
const mockCheckPlay = jest.fn(() => Promise.resolve(mockPlayInfo));
const mockStartPlay = jest.fn();
const mockCompletePlay = jest.fn();
let mockInstallListener: ((status: PlayInstallStatus) => void) | undefined;
jest.mock('../../native/playInAppUpdate', () => ({
  checkPlayUpdate: () => mockCheckPlay(),
  startPlayUpdate: (flow: string) => mockStartPlay(flow),
  completePlayUpdate: () => mockCompletePlay(),
  subscribePlayInstallState: (cb: (status: PlayInstallStatus) => void) => {
    mockInstallListener = cb;
    return () => { mockInstallListener = undefined; };
  },
}));

import { AppUpdatePrompt } from '../AppUpdatePrompt';

type Renderer = TestRenderer.ReactTestRenderer;

async function mount(build: number): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => { r = TestRenderer.create(<AppUpdatePrompt build={build} />); });
  return r;
}

function texts(r: Renderer): string[] {
  return r.root.findAllByType('Text' as never).map(t => [].concat(t.props.children).join(''));
}

function pressButton(r: Renderer, label: string) {
  const btn = r.root.findAll(n => n.props.accessibilityLabel === label || (n.props.label === label && typeof n.props.onPress === 'function'))[0];
  if (!btn) {throw new Error(`no button "${label}"`);}
  return btn.props.onPress();
}

const realOS = Platform.OS;

beforeEach(() => {
  mockPolicy = null;
  mockSnoozed = false;
  mockSnooze.mockReset();
  mockOpenURL.mockClear();
  mockDismissKeyboard.mockClear();
  mockShowToast.mockClear();
  mockPlayInfo = null;
  mockCheckPlay.mockClear();
  mockStartPlay.mockReset();
  mockCompletePlay.mockReset();
  mockInstallListener = undefined;
});

afterEach(() => {
  Platform.OS = realOS;
});

it('shows nothing when this build is current', async () => {
  mockPolicy = { latestBuild: 77, minimumBuild: 0, message: null };
  const r = await mount(77);
  expect(r.toJSON()).toBeNull();
});

it('shows nothing when the policy cannot be read', async () => {
  const r = await mount(10);
  expect(r.toJSON()).toBeNull();
});

it('gentle prompt: Update and Later; Later snoozes this release and hides it', async () => {
  mockPolicy = { latestBuild: 79, minimumBuild: 0, message: null };
  const r = await mount(77);
  expect(texts(r)).toContain('New version of Livil');
  await act(async () => { pressButton(r, 'Later'); });
  expect(mockSnooze).toHaveBeenCalledWith(79);
  expect(r.toJSON()).toBeNull();
});

/** The full-screen tap-away target behind the card (hidden from screen readers). */
function outsideTargets(r: Renderer) {
  return r.root.findAll(
    n => n.props.importantForAccessibility === 'no' && typeof n.props.onPress === 'function',
  );
}

it('gentle prompt: a tap outside the card is Later — snoozes and hides', async () => {
  mockPolicy = { latestBuild: 79, minimumBuild: 0, message: null };
  const r = await mount(77);
  const [outside] = outsideTargets(r);
  expect(outside).toBeDefined();
  await act(async () => { outside!.props.onPress(); });
  expect(mockSnooze).toHaveBeenCalledWith(79);
  expect(r.toJSON()).toBeNull();
});

it('gentle prompt stays away while snoozed', async () => {
  mockPolicy = { latestBuild: 79, minimumBuild: 0, message: null };
  mockSnoozed = true;
  const r = await mount(77);
  expect(r.toJSON()).toBeNull();
});

it('Update opens the store', async () => {
  mockPolicy = { latestBuild: 79, minimumBuild: 0, message: 'Spotify reposts are here' };
  const r = await mount(77);
  expect(texts(r)).toContain('Spotify reposts are here');
  await act(async () => { await pressButton(r, 'Update'); });
  expect(mockOpenURL).toHaveBeenCalledWith('store://primary');
});

it('blocking prompt has no Later, and lifts when the minimum is lowered — on return to the app', async () => {
  mockPolicy = { latestBuild: 79, minimumBuild: 78, message: null };
  const r = await mount(77);
  expect(texts(r)).toContain('Please update Livil');
  expect(() => pressButton(r, 'Later')).toThrow();
  // …and nothing to tap away: a blocking prompt has no cancel.
  expect(outsideTargets(r)).toHaveLength(0);

  mockPolicy = { latestBuild: 79, minimumBuild: 0, message: null };
  await act(async () => { appStateListener?.('active'); });
  // Still behind the latest → the gentle prompt replaces the blocking one.
  expect(texts(r)).toContain('New version of Livil');
});

it('a recheck that cannot read the policy never lifts a blocking prompt', async () => {
  mockPolicy = { latestBuild: 79, minimumBuild: 78, message: null };
  const r = await mount(77);
  expect(texts(r)).toContain('Please update Livil');

  mockPolicy = null; // offline, or airplane mode on the way back into the app
  await act(async () => { appStateListener?.('active'); });
  expect(texts(r)).toContain('Please update Livil');
});

it('puts the keyboard away when it appears, so it cannot cover the buttons', async () => {
  mockPolicy = { latestBuild: 79, minimumBuild: 0, message: null };
  await mount(77);
  expect(mockDismissKeyboard).toHaveBeenCalled();
});

it('iOS never asks Google Play — Update opens the App Store, exactly as before', async () => {
  expect(Platform.OS).toBe('ios');
  mockPolicy = { latestBuild: 79, minimumBuild: 0, message: null };
  const r = await mount(77);
  await act(async () => { await pressButton(r, 'Update'); });
  expect(mockCheckPlay).not.toHaveBeenCalled();
  expect(mockStartPlay).not.toHaveBeenCalled();
  expect(mockOpenURL).toHaveBeenCalledWith('store://primary');
  expect(r.toJSON()).toBeNull();
});

describe('Android — Google Play in-app updates', () => {
  const GENTLE = { latestBuild: 79, minimumBuild: 0, message: null };
  const BLOCKING = { latestBuild: 79, minimumBuild: 78, message: null };
  const AVAILABLE: PlayUpdateInfo = {
    availability: 'available',
    installStatus: 'unknown',
    flexibleAllowed: true,
    immediateAllowed: true,
    availableVersionCode: 79,
  };

  beforeEach(() => {
    Platform.OS = 'android';
  });

  it('does not ask Play at all when this build is current', async () => {
    mockPolicy = { latestBuild: 77, minimumBuild: 0, message: null };
    mockPlayInfo = AVAILABLE;
    const r = await mount(77);
    expect(r.toJSON()).toBeNull();
    expect(mockCheckPlay).not.toHaveBeenCalled();
  });

  it('gentle: Update downloads in the background, then comes back as "Update ready" → Restart', async () => {
    mockPolicy = GENTLE;
    mockPlayInfo = AVAILABLE;
    mockStartPlay.mockResolvedValue('accepted');
    const r = await mount(77);
    expect(texts(r)).toContain('New version of Livil');

    await act(async () => { await pressButton(r, 'Update'); });
    expect(mockStartPlay).toHaveBeenCalledWith('flexible');
    expect(mockOpenURL).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringMatching(/downloading/i), { kind: 'info' });
    // Steps aside while Play downloads; no snooze — this is not "Later".
    expect(r.toJSON()).toBeNull();
    expect(mockSnooze).not.toHaveBeenCalled();

    await act(async () => { mockInstallListener?.('downloaded'); });
    expect(texts(r)).toContain('Update ready');
    expect(mockInstallListener).toBeUndefined(); // stopped listening to Play

    mockCompletePlay.mockReturnValue(new Promise(() => {})); // Play restarts the app
    await act(async () => { void pressButton(r, 'Restart'); });
    expect(mockCompletePlay).toHaveBeenCalled();
    expect(mockOpenURL).not.toHaveBeenCalled();
  });

  it('"Update ready" has a Later, which hides it without snoozing the release', async () => {
    mockPolicy = GENTLE;
    mockPlayInfo = { ...AVAILABLE, availability: 'in_progress', installStatus: 'downloaded' };
    const r = await mount(77);
    expect(texts(r)).toContain('Update ready');
    await act(async () => { pressButton(r, 'Later'); });
    expect(r.toJSON()).toBeNull();
    expect(mockSnooze).not.toHaveBeenCalled();
  });

  it('a download that finished while Livil was closed shows "Update ready" at launch, even if snoozed', async () => {
    mockPolicy = GENTLE;
    mockSnoozed = true;
    mockPlayInfo = { ...AVAILABLE, availability: 'in_progress', installStatus: 'downloaded' };
    const r = await mount(77);
    expect(texts(r)).toContain('Update ready');
    expect(texts(r)).toContain('Restart Livil to finish updating.');
  });

  it('a download still running at launch shows nothing until it lands', async () => {
    mockPolicy = GENTLE;
    mockPlayInfo = { ...AVAILABLE, availability: 'in_progress', installStatus: 'downloading' };
    const r = await mount(77);
    expect(r.toJSON()).toBeNull();
    await act(async () => { mockInstallListener?.('downloaded'); });
    expect(texts(r)).toContain('Update ready');
  });

  it('a failed download says so, and leaves no card', async () => {
    mockPolicy = GENTLE;
    mockPlayInfo = AVAILABLE;
    mockStartPlay.mockResolvedValue('accepted');
    const r = await mount(77);
    await act(async () => { await pressButton(r, 'Update'); });
    await act(async () => { mockInstallListener?.('failed'); });
    expect(mockShowToast).toHaveBeenLastCalledWith(expect.any(String), { kind: 'error' });
    expect(r.toJSON()).toBeNull();
    expect(mockInstallListener).toBeUndefined();
  });

  it('gentle: "No thanks" in Play\'s own dialog counts as Later', async () => {
    mockPolicy = GENTLE;
    mockPlayInfo = AVAILABLE;
    mockStartPlay.mockResolvedValue('cancelled');
    const r = await mount(77);
    await act(async () => { await pressButton(r, 'Update'); });
    expect(mockSnooze).toHaveBeenCalledWith(79);
    expect(mockOpenURL).not.toHaveBeenCalled();
    expect(r.toJSON()).toBeNull();
  });

  it.each([
    ['Play cannot be asked (debug / sideloaded build, no Play Store)', null],
    ['Play has not seen the release yet', { ...AVAILABLE, availability: 'not_available' as const }],
  ])('gentle: falls back to the store listing when %s', async (_why, info) => {
    mockPolicy = GENTLE;
    mockPlayInfo = info;
    const r = await mount(77);
    await act(async () => { await pressButton(r, 'Update'); });
    expect(mockStartPlay).not.toHaveBeenCalled();
    expect(mockOpenURL).toHaveBeenCalledWith('store://primary');
    expect(r.toJSON()).toBeNull();
  });

  it.each(['failed', 'unavailable'])('gentle: falls back to the store listing when Play\'s flow is %s', async result => {
    mockPolicy = GENTLE;
    mockPlayInfo = AVAILABLE;
    mockStartPlay.mockResolvedValue(result);
    const r = await mount(77);
    await act(async () => { await pressButton(r, 'Update'); });
    expect(mockOpenURL).toHaveBeenCalledWith('store://primary');
  });

  it('blocking: Update opens Play\'s full-screen updater; backing out leaves the block up', async () => {
    mockPolicy = BLOCKING;
    mockPlayInfo = AVAILABLE;
    mockStartPlay.mockResolvedValue('cancelled');
    const r = await mount(77);
    await act(async () => { await pressButton(r, 'Update'); });
    expect(mockStartPlay).toHaveBeenCalledWith('immediate');
    expect(mockOpenURL).not.toHaveBeenCalled();
    expect(mockSnooze).not.toHaveBeenCalled();
    expect(texts(r)).toContain('Please update Livil');
  });

  it('blocking: no immediate update from Play → the store listing, block stays up', async () => {
    mockPolicy = BLOCKING;
    mockPlayInfo = { ...AVAILABLE, immediateAllowed: false };
    const r = await mount(77);
    await act(async () => { await pressButton(r, 'Update'); });
    expect(mockStartPlay).not.toHaveBeenCalled();
    expect(mockOpenURL).toHaveBeenCalledWith('store://primary');
    expect(texts(r)).toContain('Please update Livil');
  });

  it('blocking "Update ready" has no way out, and a refused restart opens the store', async () => {
    mockPolicy = BLOCKING;
    mockPlayInfo = { ...AVAILABLE, availability: 'in_progress', installStatus: 'downloaded' };
    mockCompletePlay.mockResolvedValue(false);
    const r = await mount(77);
    expect(texts(r)).toContain('Update ready');
    expect(() => pressButton(r, 'Later')).toThrow();
    expect(outsideTargets(r)).toHaveLength(0);
    await act(async () => { await pressButton(r, 'Restart'); });
    expect(mockOpenURL).toHaveBeenCalledWith('store://primary');
    expect(texts(r)).toContain('Update ready');
  });
});
