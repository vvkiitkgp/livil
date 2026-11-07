/**
 * Geometry and timing for closing the floating player: drag the circle down onto the X and
 * hold it there. Pure numbers, so the rules can be tested without a gesture or a device.
 *
 * All distances are in dp. `dx`/`dy` are how far the circle has moved from where it rests.
 */

/** How long the circle must stay on the X before the player closes. */
export const CLOSE_HOLD_MS = 3000;

/** Once the X and its hint appear they stay at least this long, so a quick pull can still read them. */
export const CLOSE_HINT_MIN_MS = 1500;

/** Diameter of the X with the circle on it. It is laid out at this size, so its centre never moves. */
export const CLOSE_TARGET_SIZE = 84;

/** Diameter of the X while the circle is still on its way. */
export const CLOSE_TARGET_REST_SIZE = 52;

/** How far past the X the circle can still be dragged, so the X never feels like a wall. */
export const CLOSE_OVERDRAG = 30;

const TARGET_GAP_FROM_BOTTOM = 12;
const REVEAL_DY = 24;

// Two distances, not one: the circle snaps on at the shorter and only lets go at the longer.
// With a single line, a finger wobbling across it would restart the 3-second hold.
const OVER_ENTER_DIST = 44;
const OVER_EXIT_DIST = 64;

/** The X's distance from the bottom of the screen. */
export function closeTargetBottom(insetBottom: number): number {
  return insetBottom + TARGET_GAP_FROM_BOTTOM;
}

/** How far down the circle travels from where it rests to the centre of the X. */
export function closeTargetTravel(
  playerBottom: number,
  circleRadius: number,
  insetBottom: number,
): number {
  const circleCentre = playerBottom + circleRadius;
  const targetCentre = closeTargetBottom(insetBottom) + CLOSE_TARGET_SIZE / 2;
  return circleCentre - targetCentre;
}

/**
 * Whether this drag has become a pull DOWN. Up opens full screen and sideways flicks skip
 * songs, so the X must stay away for those: it would flash on every skip.
 */
export function shouldRevealCloseTarget(dx: number, dy: number): boolean {
  return dy >= REVEAL_DY && dy > Math.abs(dx);
}

/** How much longer the hint must stay up, given when it appeared. */
export function closeHintRemainingMs(revealedAt: number, now: number): number {
  return Math.max(0, CLOSE_HINT_MIN_MS - (now - revealedAt));
}

/** Whether the circle counts as on the X. `wasOver` is the previous answer. */
export function isOverCloseTarget(
  dx: number,
  dy: number,
  travel: number,
  wasOver: boolean,
): boolean {
  return Math.hypot(dx, dy - travel) < (wasOver ? OVER_EXIT_DIST : OVER_ENTER_DIST);
}
