import React, {useEffect} from 'react';
import {StatusBar, StyleSheet} from 'react-native';
import {NavigationContainer, DarkTheme} from '@react-navigation/native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {KeyboardProvider} from 'react-native-keyboard-controller';
import {startMapper, stopMapper} from 'react-native-reanimated';
import RootNavigator from './src/navigation/RootNavigator';
import {PlaybackProvider} from './src/contexts/PlaybackContext';
import {ToastProvider} from './src/contexts/ToastContext';
import {navigationRef, flushPendingNavigation, setCurrentRoute} from './src/navigation/navigationRef';
import {hideNativeSplash} from './src/native/splashScreen';

const AppTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#0A0A0F',
  },
};

/**
 * Force-initialize Reanimated's mapper registry on the UI thread.
 *
 * keyboard-controller's KeyboardProvider registers Reanimated event handlers
 * immediately on mount. Those handlers call global.__mapperRun() after each
 * event. However, __mapperRun is only assigned when the first mapper is
 * started (via useAnimatedStyle, useDerivedValue, etc.). If no component
 * has used any Reanimated mapper by the time the first keyboard event fires,
 * __mapperRun is undefined → crash:
 *
 *   "undefined is not a function"
 *   at [UI]: handleEvent (react-native-reanimated/src/core.ts:94)
 *
 * This hook starts a no-op mapper on mount to ensure the registry exists
 * before any keyboard event can fire.
 */
function useInitReanimatedMappers() {
  useEffect(() => {
    const id = startMapper(() => {
      'worklet';
    });
    return () => stopMapper(id);
  }, []);
}

export default function App(): React.JSX.Element {
  useInitReanimatedMappers();

  // Hand off from the native cold-start splash to our React splash. rAF waits
  // until after the first frame has been committed/painted, so dismissing the
  // native splash reveals the React SplashScreen underneath with no blank gap.
  useEffect(() => {
    const id = requestAnimationFrame(() => hideNativeSplash());
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <KeyboardProvider>
        <StatusBar barStyle="light-content" backgroundColor="#0A0A0F" />
        <PlaybackProvider>
          <NavigationContainer
            theme={AppTheme}
            ref={navigationRef}
            onReady={flushPendingNavigation}
            onStateChange={state => {
              const route = state?.routes?.[state.index ?? 0];
              if (route) {
                setCurrentRoute({ name: route.name, params: route.params as Record<string, unknown> | undefined });
              }
            }}>
            <ToastProvider>
              <RootNavigator />
            </ToastProvider>
          </NavigationContainer>
        </PlaybackProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#0A0A0F'},
});
