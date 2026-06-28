import { NativeModules } from 'react-native';

const { SplashScreen } = NativeModules as {
  SplashScreen?: { hide?: () => void };
};

/**
 * Dismiss the native cold-start splash. Call this once React has painted its
 * first frame (e.g. our React SplashScreen is on screen) so the hand-off has
 * no blank gap. Safe to call on any platform / if the module is absent.
 */
export function hideNativeSplash(): void {
  SplashScreen?.hide?.();
}
