/**
 * Cover-crop geometry.
 *
 * Two failures worth pinning, both silent:
 *   - at FILL, a pan allowed one step too far exports a cover with an empty band down one
 *     edge, and nobody re-checks artwork after publishing;
 *   - at FIT, the whole image must actually be inside the square, or "fit" quietly crops.
 */
import {
  clampPan,
  clampZoom,
  coverScale,
  drawRect,
  fitScale,
  MAX_ZOOM,
  minZoom,
} from '../cropMath';

const FRAME = 280;
const WIDE = { width: 1600, height: 900 };
const TALL = { width: 900, height: 1600 };
const SQUARE = { width: 1000, height: 1000 };

describe('coverScale / fitScale', () => {
  it('covers from the short side, fits from the long side', () => {
    expect(coverScale(WIDE, FRAME)).toBeCloseTo(FRAME / 900);
    expect(fitScale(WIDE, FRAME)).toBeCloseTo(FRAME / 1600);
  });

  it('agrees for a square image — nothing to zoom out to', () => {
    expect(coverScale(SQUARE, FRAME)).toBeCloseTo(fitScale(SQUARE, FRAME));
    expect(minZoom(SQUARE, FRAME)).toBe(1);
  });

  it('handles a degenerate image without dividing by zero', () => {
    expect(coverScale({ width: 0, height: 0 }, FRAME)).toBe(1);
    expect(fitScale({ width: 0, height: 0 }, FRAME)).toBe(1);
  });
});

describe('minZoom', () => {
  it('is below 1 for a non-square image, so the whole thing can be shown', () => {
    expect(minZoom(WIDE, FRAME)).toBeLessThan(1);
    expect(minZoom(TALL, FRAME)).toBeLessThan(1);
  });

  it('is the ratio of the short side to the long side', () => {
    expect(minZoom(WIDE, FRAME)).toBeCloseTo(900 / 1600);
  });

  it('never exceeds 1', () => {
    expect(minZoom(SQUARE, FRAME)).toBe(1);
  });
});

describe('clampZoom', () => {
  it('bounds zoom between the given floor and the maximum', () => {
    expect(clampZoom(0.01, 0.5)).toBe(0.5);
    expect(clampZoom(99, 0.5)).toBe(MAX_ZOOM);
    expect(clampZoom(2, 0.5)).toBe(2);
  });

  it('falls back to the floor for non-finite input', () => {
    expect(clampZoom(NaN, 0.5)).toBe(0.5);
  });
});

describe('clampPan', () => {
  it('pins the short axis at fill, where there is no slack', () => {
    // toBeCloseTo, not toBe: clamping against zero slack can yield -0.
    expect(clampPan({ x: 0, y: 1e6 }, WIDE, FRAME, 1).y).toBeCloseTo(0);
    expect(clampPan({ x: 0, y: -1e6 }, WIDE, FRAME, 1).y).toBeCloseTo(0);
  });

  it('allows movement along the long axis, up to the overhang', () => {
    const slackX = (WIDE.width * coverScale(WIDE, FRAME) - FRAME) / 2;
    expect(clampPan({ x: 1e6, y: 0 }, WIDE, FRAME, 1).x).toBeCloseTo(slackX);
  });

  it('pins BOTH axes when zoomed out to fit', () => {
    // The image is smaller than the frame, so padding must sit symmetrically around it
    // rather than being shoved against an edge.
    const at = minZoom(WIDE, FRAME);
    expect(clampPan({ x: 1e6, y: 1e6 }, WIDE, FRAME, at).x).toBeCloseTo(0);
    expect(clampPan({ x: 1e6, y: 1e6 }, WIDE, FRAME, at).y).toBeCloseTo(0);
  });

  it('treats non-finite pan as centred', () => {
    expect(clampPan({ x: NaN, y: NaN }, WIDE, FRAME, 1)).toEqual({ x: 0, y: 0 });
  });
});

describe('drawRect — at FILL, the square is fully covered', () => {
  for (const [name, image] of [
    ['wide', WIDE],
    ['tall', TALL],
    ['square', SQUARE],
  ] as const) {
    it(`leaves no empty space for a ${name} image, at any zoom >= 1 or pan`, () => {
      for (const zoom of [1, 1.5, 2.5, MAX_ZOOM]) {
        for (const pan of [
          { x: 0, y: 0 },
          { x: 1e6, y: 1e6 },
          { x: -1e6, y: -1e6 },
        ]) {
          const { dx, dy, dw, dh } = drawRect(image, FRAME, zoom, pan);
          expect(dx).toBeLessThanOrEqual(1e-6);
          expect(dy).toBeLessThanOrEqual(1e-6);
          expect(dx + dw).toBeGreaterThanOrEqual(FRAME - 1e-6);
          expect(dy + dh).toBeGreaterThanOrEqual(FRAME - 1e-6);
        }
      }
    });
  }
});

describe('drawRect — at FIT, the whole image is inside the square', () => {
  for (const [name, image] of [
    ['wide', WIDE],
    ['tall', TALL],
  ] as const) {
    it(`shows all of a ${name} image`, () => {
      const { dx, dy, dw, dh } = drawRect(image, FRAME, minZoom(image, FRAME), {
        x: 0,
        y: 0,
      });
      expect(dx).toBeGreaterThanOrEqual(-1e-6);
      expect(dy).toBeGreaterThanOrEqual(-1e-6);
      expect(dx + dw).toBeLessThanOrEqual(FRAME + 1e-6);
      expect(dy + dh).toBeLessThanOrEqual(FRAME + 1e-6);
    });
  }

  it('keeps the aspect ratio of the original', () => {
    const { dw, dh } = drawRect(WIDE, FRAME, minZoom(WIDE, FRAME), { x: 0, y: 0 });
    expect(dw / dh).toBeCloseTo(WIDE.width / WIDE.height);
  });

  it('centres the padding on the short axis', () => {
    const { dy, dh } = drawRect(WIDE, FRAME, minZoom(WIDE, FRAME), { x: 0, y: 0 });
    expect(dy).toBeCloseTo(FRAME - (dy + dh));
  });

  it('draws a larger image as zoom increases', () => {
    const fitted = drawRect(WIDE, FRAME, minZoom(WIDE, FRAME), { x: 0, y: 0 });
    const filled = drawRect(WIDE, FRAME, 1, { x: 0, y: 0 });
    expect(filled.dw).toBeGreaterThan(fitted.dw);
  });
});
