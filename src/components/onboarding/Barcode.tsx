import React, { useMemo } from 'react';
import Svg, { Rect } from 'react-native-svg';
import { COLORS } from '../../theme/colors';

/**
 * The barcode strip along the bottom of the backstage pass.
 *
 * 9px repeating pattern: 2px bar, 3px gap, 1px bar, 3px gap.
 *
 * This was originally a row of Views — one per bar AND one per gap — which cost
 * ~120 native views for the full pass's 212px strip and another ~84 for the mini
 * pass. Two hundred views for a decorative stripe is enough to make a step feel
 * sluggish on Android. One SVG of ~48 rects is a single native view.
 */

const PERIOD = 9;

export type BarcodeProps = {
  width: number;
  height: number;
};

export function Barcode({ width, height }: BarcodeProps) {
  const bars = useMemo(() => {
    const out: Array<{ x: number; w: number }> = [];
    for (let x = 0; x < width; x += PERIOD) {
      out.push({ x, w: Math.min(2, width - x) });
      if (x + 5 < width) { out.push({ x: x + 5, w: Math.min(1, width - x - 5) }); }
    }
    return out;
  }, [width]);

  return (
    <Svg width={width} height={height}>
      {bars.map(b => (
        <Rect key={b.x} x={b.x} y={0} width={b.w} height={height} fill={COLORS.purpleLight} />
      ))}
    </Svg>
  );
}
