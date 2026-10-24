import { AppState, Platform } from 'react-native';

/**
 * Whether something arriving over realtime must NOT be marked seen yet: Android with the
 * app in the background. Android keeps the realtime socket open while backgrounded
 * (RealtimeConnectionGate), so events land with nobody looking; the screen marks them on
 * return instead. iOS answers false: its behaviour is deliberately unchanged.
 */
export function seenMustWait(): boolean {
  return Platform.OS === 'android' && AppState.currentState === 'background';
}
