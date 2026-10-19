/**
 * The full-screen "No internet connection": covers the app 1.5 s into being offline (not
 * for a Wi-Fi → mobile data blink), pauses the music, goes away when the connection is
 * back — and "Try again" lets a phone that wrongly thinks it is offline back in.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Modal, Text } from 'react-native';

jest.mock('../Icon', () => ({ Icon: () => null }));
jest.mock('../Button', () => {
  const { Text: T } = jest.requireActual('react-native');
  return { Button: ({ label, onPress }: { label: string; onPress: () => void }) => <T onPress={onPress}>{label}</T> };
});
jest.mock('../../../lib/supabase', () => ({ SUPABASE_URL: 'https://example.supabase.co' }));

let mockOfflineListener: (offline: boolean) => void = () => {};
const mockCanReach = jest.fn();
jest.mock('../../services/network', () => ({
  subscribeToOffline: (l: (offline: boolean) => void) => { mockOfflineListener = l; return () => {}; },
  canReach: (url: string) => mockCanReach(url),
}));

const mockPause = jest.fn();
let mockActivePostId: string | null = 'post-1';
jest.mock('../../contexts/PlaybackContext', () => ({
  usePlayback: () => ({
    activePostId: mockActivePostId,
    handlersRef: { current: { pause: mockPause } },
    pauseAll: jest.fn(),
  }),
}));

import OfflineScreen from '../OfflineScreen';

let tree: TestRenderer.ReactTestRenderer;
const visible = () => tree.root.findByType(Modal).props.visible as boolean;
const texts = () => tree.root.findAllByType(Text).map(t => t.props.children).flat().join(' | ');

beforeEach(() => {
  jest.useFakeTimers();
  mockPause.mockClear();
  mockCanReach.mockReset();
  mockActivePostId = 'post-1';
  act(() => { tree = TestRenderer.create(<OfflineScreen />); });
});
afterEach(() => { jest.useRealTimers(); });

it('covers the app after 1.5 s offline and pauses the music', () => {
  act(() => { mockOfflineListener(true); });
  act(() => { jest.advanceTimersByTime(1400); });
  expect(visible()).toBe(false);
  act(() => { jest.advanceTimersByTime(200); });
  expect(visible()).toBe(true);
  expect(mockPause).toHaveBeenCalledTimes(1);
  expect(texts()).toContain('Your music is paused.');
});

it('a blink shorter than 1.5 s never shows it', () => {
  act(() => { mockOfflineListener(true); });
  act(() => { jest.advanceTimersByTime(800); });
  act(() => { mockOfflineListener(false); });
  act(() => { jest.advanceTimersByTime(2000); });
  expect(visible()).toBe(false);
  expect(mockPause).not.toHaveBeenCalled();
});

it('goes away by itself when the connection is back', () => {
  act(() => { mockOfflineListener(true); });
  act(() => { jest.advanceTimersByTime(1500); });
  expect(visible()).toBe(true);
  act(() => { mockOfflineListener(false); });
  expect(visible()).toBe(false);
});

it('Try again: our server answers → let in, even while the phone still says offline', async () => {
  act(() => { mockOfflineListener(true); });
  act(() => { jest.advanceTimersByTime(1500); });
  mockCanReach.mockResolvedValue(true);
  await act(async () => { tree.root.findByProps({ children: 'Try again' }).props.onPress(); });
  expect(mockCanReach).toHaveBeenCalledWith('https://example.supabase.co/auth/v1/health');
  expect(visible()).toBe(false);
});

it('Try again: no answer → stays, says still offline', async () => {
  act(() => { mockOfflineListener(true); });
  act(() => { jest.advanceTimersByTime(1500); });
  mockCanReach.mockResolvedValue(false);
  await act(async () => { tree.root.findByProps({ children: 'Try again' }).props.onPress(); });
  expect(visible()).toBe(true);
  const still = tree.root.findByProps({ children: 'Still offline' });
  expect(JSON.stringify(still.props.style)).not.toContain('"opacity":0');
});

it('nothing playing: nothing paused, no music line', () => {
  mockActivePostId = null;
  act(() => { tree.update(<OfflineScreen />); });
  act(() => { mockOfflineListener(true); });
  act(() => { jest.advanceTimersByTime(1500); });
  expect(mockPause).not.toHaveBeenCalled();
  expect(texts()).not.toContain('Your music is paused.');
});
