import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { Animated } from 'react-native';

/**
 * Drives the bottom nav bar (tab bar) hide/show on feed scroll. The tab bar lives
 * OUTSIDE the screens (in AppNavigator), so a screen can't move it directly — it
 * subscribes to this shared anim instead.
 *
 * `hiddenAnim`: 0 = fully visible, 1 = slid off the bottom edge. The tab bar
 * interpolates it into a translateY. Behaviour: hide on scroll DOWN, show again
 * instantly on scroll UP (or when near the top).
 *
 * NOTE: the floating music player does NOT subscribe to this — it stays visible at
 * all times so playback state + controls are always reachable.
 */
type ChromeVisibility = {
  /** 0 visible → 1 hidden. Consume with `.interpolate` for a translateY. */
  hiddenAnim: Animated.Value;
  hideChrome: () => void;
  showChrome: () => void;
};

const ChromeVisibilityContext = createContext<ChromeVisibility | null>(null);

export function ChromeVisibilityProvider({ children }: { children: React.ReactNode }) {
  const hiddenAnim = useRef(new Animated.Value(0)).current;
  const isHidden = useRef(false);

  const hideChrome = useCallback(() => {
    if (isHidden.current) { return; }
    isHidden.current = true;
    Animated.timing(hiddenAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [hiddenAnim]);

  const showChrome = useCallback(() => {
    if (!isHidden.current) { return; }
    isHidden.current = false;
    // Snappy, no-bounce return so it pops back the instant the user scrolls up.
    Animated.timing(hiddenAnim, {
      toValue: 0,
      duration: 110,
      useNativeDriver: true,
    }).start();
  }, [hiddenAnim]);

  const value = useMemo(
    () => ({ hiddenAnim, hideChrome, showChrome }),
    [hiddenAnim, hideChrome, showChrome],
  );

  return (
    <ChromeVisibilityContext.Provider value={value}>
      {children}
    </ChromeVisibilityContext.Provider>
  );
}

export function useChromeVisibility(): ChromeVisibility {
  const ctx = useContext(ChromeVisibilityContext);
  if (!ctx) {
    throw new Error('useChromeVisibility must be used within a ChromeVisibilityProvider');
  }
  return ctx;
}
