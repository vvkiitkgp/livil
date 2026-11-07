import type { ComponentType } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';

/**
 * The glass backdrop, or null on Android.
 *
 * No blur on Android, on purpose. It has no way to blur what is behind a view, so the library
 * redraws the whole screen in software into a 1/8-size bitmap on the main thread. Below Android 13
 * that happens on every frame anything moves, which looked pixelated and stuttered on a OnePlus 7T
 * (47% of frames late, debug build). The Android 13+ shader captures the same way about 10 times a
 * second, even on a still screen.
 *
 * Required here rather than imported, so Android never loads the library: its native side is left
 * out of the Android build (react-native.config.js).
 */
export const IosGlass: ComponentType<{ style: StyleProp<ViewStyle> }> | null =
  Platform.OS === 'ios' ? require('./GlassBackdrop').default : null;
