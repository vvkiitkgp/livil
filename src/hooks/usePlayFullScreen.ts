import { useCallback, useEffect, useRef } from 'react';
import { usePlayback } from '../contexts/PlaybackContext';

/**
 * Tapping a song opens the full-screen player — after the floating player has been
 * seen to appear.
 *
 * WHY THE DELAY EXISTS, because a timeout in UI code is usually a smell and this one
 * is load-bearing. `FloatingPlayer` already animates between its two shapes: the thin
 * pill it is while a track plays in the background, and the expanded form it takes
 * under the full-screen player. That morph is driven by `isFullScreenOpen`, and it
 * springs up 220ms after the flag flips (`OPEN_MORPH_DELAY` in FloatingPlayer).
 *
 * Opening full-screen in the same tick as starting playback skips the interesting
 * half of that: the pill mounts and is instantly covered, so what the user sees is a
 * screen appearing out of nowhere rather than the player they started rising into it.
 * Waiting first means the pill is on screen, is understood as the thing that is now
 * playing, and then lifts.
 *
 * HOW LONG TO WAIT DEPENDS ON WHETHER THE PILL IS ALREADY THERE, which is the whole
 * subtlety — see the two constants below.
 *
 * Deliberately NOT part of PlaybackContext: this is presentation timing, and the
 * context is the playback seam. Screens that should not do this — the story viewer,
 * which is its own full-screen surface, and jam rooms, where playback is driven by
 * somebody else's tap — simply do not call it.
 */

/**
 * When the pill is ARRIVING — nothing was playing, so `FloatingPlayer` is springing up
 * from below the screen.
 *
 * This is the number that was wrong on the first attempt. It was 240ms, chosen against
 * FloatingPlayer's `OPEN_MORPH_DELAY`, which is a different animation entirely: the pill
 * has its own entrance, `Animated.spring(slideAnim, { bounciness: 6 })`, and a default
 * spring at that bounciness takes on the order of half a second to settle. Opening at
 * 240ms burst the player open while the pill was still travelling, so the thing the delay
 * exists to show — the pill arriving, then lifting — was never visible.
 *
 * Tuned by eye rather than measured; it is meant to land just after the spring settles.
 */
export const FS_OPEN_AFTER_PILL_ARRIVES_MS = 520;

/**
 * When the pill is ALREADY on screen, because something was already playing. There is no
 * entrance to wait for — only a beat so the tap and the screen are not the same instant.
 */
export const FS_OPEN_WHEN_PILL_PRESENT_MS = 180;

export function usePlayFullScreen(): (openTab?: 'queue' | 'info') => void {
  const { openFullScreenPlayer, nowPlaying } = usePlayback();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A tap can navigate away, or unmount the card, before the timer fires. Opening
  // full-screen after that would drag the user back to a player they have left.
  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  return useCallback((openTab?: 'queue' | 'info') => {
    // `nowPlaying` here is the value from the render this callback was created in —
    // i.e. BEFORE the caller's setNowPlaying lands. So null means the pill is about to
    // appear and its entrance is worth waiting for; non-null means it is already up and
    // making the user wait half a second would just feel slow.
    const wait = nowPlaying
      ? FS_OPEN_WHEN_PILL_PRESENT_MS
      : FS_OPEN_AFTER_PILL_ARRIVES_MS;

    if (timer.current) { clearTimeout(timer.current); }
    timer.current = setTimeout(() => {
      timer.current = null;
      openFullScreenPlayer(openTab);
    }, wait);
  }, [openFullScreenPlayer, nowPlaying]);
}
