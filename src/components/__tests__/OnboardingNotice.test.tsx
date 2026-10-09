/**
 * The onboarding notice is ONE root-mounted <Modal> serving every caller. iOS can refuse a
 * presentation (another modal still animating closed) while RN keeps believing it is shown;
 * because `request` is only cleared by the dialog's own buttons, the next request used to
 * be a no-op prop change on that same native modal — so after one refusal, every later
 * Spotify AND Jam notice showed nothing until the app restarted.
 *
 * These pin the safety net: every request gets a fresh Modal instance (a new `key`), the
 * newest request is the one that runs, and the "don't show again" / no-host paths still
 * hand straight off.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Modal, Text } from 'react-native';

const mockStore: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => mockStore[k] ?? null),
    setItem: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
  },
}));

// The dialog's chrome is not under test; plain stand-ins keep the native SVG/gradient
// modules out of the renderer.
jest.mock('../Button', () => {
  const { Text: RNText } = jest.requireActual('react-native');
  return {
    Button: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <RNText accessibilityLabel={label} onPress={onPress}>{label}</RNText>
    ),
  };
});
jest.mock('../Icon', () => ({ Icon: () => null }));
jest.mock('../SpotifyLogo', () => ({ SpotifyLogo: () => null }));

import { OnboardingNoticeHost, requestNotice } from '../OnboardingNotice';

function mount() {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<OnboardingNoticeHost />); });
  return tree;
}

function unmount(t: TestRenderer.ReactTestRenderer) {
  act(() => { t.unmount(); });
}

const modal = (t: TestRenderer.ReactTestRenderer) => t.root.findByType(Modal);

const texts = (t: TestRenderer.ReactTestRenderer) =>
  t.root.findAllByType(Text).map(n => n.props.children)
    .filter((c): c is string => typeof c === 'string');

function press(t: TestRenderer.ReactTestRenderer, label: string) {
  const node = t.root.find(n => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function');
  act(() => { node.props.onPress(); });
}

async function request(kind: 'spotify' | 'jam', onConfirm: () => void) {
  await act(async () => { await requestNotice(kind, onConfirm); });
}

describe('OnboardingNoticeHost', () => {
  it('starts hidden', () => {
    const t = mount();
    expect(modal(t).props.visible).toBe(false);
    unmount(t);
  });

  it('gives every request a fresh Modal, so a refused presentation cannot wedge the next one', async () => {
    const t = mount();
    await request('spotify', jest.fn());
    const first = modal(t).instance;
    expect(modal(t).props.visible).toBe(true);

    // The first was never answered — on iOS, possibly never actually presented. A second
    // request must not be a mere prop change on that same instance.
    await request('jam', jest.fn());
    const second = modal(t).instance;
    expect(second).not.toBe(first);
    expect(modal(t).props.visible).toBe(true);
    expect(texts(t)).toContain('Jams play Livil songs only');
    unmount(t);
  });

  it('runs only the newest request when it is confirmed, then hides', async () => {
    const t = mount();
    const stale = jest.fn();
    const current = jest.fn();
    await request('spotify', stale);
    await request('spotify', current);
    press(t, 'Open Spotify');
    expect(current).toHaveBeenCalledTimes(1);
    expect(stale).not.toHaveBeenCalled();
    expect(modal(t).props.visible).toBe(false);
    unmount(t);
  });

  it('cancelling runs nothing, and the next request still shows', async () => {
    const t = mount();
    const go = jest.fn();
    await request('jam', go);
    press(t, 'Not now');
    expect(go).not.toHaveBeenCalled();
    expect(modal(t).props.visible).toBe(false);

    await request('jam', go);
    expect(modal(t).props.visible).toBe(true);
    unmount(t);
  });

  it('with no host mounted, the action runs at once rather than doing nothing', async () => {
    const go = jest.fn();
    await request('spotify', go);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('"Don\'t show this again" hands off directly next time, for that notice only', async () => {
    const t = mount();
    await request('spotify', jest.fn());
    const checkbox = t.root.find(
      n => n.props?.accessibilityRole === 'checkbox' && typeof n.props?.onPress === 'function',
    );
    act(() => { checkbox.props.onPress(); });
    press(t, 'Open Spotify');

    const go = jest.fn();
    await request('spotify', go);
    expect(go).toHaveBeenCalledTimes(1);
    expect(modal(t).props.visible).toBe(false);

    // The Jam notice was not dismissed, so it still asks.
    const jam = jest.fn();
    await request('jam', jam);
    expect(jam).not.toHaveBeenCalled();
    expect(modal(t).props.visible).toBe(true);
    unmount(t);
  });
});
