import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * Renders a modal at the end of `<body>`, outside the React tree it was written in.
 *
 * WHY THIS EXISTS, and why "it works without it" is not a reason to remove it:
 *
 * A `position: fixed` overlay is only viewport-relative while none of its ancestors is a
 * containing block. `transform`, `filter`, `perspective`, `backdrop-filter`, `will-change`
 * and `contain` all create one — and so does a FINISHED animation that retained a
 * transform, because a `transform: none` held by `animation-fill-mode: both` computes as
 * the identity matrix rather than `none`.
 *
 * That is not hypothetical. `.page.fade-up` did exactly this, and every modal in the studio
 * was clipped to the page's box instead of the screen. On a desktop it looked fine, because
 * the box was tall enough to hide the problem. On a phone the overlay stopped short of the
 * top bar, the panel was cut off at both ends, and the heading could not be scrolled to —
 * the scroll region was the page, not the viewport.
 *
 * The animation was fixed at the source, so this is belt and braces. It earns its keep
 * because the failure is silent, the cause sits three files from the symptom, and the next
 * `transform` somebody adds to a layout wrapper will not come with a warning.
 *
 * `document.body` rather than a dedicated root node: there is nothing to configure, and a
 * modal that renders before an app-provided container exists would be a bug this
 * introduced rather than solved.
 */
export function ModalLayer({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
