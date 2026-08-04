/**
 * Geometry for the square cover cropper. Pure — no canvas, no DOM — so the awkward parts
 * (clamping at the zoom boundaries) are testable without a browser.
 *
 * WHY SQUARE AT ALL. The mobile app does not crop cover art on upload — it picks the file
 * as-is. But it RENDERS it at `aspectRatio: 1` with `resizeMode: 'cover'`, so a 16:9 cover
 * is centre-cropped on the feed card regardless. Cropping here does not add a restriction;
 * it moves an unavoidable one from display time, where the artist has no say, to upload
 * time, where they do.
 *
 * WHY FIT IS ALLOWED. Forcing the image to FILL the square was a restriction, and one the
 * app does not impose. Zoom now goes below "cover" down to "fit", where the whole image is
 * visible and the square is padded. Filling is still the default because it is what most
 * covers want.
 *
 * Model: `zoom` is a multiplier on the scale at which the image's SHORT side exactly fills
 * the frame. So zoom 1 is always edge-to-edge, and the minimum zoom (image-dependent) is
 * wherever the LONG side fits entirely.
 */

export type Size = { width: number; height: number };
export type Pan = { x: number; y: number };

/** Scale at which the image's short side exactly covers the frame. */
export function coverScale(image: Size, frame: number): number {
  if (image.width <= 0 || image.height <= 0) return 1;
  return Math.max(frame / image.width, frame / image.height);
}

/** Scale at which the image's long side exactly fits inside the frame. */
export function fitScale(image: Size, frame: number): number {
  if (image.width <= 0 || image.height <= 0) return 1;
  return Math.min(frame / image.width, frame / image.height);
}

export const MAX_ZOOM = 4;

/**
 * Smallest zoom for this image: the point where the whole image is visible.
 *
 * Always <= 1, and exactly 1 for a square image — a square already fits when it covers, so
 * there is nothing to zoom out to.
 */
export function minZoom(image: Size, frame: number): number {
  const cover = coverScale(image, frame);
  if (cover <= 0) return 1;
  return Math.min(1, fitScale(image, frame) / cover);
}

export function clampZoom(zoom: number, min = 1): number {
  if (!Number.isFinite(zoom)) return min;
  return Math.min(MAX_ZOOM, Math.max(min, zoom));
}

/**
 * Clamp a pan so the frame never shows empty space it does not have to.
 *
 * The slack on each axis is how far the scaled image overhangs the frame; half of it is the
 * furthest the centre may move. When the image is SMALLER than the frame (zoomed out past
 * cover) the slack is zero on that axis, which pins it centred — padding belongs
 * symmetrically around the image, not shoved against one edge.
 */
export function clampPan(pan: Pan, image: Size, frame: number, zoom: number): Pan {
  const scale = coverScale(image, frame) * clampZoom(zoom, minZoom(image, frame));
  const slackX = Math.max(0, (image.width * scale - frame) / 2);
  const slackY = Math.max(0, (image.height * scale - frame) / 2);
  return {
    x: Math.min(slackX, Math.max(-slackX, Number.isFinite(pan.x) ? pan.x : 0)),
    y: Math.min(slackY, Math.max(-slackY, Number.isFinite(pan.y) ? pan.y : 0)),
  };
}

/**
 * Where to draw the image inside the square, in FRAME coordinates.
 *
 * A destination rectangle rather than a source crop, because the two cases — zoomed in past
 * cover, and zoomed out to fit — are the same operation from this side: place the whole
 * image, let the canvas clip whatever falls outside. Expressing it as a source crop cannot
 * represent the padded case at all.
 *
 * Scale it by `output / frame` to render at export resolution.
 */
export function drawRect(
  image: Size,
  frame: number,
  zoom: number,
  pan: Pan,
): { dx: number; dy: number; dw: number; dh: number } {
  const scale = coverScale(image, frame) * clampZoom(zoom, minZoom(image, frame));
  const clamped = clampPan(pan, image, frame, zoom);
  const dw = image.width * scale;
  const dh = image.height * scale;
  return {
    dx: (frame - dw) / 2 + clamped.x,
    dy: (frame - dh) / 2 + clamped.y,
    dw,
    dh,
  };
}
