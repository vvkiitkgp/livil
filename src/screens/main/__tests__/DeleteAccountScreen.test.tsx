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

const mockCalls: string[] = [];
const mockDeleteMyAccount = jest.fn(async () => { mockCalls.push('delete'); });
const mockSubmitExitFeedback = jest.fn(async (..._a: unknown[]) => { mockCalls.push('feedback'); });
jest.mock('../../../services/profileService', () => ({
  deleteMyAccount: (...a: unknown[]) => mockDeleteMyAccount(...(a as [])),
  submitExitFeedback: (...a: unknown[]) => mockSubmitExitFeedback(...a),
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

jest.mock('react-native-keyboard-controller', () => ({
  KeyboardAwareScrollView: jest.requireActual('react-native').ScrollView,
  KeyboardAvoidingView: jest.requireActual('react-native').View,
  KeyboardController: { dismiss: jest.fn(async () => {}) },
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

function pressables(t: TestRenderer.ReactTestRenderer, label: string) {
  return t.root.findAll(
    n => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === label,
    { deep: false },
  );
}

/** The screen's red button. It opens the "why are you leaving?" popup; it does not delete. */
function deleteButton(t: TestRenderer.ReactTestRenderer) {
  return pressables(t, 'Delete my account')[0]!;
}

/** The popup's red button — the one that actually deletes. Undefined while it is closed. */
function popupDeleteButton(t: TestRenderer.ReactTestRenderer) {
  return pressables(t, 'Delete my account')[1];
}

function type(t: TestRenderer.ReactTestRenderer, value: string) {
  const input = t.root.findAllByType(TextInput)[0]!;
  act(() => { input.props.onChangeText(value); });
}

/** Screen button, then the popup's button, answering nothing. */
async function deleteViaPopup(t: TestRenderer.ReactTestRenderer) {
  await act(async () => { deleteButton(t).props.onPress(); });
  await act(async () => { popupDeleteButton(t)!.props.onPress(); });
}

describe('DeleteAccountScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCalls.length = 0;
  });

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
    await deleteViaPopup(tree);
    expect(mockDeleteMyAccount).not.toHaveBeenCalled();
    expect(mockSubmitExitFeedback).not.toHaveBeenCalled();
  });

  it('asks why before deleting — the screen button alone deletes nothing', async () => {
    const tree = mount();
    type(tree, DELETE_CONFIRM_WORD);
    expect(popupDeleteButton(tree)).toBeUndefined();

    await act(async () => { deleteButton(tree).props.onPress(); });
    expect(texts(tree)).toContain('Before you go');
    expect(popupDeleteButton(tree)).toBeDefined();
    expect(mockDeleteMyAccount).not.toHaveBeenCalled();
  });

  it('deletes nothing when the popup is cancelled', async () => {
    const tree = mount();
    type(tree, DELETE_CONFIRM_WORD);
    await act(async () => { deleteButton(tree).props.onPress(); });
    await act(async () => { pressables(tree, 'Cancel')[0]!.props.onPress(); });
    expect(popupDeleteButton(tree)).toBeUndefined();
    expect(mockDeleteMyAccount).not.toHaveBeenCalled();
  });

  it('pauses playback and deletes once confirmed, with the answer optional', async () => {
    const tree = mount();
    type(tree, DELETE_CONFIRM_WORD);
    await deleteViaPopup(tree);
    expect(mockPauseAll).toHaveBeenCalled();
    expect(mockSubmitExitFeedback).toHaveBeenCalledWith(null, '');
    expect(mockDeleteMyAccount).toHaveBeenCalled();
  });

  it('sends the chosen reason and note before deleting', async () => {
    const tree = mount();
    type(tree, DELETE_CONFIRM_WORD);
    await act(async () => { deleteButton(tree).props.onPress(); });

    const chip = tree.root.findAll(
      n => typeof n.props?.onPress === 'function'
        && n.findAllByType(Text).some(t => t.props.children === 'Too many bugs'),
      { deep: false },
    )[0]!;
    act(() => { chip.props.onPress(); });
    const note = tree.root.findAllByType(TextInput)[1]!;
    act(() => { note.props.onChangeText('Upload kept failing'); });
    await act(async () => { popupDeleteButton(tree)!.props.onPress(); });

    expect(mockSubmitExitFeedback).toHaveBeenCalledWith('bugs', 'Upload kept failing');
    expect(mockCalls).toEqual(['feedback', 'delete']);
  });

  it('surfaces a failure and lets the user try again', async () => {
    mockDeleteMyAccount.mockRejectedValueOnce(new Error('network down'));
    const tree = mount();
    type(tree, DELETE_CONFIRM_WORD);
    await deleteViaPopup(tree);

    expect(mockShowToast).toHaveBeenCalledWith('network down', { kind: 'error' });
    // Still armed — a transient failure must not strand the user on a dead button.
    expect(deleteButton(tree).props.accessibilityState.disabled).toBe(false);
  });
});
