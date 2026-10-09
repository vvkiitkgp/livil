/**
 * The update prompt on screen. Pins: gentle has Later, blocking does not; Later snoozes
 * and hides; Update opens the store; a blocking prompt clears itself when the policy is
 * lowered, on the next return to the foreground — without an app restart.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState, Keyboard, Linking } from 'react-native';

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

beforeEach(() => {
  mockPolicy = null;
  mockSnoozed = false;
  mockSnooze.mockReset();
  mockOpenURL.mockClear();
  mockDismissKeyboard.mockClear();
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
  expect(texts(r)).toContain('A new version of Livil is here');
  await act(async () => { pressButton(r, 'Later'); });
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

  mockPolicy = { latestBuild: 79, minimumBuild: 0, message: null };
  await act(async () => { appStateListener?.('active'); });
  // Still behind the latest → the gentle prompt replaces the blocking one.
  expect(texts(r)).toContain('A new version of Livil is here');
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
