import { useCallback } from 'react';
import { usePlayback } from '../contexts/PlaybackContext';
import { useToast } from '../contexts/ToastContext';
import { openInSpotify, recordSpotifyOpen, type SpotifyOpenSource } from '../services/spotify';
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
export function useOpenInSpotify(source: SpotifyOpenSource): (spotifyTrackId: string) => Promise<void> {
  const playback = usePlayback();
  const { showToast } = useToast();

  const handOff = useCallback(async (spotifyTrackId: string) => {
    if (playback.activePostId) {
      // The same pause the in-app pause button uses; pauseAll is the fallback when the
      // engine has not registered its handlers yet.
      if (playback.handlersRef.current) { playback.handlersRef.current.pause(); } else { playback.pauseAll(); }
    }
    const opened = await openInSpotify(spotifyTrackId);
    if (!opened) { showToast("Couldn't open Spotify.", { kind: 'error' }); return; }
    // Counted only once Spotify actually opened — "Stay on Livil" and failures are not plays.
    recordSpotifyOpen(spotifyTrackId, source);
  }, [playback, showToast, source]);

  return useCallback(async (spotifyTrackId: string) => {
    haptics.tap();
    // Resolves once the notice is up (or straight after handing off, if dismissed).
    await requestNotice('spotify', () => { void handOff(spotifyTrackId); });
  }, [handOff]);
}
