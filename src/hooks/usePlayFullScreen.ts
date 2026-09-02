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
 * Waiting a beat first means the pill is on screen, is understood as the thing that is
 * now playing, and then lifts.
 *
 * Deliberately NOT part of PlaybackContext: this is presentation timing, and the
 * context is the playback seam. Screens that should not do this — the story viewer,
 * which is its own full-screen surface, and jam rooms, where playback is driven by
 * somebody else's tap — simply do not call it.
 */

/**
 * Long enough for the pill to be perceived, short enough that the screen still feels
 * like a direct response to the tap. Below ~150ms the pill is not registered; past
 * ~400ms the tap starts to feel unacknowledged.
 */
export const FS_OPEN_AFTER_PLAY_MS = 240;

export function usePlayFullScreen(): (openTab?: 'queue' | 'info') => void {
  const { openFullScreenPlayer } = usePlayback();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A tap can navigate away, or unmount the card, before the timer fires. Opening
  // full-screen after that would drag the user back to a player they have left.
  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  return useCallback((openTab?: 'queue' | 'info') => {
    if (timer.current) { clearTimeout(timer.current); }
    timer.current = setTimeout(() => {
      timer.current = null;
      openFullScreenPlayer(openTab);
    }, FS_OPEN_AFTER_PLAY_MS);
  }, [openFullScreenPlayer]);
}
