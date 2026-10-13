/**
 * A tap outside the "Are you sure?" card is its Cancel button, exactly: offered only when
 * the dialog HAS a Cancel (cancelLabel null hides both), and inert while the action runs.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

// The dialog's chrome is not under test; a plain stand-in keeps the native SVG/haptic
// modules out of the renderer.
jest.mock('../Button', () => {
  const { Text: RNText } = jest.requireActual('react-native');
  return {
    Button: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <RNText accessibilityLabel={label} onPress={onPress}>{label}</RNText>
    ),
  };
});

import ConfirmActionModal from '../ConfirmActionModal';

type Props = React.ComponentProps<typeof ConfirmActionModal>;

function render(over: Partial<Props> = {}) {
  const onCancel = jest.fn();
  const onConfirm = jest.fn();
  let r!: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(
      <ConfirmActionModal
        visible
        title="Delete comment?"
        message="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...over}
      />,
    );
  });
  const outside = r.root.findAll(
    n => n.props.importantForAccessibility === 'no' && typeof n.props.onPress === 'function',
  );
  return { r, onCancel, onConfirm, outside };
}

it('a tap outside the card cancels, and never confirms', () => {
  const { outside, onCancel, onConfirm } = render();
  expect(outside.length).toBeGreaterThan(0);
  act(() => { outside[0]!.props.onPress(); });
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
});

it('without a Cancel button there is nothing to tap away', () => {
  const { outside } = render({ cancelLabel: null });
  expect(outside).toHaveLength(0);
});

it('is inert while the action is running', () => {
  const { outside } = render({ busy: true });
  expect(outside[0]!.props.disabled).toBe(true);
});
