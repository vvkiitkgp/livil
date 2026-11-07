/**
 * Geometry for Home's pinned "For you | New on Livil" bar (ADR-0030).
 *
 * The bar lives in the list under the stories; a pinned copy takes over once the in-list
 * one would pass under the floating top bar, or off the top while that bar is hidden. On
 * both platforms the in-list bar's distance from the list's top edge is `tabY - scrollY`:
 * iOS rests at -topBarH (the content inset), Android adds a topBarH spacer to `tabY`.
 */

import { Animated } from 'react-native';

/**
 * The in-list bar's opacity. Hidden only while the pinned copy shows over it, because under the
 * see-through top bar and pills it would read as a ghost of the same pills. With the top bar hidden
 * the pinned copy is away too, so the in-list bar stays and scrolls off with the feed.
 *
 * `pinned` is 0 or 1. `topBarY` runs from `hiddenY` (hidden) to 0 (showing).
 */
export function makeInListTabsOpacity(
  pinned: Animated.Value,
  topBarY: Animated.Value,
  hiddenY: number,
): Animated.AnimatedSubtraction<number> {
  const topBarShowing = topBarY.interpolate({
    inputRange: [hiddenY, 0],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  return Animated.subtract(1, Animated.multiply(pinned, topBarShowing));
}

/**
 * The line the in-list bar crosses to count as pinned: under the top bar while it shows, the
 * list's top otherwise. The pinned copy itself slides off the screen with a hidden top bar.
 */
export function pinTop(topBarVisible: boolean, topBarH: number): number {
  return topBarVisible ? topBarH : 0;
}

/**
 * Whether the feed is close enough to its top that the top bar stays up, however it is scrolling.
 * Measured from where the list rests, because the platforms rest at different offsets: a plain
 * `y < 10` gave iOS (resting at -topBarH) 74pt of scroll before the bar hid, and Android 10pt.
 */
export function isNearFeedTop(y: number, restingY: number, topBarH: number): boolean {
  return y - restingY < topBarH + 10;
}

/** Whether the in-list bar has reached the pinned copy's place. */
export function isTabBarPinned(tabY: number, scrollY: number, top: number): boolean {
  return tabY - scrollY <= top;
}

/** The offset that puts the in-list bar exactly where the pinned copy is. */
export function keepPinnedOffset(tabY: number, top: number): number {
  return tabY - top;
}

/**
 * The offset a list can actually rest at. A scroll to an offset a short list cannot reach
 * is clamped by the platform, and iOS may not report it — so the pin is decided from this,
 * not from the offset that was asked for.
 */
export function clampScrollOffset(
  y: number,
  contentH: number,
  viewportH: number,
  minOffset: number,
): number {
  const maxOffset = Math.max(minOffset, contentH - viewportH);
  return Math.max(minOffset, Math.min(y, maxOffset));
}
