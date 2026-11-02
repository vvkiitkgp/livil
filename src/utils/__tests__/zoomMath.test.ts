import { MAX_ZOOM, pinchZoom, zoomAround } from '../zoomMath';

describe('pinch-zoom in the chat photo viewer', () => {
  it('follows two fingers, up to the limit', () => {
    expect(pinchZoom(1, 1.5, 2)).toBe(1.5);
    expect(pinchZoom(1.5, 2, 2)).toBe(3);
    expect(pinchZoom(1, 10, 2)).toBe(MAX_ZOOM);
  });

  it('never shrinks the photo below 100%', () => {
    expect(pinchZoom(1, 0.5, 2)).toBe(1);
    expect(pinchZoom(2, 0.25, 2)).toBe(1);
  });

  it('ignores the update a recogniser sends as a finger lifts', () => {
    expect(pinchZoom(1.5, 1, 1)).toBeNull();
    expect(pinchZoom(1.5, 1, 0)).toBeNull();
    expect(pinchZoom(1, NaN, 2)).toBeNull();
  });

  it('keeps the pinched spot under the fingers', () => {
    // Fingers 100 px right of centre on an unzoomed photo; zoom to 2×: the photo shifts
    // 100 px left, so the spot that was under them (100 px) is at 100 px again (−100 + 100×2).
    expect(zoomAround(100, 100, 0, 1, 2)).toBe(-100);
    // Pinching dead centre zooms in place.
    expect(zoomAround(0, 0, 0, 1, 3)).toBe(0);
    // Fingers that move 40 px together while zoomed carry the photo with them.
    expect(zoomAround(140, 100, 0, 1, 1)).toBe(40);
  });
});
