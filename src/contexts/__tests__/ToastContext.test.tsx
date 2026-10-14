/**
 * The toast must show a whole sentence. It was a one-line pill, so "Only friends can
 * message each other. Add Manoj Karrolla as a friend to chat." reached the phone as
 * "…Add Manoj Karrolla a…" (2026-10-15).
 */

import React, { useEffect } from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../utils/haptics', () => ({ haptics: new Proxy({}, { get: () => jest.fn() }) }));
jest.mock('../../components/Icon', () => ({ Icon: () => null }));

import { ToastProvider, useToast } from '../ToastContext';

const SENTENCE = 'Only friends can message each other. Add Manoj Karrolla as a friend to chat.';

function Show() {
  const { showToast } = useToast();
  useEffect(() => { showToast(SENTENCE, { kind: 'info' }); }, [showToast]);
  return null;
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => {
  act(() => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
});

it('lets a message wrap onto a second line instead of cutting it off', () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <ToastProvider>
        <Show />
      </ToastProvider>,
    );
  });

  const message = tree.root.findAll(n => n.type === Text && n.props.children === SENTENCE);
  expect(message).toHaveLength(1);
  expect(message[0]!.props.numberOfLines).toBe(2);
});
