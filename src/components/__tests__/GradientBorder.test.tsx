/**
 * Geometry tests for GradientBorder.
 *
 * WHY THIS COMPONENT, WHEN COMPONENT TESTS ARE OTHERWISE LAST
 *
 * kb/standards/testing.md says components are tested only where logic lives in them,
 * and that snapshot tests of screens are explicitly unwanted. This component qualifies:
 * it computes SVG geometry, and kb/standards/design-system.md records the traps here as
 * "all of these shipped as bugs first".
 *
 * Three of them are pinned below:
 *
 *   1. FLOOR THE MEASURED SIZE. onLayout reports fractional dp (46dp at pixelRatio 2.75
 *      is 126.5 physical px) and Android rounds the SVG's backing view DOWN. Geometry
 *      computed against the unfloored size puts the outer stroke past the real edge,
 *      where it is clipped — producing intermittent, one-sided "cut off" borders that
 *      vary with content.
 *
 *   2. CLAMP rx TO HALF THE SHORTER SIDE, AND SET ry EXPLICITLY. A pill passes
 *      borderRadius: 999. Unclamped, SVG caps rx at width/2 but ry at height/2
 *      INDEPENDENTLY, rendering an ellipse instead of a stadium.
 *
 *   3. EDGE_GUARD keeps the outermost stroke off the canvas boundary, so a fractional
 *      layout size cannot round the last row of pixels outside the viewport.
 *
 * Each failure is visual, intermittent, and device-dependent — the shape this codebase
 * keeps paying for. These assert on the emitted <Rect> props rather than a snapshot, so
 * they state the contract instead of merely detecting change.
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { GradientBorder } from '../GradientBorder';

/** Render, deliver an onLayout of the given size, and return every <Rect>. */
function rectsAfterLayout(
  props: React.ComponentProps<typeof GradientBorder>,
  layout: { width: number; height: number },
) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<GradientBorder {...props} />);
  });

  // The component measures itself before drawing anything.
  const host = tree.root.findAll(n => typeof n.props?.onLayout === 'function')[0];
  ReactTestRenderer.act(() => {
    host.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, ...layout } } });
  });

  return tree.root
    .findAll(n => typeof n.type !== 'string' && (n.type as { displayName?: string })?.displayName === 'Rect')
    .map(n => n.props as Record<string, number>);
}

describe('GradientBorder geometry', () => {
  it('draws nothing before it has been measured', () => {
    // Guards against emitting geometry against a 0×0 canvas on first paint.
    let tree!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(<GradientBorder borderRadius={12} />);
    });
    const rects = tree.root.findAll(
      n => typeof n.type !== 'string' && (n.type as { displayName?: string })?.displayName === 'Rect',
    );
    expect(rects).toHaveLength(0);
  });

  it('floors a fractional layout size before drawing', () => {
    // 100.9 × 46.7 must be treated as 100 × 46. If the unfloored size were used, the
    // outer stroke would land past the rounded-down backing view and be clipped.
    const rects = rectsAfterLayout({ borderRadius: 8, strokeWidth: 2 }, { width: 100.9, height: 46.7 });
    expect(rects.length).toBeGreaterThan(0);

    // The contract is about the STROKE'S OUTER EDGE, not the rect bounds. The rect
    // alone fits either way — the inset absorbs the fraction — so asserting on
    // r.x + r.width proves nothing. Mutation-testing found exactly that hole: at
    // 100.9 the rect ends at 99.4 (passes) while the stroke's outer edge reaches
    // 100.4, past the floored 100px backing view, and is clipped.
    for (const r of rects) {
      const outerRight = r.x + r.width + r.strokeWidth / 2;
      const outerBottom = r.y + r.height + r.strokeWidth / 2;
      expect(outerRight).toBeLessThanOrEqual(100);
      expect(outerBottom).toBeLessThanOrEqual(46);
    }
  });

  it('keeps every stroke inside the canvas', () => {
    // EDGE_GUARD: the outer edge of the widest stroke must not sit on the boundary.
    const rects = rectsAfterLayout({ borderRadius: 8, strokeWidth: 2 }, { width: 120, height: 40 });
    for (const r of rects) {
      const outerLeft = r.x - r.strokeWidth / 2;
      const outerRight = r.x + r.width + r.strokeWidth / 2;
      expect(outerLeft).toBeGreaterThan(0);
      expect(outerRight).toBeLessThan(120);
    }
  });

  it('clamps a pill radius to half the SHORTER side', () => {
    // borderRadius: 999 on a 200×40 control. Unclamped, SVG would cap rx at 100 and
    // ry at 20 independently and render an ellipse. Both must clamp to the same value,
    // bounded by half the shorter side.
    const rects = rectsAfterLayout({ borderRadius: 999, strokeWidth: 2 }, { width: 200, height: 40 });
    for (const r of rects) {
      expect(r.rx).toBeLessThanOrEqual(Math.min(r.width, r.height) / 2);
      expect(r.rx).toBeGreaterThan(0);
    }
  });

  it('sets ry explicitly equal to rx', () => {
    // The stadium-vs-ellipse bug. ry must never be left to SVG's independent default.
    const rects = rectsAfterLayout({ borderRadius: 999, strokeWidth: 2 }, { width: 200, height: 40 });
    for (const r of rects) {
      expect(r.ry).toBe(r.rx);
    }
  });

  it('never emits a negative radius or dimension', () => {
    // A stroke wider than the control would drive innerW/innerH negative without the
    // Math.max(0, …) floors, and SVG renders nothing rather than failing loudly.
    const rects = rectsAfterLayout({ borderRadius: 12, strokeWidth: 40 }, { width: 30, height: 20 });
    for (const r of rects) {
      expect(r.width).toBeGreaterThanOrEqual(0);
      expect(r.height).toBeGreaterThanOrEqual(0);
      expect(r.rx).toBeGreaterThanOrEqual(0);
    }
  });

  it('drops bloom layers on small controls', () => {
    // The bloom must not swallow a small pill. Below the compact threshold the
    // component renders a subset of layers — the Repost pill appears on every feed
    // card, so this is a hot path as well as a visual one.
    const small = rectsAfterLayout({ borderRadius: 999, strokeWidth: 1.5 }, { width: 60, height: 24 });
    const large = rectsAfterLayout({ borderRadius: 12, strokeWidth: 1.5 }, { width: 300, height: 120 });
    expect(small.length).toBeLessThan(large.length);
  });

  it('emits only the base stroke when glow is off', () => {
    const noGlow = rectsAfterLayout({ borderRadius: 12, strokeWidth: 2, glow: false }, { width: 200, height: 60 });
    const glow = rectsAfterLayout({ borderRadius: 12, strokeWidth: 2, glow: true }, { width: 200, height: 60 });
    expect(noGlow.length).toBeLessThan(glow.length);
    expect(noGlow.length).toBeGreaterThan(0);
  });
});
