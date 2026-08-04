import React, { useMemo } from 'react';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';

/**
 * The 45° barber-stripe fill used for the pass's photo placeholder — the
 * "[ your face here ]" panel that a real avatar replaces after signup.
 *
 * CSS spec:
 *   repeating-linear-gradient(45deg, #1A1A2E 0 10px, #12121C 10px 20px)
 *
 * An SVG <Pattern> rotated 45° is the closest structural match and tiles at any
 * size, so the caller can resize the panel without the stripe pitch drifting.
 */

let patternCounter = 0;
function nextPatternId(): string {
  patternCounter += 1;
  return `lvstripe_${patternCounter}`;
}

export type StripedFillProps = {
  width: number;
  height: number;
  borderRadius?: number;
  colorA?: string;
  colorB?: string;
  /** Width of ONE stripe. The tile is twice this. */
  pitch?: number;
};

export function StripedFill({
  width,
  height,
  borderRadius = 0,
  colorA = '#1A1A2E',
  colorB = '#12121C',
  pitch = 10,
}: StripedFillProps) {
  const id = useMemo(nextPatternId, []);
  const tile = pitch * 2;

  return (
    <Svg width={width} height={height}>
      <Defs>
        <Pattern
          id={id}
          x={0}
          y={0}
          width={tile}
          height={tile}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)">
          <Rect x={0} y={0} width={pitch} height={tile} fill={colorA} />
          <Rect x={pitch} y={0} width={pitch} height={tile} fill={colorB} />
        </Pattern>
      </Defs>
      <Rect
        x={0}
        y={0}
        width={width}
        height={height}
        rx={borderRadius}
        ry={borderRadius}
        fill={`url(#${id})`}
      />
    </Svg>
  );
}
