import { useCallback } from 'react';
import { usePlayback } from '../contexts/PlaybackContext';
import { useToast } from '../contexts/ToastContext';
import { openInSpotify, recordSpotifyOpen, type SpotifyOpenSource } from '../services/spotify';
import { scheduleSpotifyReturnNudge, type SpotifyReturnNudgeContext } from '../services/spotifyReturnNudge';
import { requestNotice } from '../components/OnboardingNotice';
import { haptics } from '../utils/haptics';

/**
 * "Play on Spotify", the same way everywhere (ADR-0027): first the "Sorry, this one plays
 * on Spotify" notice (unless dismissed on this device), then pause Livil and hand the song
 * to the Spotify app. "Stay on Livil" leaves Livil playing, untouched.
 *
 * PAUSED, not cleared. The Livil track stays loaded with its lock-screen card, so coming
 * back is one tap on play. And Livil never loads the Spotify song itself — the single
 * engine (GlobalAudioPlayer) only ever plays Livil media.
 */
export function useOpenInSpotify(
  source: SpotifyOpenSource,
  options: {
    /**
     * Skip the "plays on Spotify" notice — for a screen where Spotify is the whole point
     * (Repost a song, SpotifyRepostScreen). Also REQUIRED there: that screen is an iOS modal sheet, and the
     * notice is a Modal of its own, which iOS will not present over it — the tap did nothing
     * (owner report, 2026-10-19).
     */
    notice?: boolean;
  } = {},
): (spotifyTrackId: string, nudge?: SpotifyReturnNudgeContext) => Promise<void> {
  const notice = options.notice ?? true;
  const playback = usePlayback();
  const { showToast } = useToast();

  /**
   * `nudge` — the friend's repost the song was opened from, when there is one: it schedules
   * the "Like or comment on Riya's repost" card that follows the person into Spotify
   * (spotifyReturnNudge). Callers pass it only for a post by someone else.
   */
  const handOff = useCallback(async (spotifyTrackId: string, nudge?: SpotifyReturnNudgeContext) => {
    if (playback.activePostId) {
      // The same pause the in-app pause button uses; pauseAll is the fallback when the
      // engine has not registered its handlers yet.
      if (playback.handlersRef.current) { playback.handlersRef.current.pause(); } else { playback.pauseAll(); }
    }
    const opened = await openInSpotify(spotifyTrackId);
    if (!opened) { showToast("Couldn't open Spotify.", { kind: 'error' }); return; }
    // Counted only once Spotify actually opened — "Stay on Livil" and failures are not plays.
    recordSpotifyOpen(spotifyTrackId, source);
    // The way back: a card a few seconds later, gone the moment Livil is in front again.
    if (nudge) { void scheduleSpotifyReturnNudge(nudge); }
  }, [playback, showToast, source]);

  return useCallback(async (spotifyTrackId: string, nudge?: SpotifyReturnNudgeContext) => {
    haptics.tap();
    if (!notice) { await handOff(spotifyTrackId, nudge); return; }
    // Resolves once the notice is up (or straight after handing off, if dismissed).
    await requestNotice('spotify', () => { void handOff(spotifyTrackId, nudge); });
  }, [handOff, notice]);
}
