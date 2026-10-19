import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';
import { usePlayback } from '../contexts/PlaybackContext';
import { subscribeToOffline } from '../services/network';

/** A switch from Wi-Fi to mobile data reads as offline for a moment; don't flash for that. */
const SHOW_AFTER_MS = 1500;
/** How long "Back online" stays before the pill goes away. */
const BACK_ONLINE_MS = 2000;
const FADE_MS = 200;
/** Same spot as the toast: just under a screen's header. */
const HEADER_OFFSET = 56 + 8;

type Phase = 'offline' | 'back';

/**
 * "No internet connection" while the phone is offline, then "Back online" for two seconds
 * (owner, 2026-10-19). Over every screen, and touch-through, so it never blocks a tap. Drawn
 * under the toast (ToastProvider renders its toast after its children), so a toast that
 * arrives at the same moment covers it rather than the other way round.
 *
 * When it appears, the music pauses: offline the engine can only fail, track after track.
 * Nothing else is blocked — screens keep their spinners, the way Instagram does it (owner
 * chose this over a full-screen block, which slow-but-working internet must never trigger).
 * Play again once back online.
 */
export default function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const { activePostId, handlersRef, pauseAll } = usePlayback();
  // Read when the pill appears, not as effect dependencies: pausing changes them.
  const playbackRef = useRef({ activePostId, handlersRef, pauseAll });
  playbackRef.current = { activePostId, handlersRef, pauseAll };
  const [phase, setPhase] = useState<Phase | null>(null);
  // The last label stays on screen while the pill fades out.
  const [label, setLabel] = useState<Phase>('offline');
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let shown = false;
    const unsubscribe = subscribeToOffline(offline => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      if (offline) {
        showTimer = setTimeout(() => {
          shown = true;
          setPhase('offline');
          const p = playbackRef.current;
          if (p.activePostId) {
            // The in-app pause button's own path; pauseAll if the engine has not registered yet.
            if (p.handlersRef.current) { p.handlersRef.current.pause(); } else { p.pauseAll(); }
          }
        }, SHOW_AFTER_MS);
      } else if (shown) {
        shown = false;
        setPhase('back');
        hideTimer = setTimeout(() => setPhase(null), BACK_ONLINE_MS);
      }
    });
    return () => {
      unsubscribe();
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  useEffect(() => {
    if (phase) { setLabel(phase); }
    Animated.timing(opacity, {
      toValue: phase ? 1 : 0,
      duration: FADE_MS,
      useNativeDriver: true,
    }).start();
  }, [phase, opacity]);

  const back = label === 'back';
  return (
    <View
      pointerEvents="none"
      style={[styles.layer, { paddingTop: insets.top + HEADER_OFFSET }]}
      accessibilityLiveRegion="polite"
    >
      <Animated.View style={[styles.pill, back && styles.pillBack, { opacity }]}>
        <Icon
          name={back ? 'check' : 'offline'}
          size={15}
          color={back ? COLORS.success : COLORS.textSecondary}
        />
        <Text style={styles.text}>{back ? 'Back online' : 'No internet connection'}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    alignItems: 'center',
  },
  // The toast's pill, quieter: offline is a state, not an error.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  pillBack: { borderColor: 'rgba(34, 197, 94, 0.55)' },
  text: { color: COLORS.white, fontSize: 13, fontWeight: '600' },
});
