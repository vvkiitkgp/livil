/**
 * Geometry for Home's pinned "For you | New on Livil" bar (ADR-0030).
 *
 * The bar lives in the list under the stories; a pinned copy takes over once the in-list
 * one would pass under the floating top bar, or off the top while that bar is hidden. On
 * both platforms the in-list bar's distance from the list's top edge is `tabY - scrollY`:
 * iOS rests at -topBarH (the content inset), Android adds a topBarH spacer to `tabY`.
 */

/** Where the pinned copy sits: under the top bar while it shows, at the top otherwise. */
export function pinTop(topBarVisible: boolean, topBarH: number): number {
  return topBarVisible ? topBarH : 0;
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
