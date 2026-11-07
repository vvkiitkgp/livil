/** Far enough to mean it, or a shorter flick. A short slow drag changes nothing. */
const SWIPE_DISTANCE = 80;
const FLICK_DISTANCE = 20;
const FLICK_VELOCITY = 500;

/** Whether a finished rightward drag from the screen's edge counts as going back. */
export function isSwipeBack(translationX: number, velocityX: number): boolean {
  return (
    translationX >= SWIPE_DISTANCE ||
    (translationX >= FLICK_DISTANCE && velocityX >= FLICK_VELOCITY)
  );
}
