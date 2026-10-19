/**
 * The "No internet connection" pill: shows 1.5 s into being offline (not for a Wi-Fi →
 * mobile data blink), pauses the music when it does (offline the engine can only fail),
 * and says "Back online" when the connection returns. It blocks nothing.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

jest.mock('../Icon', () => ({ Icon: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
let mockOfflineListener: (offline: boolean) => void = () => {};
jest.mock('../../services/network', () => ({
  subscribeToOffline: (l: (offline: boolean) => void) => { mockOfflineListener = l; return () => {}; },
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

import OfflineBanner from '../OfflineBanner';

let tree: TestRenderer.ReactTestRenderer;
const label = () => tree.root.findByType(Text).props.children as string;

beforeEach(() => {
  jest.useFakeTimers();
  mockPause.mockClear();
  mockActivePostId = 'post-1';
  act(() => { tree = TestRenderer.create(<OfflineBanner />); });
});
afterEach(() => { jest.useRealTimers(); });

it('1.5 s offline: the pill shows and the music pauses', () => {
  act(() => { mockOfflineListener(true); });
  act(() => { jest.advanceTimersByTime(1400); });
  expect(mockPause).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(200); });
  expect(label()).toBe('No internet connection');
  expect(mockPause).toHaveBeenCalledTimes(1);
});

it('a blink shorter than 1.5 s pauses nothing', () => {
  act(() => { mockOfflineListener(true); });
  act(() => { jest.advanceTimersByTime(800); });
  act(() => { mockOfflineListener(false); });
  act(() => { jest.advanceTimersByTime(3000); });
  expect(mockPause).not.toHaveBeenCalled();
});

it('nothing playing: nothing to pause', () => {
  mockActivePostId = null;
  act(() => { tree.update(<OfflineBanner />); });
  act(() => { mockOfflineListener(true); });
  act(() => { jest.advanceTimersByTime(1500); });
  expect(mockPause).not.toHaveBeenCalled();
});

it('back online: says so', () => {
  act(() => { mockOfflineListener(true); });
  act(() => { jest.advanceTimersByTime(1500); });
  act(() => { mockOfflineListener(false); });
  expect(label()).toBe('Back online');
});
