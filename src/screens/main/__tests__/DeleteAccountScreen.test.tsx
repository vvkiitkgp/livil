/**
 * The typed confirmation is the whole point of this screen: account deletion is
 * irreversible and cascades across every table the user touches, so the button
 * must stay inert until the word is typed exactly.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: (...a: unknown[]) => mockGoBack(...(a as [])) }),
}));

const mockDeleteMyAccount = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../services/profileService', () => ({
  deleteMyAccount: (...a: unknown[]) => mockDeleteMyAccount(...(a as [])),
}));

const mockPauseAll = jest.fn();
jest.mock('../../../contexts/PlaybackContext', () => ({
  usePlayback: () => ({ pauseAll: mockPauseAll }),
}));

const mockShowToast = jest.fn();
jest.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import DeleteAccountScreen, { DELETE_CONFIRM_WORD } from '../DeleteAccountScreen';

function mount() {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<DeleteAccountScreen />); });
  return tree;
}

const texts = (t: TestRenderer.ReactTestRenderer) =>
  t.root.findAllByType(Text).map(n => n.props.children)
    .filter((c): c is string => typeof c === 'string');

function deleteButton(t: TestRenderer.ReactTestRenderer) {
  return t.root.findAll(
    n =>
      typeof n.props?.onPress === 'function' &&
      n.props?.accessibilityLabel === 'Delete my account',
    { deep: false },
  )[0]!;
}

function type(t: TestRenderer.ReactTestRenderer, value: string) {
  const input = t.root.findByType(TextInput);
  act(() => { input.props.onChangeText(value); });
}

describe('DeleteAccountScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('states that the action is permanent before anything else', () => {
    expect(texts(mount())).toContain('This action is permanent');
  });

  it('enumerates what gets deleted', () => {
    const shown = texts(mount()).join(' ').toLowerCase();
    expect(shown).toContain('every track you have uploaded');
    expect(shown).toContain('direct message threads');
  });

  it('keeps the delete button disabled until the word is typed', () => {
    const tree = mount();
    expect(deleteButton(tree).props.accessibilityState.disabled).toBe(true);

    type(tree, 'delete me');
    expect(deleteButton(tree).props.accessibilityState.disabled).toBe(true);

    type(tree, DELETE_CONFIRM_WORD);
    expect(deleteButton(tree).props.accessibilityState.disabled).toBe(false);
  });

  it('accepts the word case-insensitively and around whitespace', () => {
    const tree = mount();
    type(tree, '  delete  ');
    expect(deleteButton(tree).props.accessibilityState.disabled).toBe(false);
  });

  it('does not delete while the confirmation is incomplete', async () => {
    const tree = mount();
    type(tree, 'DELET');
    await act(async () => { deleteButton(tree).props.onPress(); });
    expect(mockDeleteMyAccount).not.toHaveBeenCalled();
  });

  it('pauses playback and deletes once confirmed', async () => {
    const tree = mount();
    type(tree, DELETE_CONFIRM_WORD);
    await act(async () => { deleteButton(tree).props.onPress(); });
    expect(mockPauseAll).toHaveBeenCalled();
    expect(mockDeleteMyAccount).toHaveBeenCalled();
  });

  it('surfaces a failure and lets the user try again', async () => {
    mockDeleteMyAccount.mockRejectedValueOnce(new Error('network down'));
    const tree = mount();
    type(tree, DELETE_CONFIRM_WORD);
    await act(async () => { deleteButton(tree).props.onPress(); });

    expect(mockShowToast).toHaveBeenCalledWith('network down', { kind: 'error' });
    // Still armed — a transient failure must not strand the user on a dead button.
    expect(deleteButton(tree).props.accessibilityState.disabled).toBe(false);
  });
});
