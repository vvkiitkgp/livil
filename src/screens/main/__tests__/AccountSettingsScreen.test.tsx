/**
 * Sign out moved off ProfileScreen onto this screen (LIV-73). What is pinned
 * here is the confirmation gate and the pauseAll-before-signOut ordering — the
 * two properties a relocation can silently drop.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

const mockSignOut = jest.fn().mockResolvedValue({ error: null });
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

// The arrow indirection is load-bearing: babel hoists jest.mock above the
// consts, so `signOut: mockSignOut` would capture undefined and the screen
// would receive a non-function that no assertion could distinguish from a
// working one.
jest.mock('../../../../lib/supabase', () => ({
  supabase: { auth: { signOut: (...a: unknown[]) => mockSignOut(...(a as [])) } },
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: (...a: unknown[]) => mockNavigate(...(a as [])),
    goBack: (...a: unknown[]) => mockGoBack(...(a as [])),
  }),
}));

import { PlaybackProvider, usePlayback } from '../../../contexts/PlaybackContext';
import AccountSettingsScreen from '../AccountSettingsScreen';

type Ctx = ReturnType<typeof usePlayback>;

function mount() {
  const ctx: { current: Ctx | null } = { current: null };
  function Capture() {
    ctx.current = usePlayback();
    return <AccountSettingsScreen />;
  }
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<PlaybackProvider><Capture /></PlaybackProvider>);
  });
  return { tree, ctx: ctx.current! };
}

const texts = (t: TestRenderer.ReactTestRenderer) =>
  t.root.findAllByType(Text).map(n => n.props.children)
    .filter((c): c is string => typeof c === 'string');

/**
 * `deep: false` collapses the Touchable and the View it renders — both carry
 * onPress — to one node. Exactly one, so the modal's identically-labelled
 * confirm button can never stand in for the trigger.
 */
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

const confirm = (t: TestRenderer.ReactTestRenderer) =>
  t.root.findAll(n => typeof n.props?.onConfirm === 'function')[0]!;

describe('AccountSettingsScreen', () => {
  beforeEach(() => {
    mockSignOut.mockClear();
    mockNavigate.mockClear();
    mockGoBack.mockClear();
  });

  it('mounts under the Account settings title', () => {
    expect(texts(mount().tree)).toContain('Account settings');
  });

  it('opens Edit profile from here', () => {
    const { tree } = mount();
    act(() => { pressable(tree, 'Edit profile').props.onPress(); });
    expect(mockNavigate).toHaveBeenCalledWith('EditProfile');
  });

  it('does not sign out when the trigger is pressed', () => {
    const { tree } = mount();
    act(() => { pressable(tree, 'Sign out').props.onPress(); });
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('signs out only once the confirmation is accepted', async () => {
    const { tree } = mount();
    act(() => { pressable(tree, 'Sign out').props.onPress(); });
    await act(async () => { await confirm(tree).props.onConfirm(); });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('ignores a second confirm while the first is still in flight', async () => {
    let release!: (v: unknown) => void;
    mockSignOut.mockImplementationOnce(() => new Promise(r => { release = r; }));
    const { tree } = mount();
    act(() => { pressable(tree, 'Sign out').props.onPress(); });
    // Re-read between calls: the first sets signOutBusy, and only the closure
    // rendered after that carries the guard.
    act(() => { void confirm(tree).props.onConfirm(); });
    act(() => { void confirm(tree).props.onConfirm(); });
    await act(async () => { release({ error: null }); });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('stops playback before signing out', async () => {
    const { tree, ctx } = mount();
    const pause = jest.spyOn(ctx, 'pauseAll');
    act(() => { pressable(tree, 'Sign out').props.onPress(); });
    await act(async () => { await confirm(tree).props.onConfirm(); });
    expect(pause).toHaveBeenCalled();
    expect(pause.mock.invocationCallOrder[0]!)
      .toBeLessThan(mockSignOut.mock.invocationCallOrder[0]!);
  });
});
