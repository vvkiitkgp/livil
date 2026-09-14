/**
 * Publishes the shared design tokens as CSS custom properties.
 *
 * The tokens are defined once in `src/theme/colors.ts` and re-exported through
 * `@shared/theme/colors`. Rather than restate any hex value in CSS — which is how two
 * clients drift on brand colour — every key is converted to a `--kebab-case` variable at
 * startup and consumed as `var(--purple-neon)`.
 *
 * Adding a token to the shared file makes it available here with no change to this file.
 */
import { COLORS } from '@shared/theme/colors';

const toCssVarName = (key: string): string =>
  `--${key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`;

/** Install the token set on :root. Call once, before first paint. */
export function installThemeVars(target: HTMLElement = document.documentElement): void {
  for (const [key, value] of Object.entries(COLORS)) {
    target.style.setProperty(toCssVarName(key), value);
  }
}

/** Exported for tests — the mapping is the part worth pinning, not the DOM write. */
export const __cssVarNameForTest = toCssVarName;
