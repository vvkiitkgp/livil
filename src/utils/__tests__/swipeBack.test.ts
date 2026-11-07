/**
 * Swiping from the left edge on an iPhone tab goes Home, as Android's back gesture does. A short
 * slow drag must not switch tabs by accident.
 */
import { isSwipeBack } from '../swipeBack';

it('goes back on a long enough drag, however slow', () => {
  expect(isSwipeBack(80, 0)).toBe(true);
  expect(isSwipeBack(200, 50)).toBe(true);
});

it('goes back on a short flick', () => {
  expect(isSwipeBack(30, 800)).toBe(true);
});

it('stays put on a short slow drag', () => {
  expect(isSwipeBack(60, 100)).toBe(false);
});

it('stays put on a fast twitch that barely moved', () => {
  expect(isSwipeBack(10, 900)).toBe(false);
});

it('stays put when the finger came back', () => {
  expect(isSwipeBack(-5, -600)).toBe(false);
});
