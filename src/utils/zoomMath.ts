/**
 * Pinch-zoom maths for the chat photo viewer (ChatMediaViewerScreen). Worklets, so the
 * gesture callbacks call them on the UI thread; plain functions to Jest.
 *
 * The zoom is Instagram-style (owner, 2026-11-02): it lasts only while a finger is down —
 * pinch to zoom, keep a finger down to drag the zoomed photo, lift every finger and it springs
 * back to 100%.
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

/**
 * The zoom during a pinch, or null to IGNORE the event. A pinch is only a pinch while two
 * fingers are down: as a finger lifts, the platform recognisers send one more update with a
 * scale that has jumped — applying it made the photo lurch. Never below 100% (owner,
 * 2026-11-02: no shrinking, no dip under 100%).
 */
export function pinchZoom(startZoom: number, eventScale: number, pointers: number): number | null {
  'worklet';
  if (pointers < 2 || !Number.isFinite(eventScale) || eventScale <= 0) { return null; }
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, startZoom * eventScale));
}

/**
 * Where the photo's centre must be (one axis, relative to the screen's centre) so that the
 * spot that was under the fingers when the pinch began stays under them at `zoom` — zooming
 * "into" what you pinch, and following the fingers if they move together.
 *
 *   focal / startFocal — the fingers' midpoint now / at the start, relative to the centre
 *   startOffset        — the photo centre's offset at the start
 */
export function zoomAround(
  focal: number,
  startFocal: number,
  startOffset: number,
  startZoom: number,
  zoom: number,
): number {
  'worklet';
  const spot = (startFocal - startOffset) / startZoom;
  return focal - spot * zoom;
}
