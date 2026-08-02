/**
 * Settings is the container the published deletion page names. Account-level
 * actions sit one level deeper, so deletion stays four taps from the profile —
 * the reason the "no account action here" assertion below is not decoration.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: (...a: unknown[]) => mockNavigate(...(a as [])),
    goBack: (...a: unknown[]) => mockGoBack(...(a as [])),
  }),
}));

import SettingsScreen from '../SettingsScreen';

function mount() {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<SettingsScreen />); });
  return tree;
}

const texts = (t: TestRenderer.ReactTestRenderer) =>
  t.root.findAllByType(Text).map(n => n.props.children)
    .filter((c): c is string => typeof c === 'string');

/** `deep: false` collapses the Touchable and the View it renders to one node. */
function pressable(t: TestRenderer.ReactTestRenderer, label: string) {
  const found = t.root.findAll(
    n => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === label,
    { deep: false },
  );
  if (found.length !== 1) {
    throw new Error(`expected 1 pressable labelled "${label}", found ${found.length}`);
  }
  return found[0]!;
}

describe('SettingsScreen', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockGoBack.mockClear();
  });

  it('mounts under the Settings title', () => {
    expect(texts(mount())).toContain('Settings');
  });

  it('opens Account settings', () => {
    const tree = mount();
    act(() => { pressable(tree, 'Account settings').props.onPress(); });
    expect(mockNavigate).toHaveBeenCalledWith('AccountSettings');
  });

  it('goes back from the header', () => {
    const tree = mount();
    act(() => { pressable(tree, 'Go back').props.onPress(); });
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('surfaces no account action at this level', () => {
    const shown = texts(mount()).join(' ').toLowerCase();
    expect(shown).not.toMatch(/delete|sign out/);
  });
});
