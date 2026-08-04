/**
 * The one button. Mirrors `src/components/Button.tsx` in the mobile app so the two clients
 * cannot diverge on the rule that matters: **purple never fills a button.**
 *
 * At #8B3DFF a solid fill dominates the dark UI, so `primary` is a transparent surface with
 * a purple gradient outline and a `purpleNeon` label. `destructive` is the sole exception —
 * dangerous actions must stay visually heavy.
 *
 * Label colour is `purpleNeon` (#A855F7), never `purple` (#8B3DFF): the latter measures
 * 3.4–4.0:1 on this background and fails WCAG AA, while purpleNeon clears the 3:1 bar that
 * bold 15px+ labels fall under.
 *
 * The mobile version draws its glow with an SVG overlay and carries a list of hard-won
 * traps (fractional-dp flooring, rx clamping, edge guards). None of them apply here: the
 * gradient outline is done with a two-layer background and `background-clip`, which has no
 * measured geometry to get wrong. Do not port the SVG approach.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type Size = 'sm' | 'md' | 'lg';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  busy?: boolean;
  children: ReactNode;
};

export function Button({
  variant = 'primary',
  size = 'md',
  busy = false,
  disabled,
  children,
  className,
  ...rest
}: Props) {
  return (
    <button
      className={['btn', `btn--${variant}`, `btn--${size}`, className]
        .filter(Boolean)
        .join(' ')}
      // `busy` implies disabled so a double submit cannot fire. Opacity is handled in CSS
      // via [disabled] — never layer your own.
      disabled={disabled || busy}
      data-busy={busy || undefined}
      {...rest}
    >
      {busy ? 'Working…' : children}
    </button>
  );
}
