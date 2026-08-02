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
const mockDeleteMyAccount = jest.fn().mockResolvedValue(undefined);
const mockShowToast = jest.fn();

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
jest.mock('../../../services/profileService', () => ({
  deleteMyAccount: (...a: unknown[]) => mockDeleteMyAccount(...(a as [])),
}));
jest.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: (...a: unknown[]) => mockShowToast(...(a as [])) }),
}));

import { PlaybackProvider, usePlayback } from '../../../contexts/PlaybackContext';
import { SettingsRow } from '../../../components/SettingsRow';
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

/** Selected by confirm label: two modals now hang off this screen. */
function modal(t: TestRenderer.ReactTestRenderer, confirmLabel: string) {
  const found = t.root.findAll(
    n => typeof n.props?.onConfirm === 'function' && n.props?.confirmLabel === confirmLabel,
  );
  if (found.length !== 1) {
    throw new Error(`expected 1 modal confirming "${confirmLabel}", found ${found.length}`);
  }
  return found[0]!;
}

describe('AccountSettingsScreen', () => {
  beforeEach(() => {
    mockSignOut.mockClear();
    mockNavigate.mockClear();
    mockGoBack.mockClear();
    mockShowToast.mockClear();
    mockDeleteMyAccount.mockReset().mockResolvedValue(undefined);
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
    await act(async () => { await modal(tree, 'Sign out').props.onConfirm(); });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('ignores a second confirm while the first is still in flight', async () => {
    let release!: (v: unknown) => void;
    mockSignOut.mockImplementationOnce(() => new Promise(r => { release = r; }));
    const { tree } = mount();
    act(() => { pressable(tree, 'Sign out').props.onPress(); });
    // Re-read between calls: the first sets signOutBusy, and only the closure
    // rendered after that carries the guard.
    act(() => { modal(tree, 'Sign out').props.onConfirm(); });
    act(() => { modal(tree, 'Sign out').props.onConfirm(); });
    await act(async () => { release({ error: null }); });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('stops playback before signing out', async () => {
    const { tree, ctx } = mount();
    const pause = jest.spyOn(ctx, 'pauseAll');
    act(() => { pressable(tree, 'Sign out').props.onPress(); });
    await act(async () => { await modal(tree, 'Sign out').props.onConfirm(); });
    expect(pause).toHaveBeenCalled();
    expect(pause.mock.invocationCallOrder[0]!)
      .toBeLessThan(mockSignOut.mock.invocationCallOrder[0]!);
  });

  it('renders Delete account as a red row that acts rather than navigates', () => {
    const { tree } = mount();
    const row = tree.root.findAllByType(SettingsRow)
      .find(n => n.props.label === 'Delete account');
    expect(row).toBeDefined();
    expect(row!.props.destructive).toBe(true);
    expect(row!.props.chevron).toBe(false);
  });

  it('does not delete when the trigger is pressed', () => {
    const { tree } = mount();
    act(() => { pressable(tree, 'Delete account').props.onPress(); });
    expect(mockDeleteMyAccount).not.toHaveBeenCalled();
    expect(modal(tree, 'Delete my account').props.visible).toBe(true);
  });

  it('deletes only once the confirmation is accepted', async () => {
    const { tree } = mount();
    act(() => { pressable(tree, 'Delete account').props.onPress(); });
    await act(async () => { await modal(tree, 'Delete my account').props.onConfirm(); });
    expect(mockDeleteMyAccount).toHaveBeenCalledTimes(1);
  });

  it('changes nothing when the confirmation is dismissed', () => {
    const { tree } = mount();
    act(() => { pressable(tree, 'Delete account').props.onPress(); });
    act(() => { modal(tree, 'Delete my account').props.onCancel(); });
    expect(mockDeleteMyAccount).not.toHaveBeenCalled();
    expect(modal(tree, 'Delete my account').props.visible).toBe(false);
  });

  it('stops playback before deleting', async () => {
    const { tree, ctx } = mount();
    const pause = jest.spyOn(ctx, 'pauseAll');
    act(() => { pressable(tree, 'Delete account').props.onPress(); });
    await act(async () => { await modal(tree, 'Delete my account').props.onConfirm(); });
    expect(pause).toHaveBeenCalled();
    expect(pause.mock.invocationCallOrder[0]!)
      .toBeLessThan(mockDeleteMyAccount.mock.invocationCallOrder[0]!);
  });

  it('ignores a second delete confirm while the first is still in flight', async () => {
    let release!: () => void;
    mockDeleteMyAccount.mockImplementationOnce(() => new Promise<void>(r => { release = r; }));
    const { tree } = mount();
    act(() => { pressable(tree, 'Delete account').props.onPress(); });
    // Re-read between calls: the first sets deleteBusy, and only the closure
    // rendered after that carries the guard.
    act(() => { modal(tree, 'Delete my account').props.onConfirm(); });
    act(() => { modal(tree, 'Delete my account').props.onConfirm(); });
    await act(async () => { release(); });
    expect(mockDeleteMyAccount).toHaveBeenCalledTimes(1);
  });

  it('says what is happening while the delete runs', async () => {
    let release!: () => void;
    mockDeleteMyAccount.mockImplementationOnce(() => new Promise<void>(r => { release = r; }));
    const { tree } = mount();
    act(() => { pressable(tree, 'Delete account').props.onPress(); });
    expect(modal(tree, 'Delete my account').props.busy).toBe(false);
    act(() => { modal(tree, 'Delete my account').props.onConfirm(); });
    expect(modal(tree, 'Delete my account').props.busy).toBe(true);
    expect(modal(tree, 'Delete my account').props.message).toMatch(/Deleting your account/);
    await act(async () => { release(); });
  });

  it('reports a failure and lets the user try again', async () => {
    mockDeleteMyAccount.mockRejectedValueOnce(new Error('Could not delete your files in avatars: denied'));
    const { tree } = mount();
    act(() => { pressable(tree, 'Delete account').props.onPress(); });
    await act(async () => { await modal(tree, 'Delete my account').props.onConfirm(); });
    expect(mockShowToast).toHaveBeenCalledWith(
      'Could not delete your files in avatars: denied',
      { kind: 'error' },
    );
    expect(modal(tree, 'Delete my account').props.busy).toBe(false);
    await act(async () => { await modal(tree, 'Delete my account').props.onConfirm(); });
    expect(mockDeleteMyAccount).toHaveBeenCalledTimes(2);
  });

  it('leaves the transition to RootNavigator instead of navigating itself', async () => {
    const { tree } = mount();
    act(() => { pressable(tree, 'Delete account').props.onPress(); });
    await act(async () => { await modal(tree, 'Delete my account').props.onConfirm(); });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
  });
});
