import { useCallback, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useJam } from '../contexts/JamContext';
import { usePlayback } from '../contexts/PlaybackContext';
import type { RootStackParamList } from '../navigation/types';

/** How long the floating player takes to slide away after a close (FloatingPlayer: 200 ms), and a little more. */
const PLAYER_GONE_MS = 260;

/**
 * "+ Post" (Home and Profile): closes the player — the same close as holding the circle on the X:
 * music stopped, queue emptied, player and lock-screen card gone — then opens the post flow once
 * the player has slid away, with `busy` true meanwhile for the button's spinner (owner,
 * 2026-11-10). Every way on from New Post stops the music anyway, and on Android the player
 * could only be hidden under it. Nothing playing, or in a Jam (the hold-to-close asks before
 * ending one for everyone): it just opens.
 */
export function useOpenPostFlow() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { closePlayer, nowPlaying } = usePlayback();
  const { activeJam } = useJam();
  const [busy, setBusy] = useState(false);
  // A ref, not state: two quick taps both see `busy` false in the same render.
  const opening = useRef(false);

  const open = useCallback((route: 'AddToLivil' | 'Upload') => {
    if (opening.current) return;
    if (!nowPlaying || activeJam) { navigation.navigate(route); return; }
    opening.current = true;
    setBusy(true);
    console.log(`[LIVIL][POST] + Post → closePlayer, then ${route}`);
    closePlayer();
    setTimeout(() => {
      opening.current = false;
      setBusy(false);
      navigation.navigate(route);
    }, PLAYER_GONE_MS);
  }, [navigation, closePlayer, nowPlaying, activeJam]);

  return { open, busy };
}
