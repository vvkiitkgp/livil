import { LOGO_ASPECT, LOGO_PATH_D, LOGO_TRANSFORM, LOGO_VIEWBOX } from '@shared/brand/logo';

/**
 * The Livil pulse-wordmark.
 *
 * The path data lives in `shared/brand/logo.ts` rather than here — it was already duplicated
 * across `src/components/Logo.tsx` and twice inside `docs/index.html`, and a fourth copy is
 * how a brand mark drifts. Each client renders the same data with its own SVG primitive; the
 * mobile version uses react-native-svg, this one is inline SVG.
 */
export function Logo({ size = 84, color = '#FFFFFF' }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size * LOGO_ASPECT}
      viewBox={LOGO_VIEWBOX}
      role="img"
      aria-label="Livil"
      focusable="false"
    >
      <g transform={LOGO_TRANSFORM}>
        <path d={LOGO_PATH_D} fill={color} />
      </g>
    </svg>
  );
}
