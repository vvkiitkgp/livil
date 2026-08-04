/**
 * Cover-crop geometry.
 *
 * The failure this pins is blank canvas: if a pan is allowed past the point where the
 * scaled image still covers the frame, the exported cover has an empty band down one edge —
 * and nobody re-checks artwork after publishing.
 */
import {
  clampPan,
  clampZoom,
  coverScale,
  MAX_ZOOM,
  MIN_ZOOM,
  sourceRect,
} from '../cropMath';

const FRAME = 280;

describe('coverScale', () => {
  it('fills the frame from the short side of a wide image', () => {
    // 800x400 → height is the short side, so scale is driven by it.
    expect(coverScale({ width: 800, height: 400 }, FRAME)).toBeCloseTo(FRAME / 400);
  });

  it('fills the frame from the short side of a tall image', () => {
    expect(coverScale({ width: 400, height: 800 }, FRAME)).toBeCloseTo(FRAME / 400);
  });

  it('handles a degenerate image without dividing by zero', () => {
    expect(coverScale({ width: 0, height: 0 }, FRAME)).toBe(1);
  });
});

describe('clampZoom', () => {
  it('bounds zoom to the allowed range', () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(2)).toBe(2);
  });

  it('falls back to the minimum for non-finite input', () => {
    expect(clampZoom(NaN)).toBe(MIN_ZOOM);
  });
});

describe('clampPan — never lets empty space into the frame', () => {
  const wide = { width: 800, height: 400 };

  it('pins the short axis at zoom 1', () => {
    // A wide image at zoom 1 exactly covers vertically: no vertical slack at all.
    // toBeCloseTo, not toBe: clamping a negative pan against zero slack yields -0, which
    // Object.is separates from 0 while nothing downstream can tell the difference.
    expect(clampPan({ x: 0, y: 500 }, wide, FRAME, 1).y).toBeCloseTo(0);
    expect(clampPan({ x: 0, y: -500 }, wide, FRAME, 1).y).toBeCloseTo(0);
  });

  it('allows movement along the long axis', () => {
    const panned = clampPan({ x: 1e6, y: 0 }, wide, FRAME, 1);
    expect(panned.x).toBeGreaterThan(0);
    // ...but no further than the overhang.
    const slackX = (wide.width * coverScale(wide, FRAME) - FRAME) / 2;
    expect(panned.x).toBeCloseTo(slackX);
  });

  it('frees the short axis once zoomed in', () => {
    expect(clampPan({ x: 0, y: 1e6 }, wide, FRAME, 2).y).toBeGreaterThan(0);
  });

  it('treats non-finite pan as centred', () => {
    expect(clampPan({ x: NaN, y: NaN }, wide, FRAME, 1)).toEqual({ x: 0, y: 0 });
  });
});

describe('sourceRect — stays inside the original image', () => {
  const cases = [
    { name: 'wide', image: { width: 1600, height: 900 } },
    { name: 'tall', image: { width: 900, height: 1600 } },
    { name: 'square', image: { width: 1000, height: 1000 } },
  ];

  for (const { name, image } of cases) {
    it(`never reads outside a ${name} image, at any zoom or pan`, () => {
      for (const zoom of [1, 1.5, 2.5, MAX_ZOOM]) {
        for (const pan of [
          { x: 0, y: 0 },
          { x: 1e6, y: 1e6 },
          { x: -1e6, y: -1e6 },
        ]) {
          const { sx, sy, size } = sourceRect(image, FRAME, zoom, pan);
          expect(sx).toBeGreaterThanOrEqual(0);
          expect(sy).toBeGreaterThanOrEqual(0);
          expect(sx + size).toBeLessThanOrEqual(image.width + 1e-6);
          expect(sy + size).toBeLessThanOrEqual(image.height + 1e-6);
        }
      }
    });
  }

  it('reads a smaller source region as zoom increases', () => {
    const image = { width: 1600, height: 900 };
    const wideShot = sourceRect(image, FRAME, 1, { x: 0, y: 0 });
    const closeUp = sourceRect(image, FRAME, 3, { x: 0, y: 0 });
    expect(closeUp.size).toBeLessThan(wideShot.size);
  });

  it('crops the short side exactly at zoom 1', () => {
    const image = { width: 1600, height: 900 };
    expect(sourceRect(image, FRAME, 1, { x: 0, y: 0 }).size).toBeCloseTo(900);
  });
});
