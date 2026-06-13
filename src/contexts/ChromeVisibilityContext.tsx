import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { Animated } from 'react-native';

/**
 * Drives the bottom nav bar (tab bar) + floating music player (FMP) hide/show on
 * feed scroll. Both live OUTSIDE the screens (tab bar in AppNavigator, FMP in
 * RootNavigator), so a screen can't move them directly — they subscribe to this
 * shared anim instead.
 *
 * `hiddenAnim`: 0 = fully visible, 1 = slid off the bottom edge. The tab bar and
 * FMP each interpolate it into their own translateY. Scroll DOWN hides; scroll UP
 * (or reaching the top) shows again, near-instantly.
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
    // Fast, no-bounce return so it pops back the instant the user scrolls up.
    Animated.timing(hiddenAnim, {
      toValue: 0,
      duration: 130,
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
