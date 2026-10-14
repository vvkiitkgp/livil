/**
 * The pinned tab bar must take over exactly where the in-list one passes under the top bar
 * — a pixel early shows two bars, a pixel late shows none — and must be decided from where
 * a short list actually rests, or a switch into a near-empty tab leaves the pinned copy
 * floating over the stories (where it swallows taps on the story rings).
 */
import { clampScrollOffset, isTabBarPinned, keepPinnedOffset, pinTop } from '../homeTabsPin';

const TOP = 64;

it('pins under the top bar while it shows, at the very top while it is hidden', () => {
  expect(pinTop(true, TOP)).toBe(64);
  expect(pinTop(false, TOP)).toBe(0);
});

it('takes over at the exact crossing, on either platform', () => {
  // iOS: content inset, list rests at -64; the bar 200pt into the content sits 264 down.
  expect(isTabBarPinned(200, -64, 64)).toBe(false);
  expect(isTabBarPinned(200, 135, 64)).toBe(false);
  expect(isTabBarPinned(200, 136, 64)).toBe(true);
  // Android: a 64pt spacer is part of tabY; the list rests at 0.
  expect(isTabBarPinned(264, 0, 64)).toBe(false);
  expect(isTabBarPinned(264, 200, 64)).toBe(true);
  // Top bar hidden: the copy is at 0, so the in-list bar must reach 0.
  expect(isTabBarPinned(264, 263, 0)).toBe(false);
  expect(isTabBarPinned(264, 264, 0)).toBe(true);
});

it('restores to the offset that is pinned and nothing more', () => {
  const offset = keepPinnedOffset(264, 64);
  expect(isTabBarPinned(264, offset, 64)).toBe(true);
  expect(isTabBarPinned(264, offset - 1, 64)).toBe(false);
});

it('clamps an unreachable offset to where a short list really rests', () => {
  // 900pt of content in a 700pt viewport can scroll 200, no further.
  expect(clampScrollOffset(500, 900, 700, 0)).toBe(200);
  // Shorter than the viewport: it cannot scroll at all (iOS rests at -inset).
  expect(clampScrollOffset(500, 400, 700, -64)).toBe(-64);
  expect(clampScrollOffset(-200, 2000, 700, -64)).toBe(-64);
  expect(clampScrollOffset(300, 2000, 700, 0)).toBe(300);
});

it('a switch into a short tab unpins instead of floating over the stories', () => {
  const asked = keepPinnedOffset(264, 64);              // 200
  const rests = clampScrollOffset(asked, 600, 700, 0);  // the new tab barely has content
  expect(isTabBarPinned(264, rests, 64)).toBe(false);
});
