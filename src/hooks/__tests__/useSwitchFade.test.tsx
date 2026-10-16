/**
 * The profile's tab / layout cross-fade. What must hold: content swaps only after the old
 * rows have faded, and a switch made mid-fade never drops the earlier one — a layout tap
 * then a tab tap must leave BOTH applied, or the switch shows "grid" over list rows. Only
 * the newest switch may reveal content that arrives later.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('react-native-reanimated', () => ({
  useSharedValue: (v: number) => ({ value: v }),
  useAnimatedStyle: (fn: () => unknown) => fn(),
  withTiming: (to: number) => to,
}));

import { useSwitchFade } from '../useSwitchFade';

let fade: ReturnType<typeof useSwitchFade>;
function Probe() {
  fade = useSwitchFade();
  return null;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(global, 'requestAnimationFrame').mockImplementation(cb => { cb(0); return 0; });
  act(() => { TestRenderer.create(<Probe />); });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('swaps the content only after the old rows have faded out', () => {
  const swap = jest.fn();
  fade.switchTo(1, swap);
  expect(swap).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(120); });
  expect(swap).toHaveBeenCalledTimes(1);
});

it('applies an earlier switch first when a second comes mid-fade, never dropping it', () => {
  const order: string[] = [];
  fade.switchTo(1, () => { order.push('grid'); });
  act(() => { jest.advanceTimersByTime(50); });
  fade.switchTo(1, () => { order.push('uploads'); });
  expect(order).toEqual(['grid']); // applied at once, not lost
  act(() => { jest.advanceTimersByTime(120); });
  expect(order).toEqual(['grid', 'uploads']);
});

it('lets only the newest switch reveal what arrives later', () => {
  let olderCurrent: () => boolean = () => true;
  let newerCurrent: () => boolean = () => false;
  fade.switchTo(1, stillCurrent => { olderCurrent = stillCurrent; });
  act(() => { jest.advanceTimersByTime(120); });
  expect(olderCurrent()).toBe(true);
  fade.switchTo(-1, stillCurrent => { newerCurrent = stillCurrent; });
  act(() => { jest.advanceTimersByTime(120); });
  expect(olderCurrent()).toBe(false);
  expect(newerCurrent()).toBe(true);
});
