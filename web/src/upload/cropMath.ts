/**
 * Geometry for the square cover cropper. Pure — no canvas, no DOM — so the awkward parts
 * (clamping at zoom boundaries) are testable without a browser.
 *
 * Model: the image is scaled so its SHORT side exactly fills the square frame at zoom 1,
 * then offset by a pan. That way zoom 1 is always a valid, fully-covered crop regardless of
 * aspect ratio, and panning is only ever constrained along the long axis.
 */

export type Size = { width: number; height: number };
export type Pan = { x: number; y: number };

/** Scale at which the image's short side exactly covers the frame. */
export function coverScale(image: Size, frame: number): number {
  if (image.width <= 0 || image.height <= 0) return 1;
  return Math.max(frame / image.width, frame / image.height);
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Clamp a pan so the frame never shows empty space.
 *
 * The slack on each axis is how far the scaled image overhangs the frame; half of it is the
 * furthest the centre may move in either direction. At zoom 1 the short axis has zero slack
 * and is pinned — which is what stops a square crop of a wide image from sliding vertically
 * into blank canvas.
 */
export function clampPan(pan: Pan, image: Size, frame: number, zoom: number): Pan {
  const scale = coverScale(image, frame) * clampZoom(zoom);
  const slackX = Math.max(0, (image.width * scale - frame) / 2);
  const slackY = Math.max(0, (image.height * scale - frame) / 2);
  return {
    x: Math.min(slackX, Math.max(-slackX, Number.isFinite(pan.x) ? pan.x : 0)),
    y: Math.min(slackY, Math.max(-slackY, Number.isFinite(pan.y) ? pan.y : 0)),
  };
}

/**
 * The source rectangle to copy out of the original image, in ORIGINAL pixel coordinates.
 *
 * Returned in source space rather than as canvas transforms so the export can draw at the
 * output resolution directly — cropping a 6000 px photo by drawing it scaled into a 1024 px
 * canvas and then reading back would throw away detail for no reason.
 */
export function sourceRect(
  image: Size,
  frame: number,
  zoom: number,
  pan: Pan,
): { sx: number; sy: number; size: number } {
  const scale = coverScale(image, frame) * clampZoom(zoom);
  const clamped = clampPan(pan, image, frame, zoom);
  // Size of the frame expressed in original pixels.
  const size = frame / scale;
  const cx = image.width / 2 - clamped.x / scale;
  const cy = image.height / 2 - clamped.y / scale;
  return {
    sx: Math.max(0, Math.min(image.width - size, cx - size / 2)),
    sy: Math.max(0, Math.min(image.height - size, cy - size / 2)),
    size,
  };
}
