import React, { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  View,
  type ImageResizeMode,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

/**
 * ProgressiveImage — perceived-speed image loader.
 *
 * Shows a themed `placeholder` instantly, then crossfades the real image in on
 * `onLoad`. If the image fails to load (or `source.uri` is null/undefined), the
 * placeholder simply stays — folding today's `uri ? <Image/> : <Fallback/>`
 * branches into one component.
 *
 * Pure presentational: RN core `Animated` (no Reanimated / worklets), no caching
 * library, no side effects. Backed by the built-in RN `Image` so there is no
 * native module and no rebuild.
 */
export type ProgressiveImageProps = {
  /** The remote image. `uri` may be null/undefined → placeholder only. */
  source: { uri?: string | null };
  /** Container style — sizing / radius / base background (e.g. styles.audioCover). */
  style?: StyleProp<ViewStyle>;
  resizeMode?: ImageResizeMode;
  /** Rendered underneath the image and shown instantly (gradient blob, initials…). */
  placeholder?: React.ReactNode;
  /** Crossfade duration in ms once the image reports loaded. */
  fadeDuration?: number;
};

const AnimatedImage = Animated.Image;

export default function ProgressiveImage({
  source,
  style,
  resizeMode = 'cover',
  placeholder,
  fadeDuration = 200,
}: ProgressiveImageProps) {
  const uri = source?.uri ?? null;
  const opacity = useRef(new Animated.Value(0)).current;

  // Reset when the target changes (FlatList remounts on key change, but be safe
  // if this instance is reused) so the new image fades in rather than flashing
  // the previous one at full opacity.
  useEffect(() => {
    opacity.setValue(0);
  }, [uri, opacity]);

  const handleLoad = () => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: fadeDuration,
      useNativeDriver: true,
    }).start();
  };

  return (
    <View style={[style, styles.container]}>
      {/* Placeholder sits underneath, visible instantly + while the image loads
          / on error. Centered so initials & icon placeholders read correctly. */}
      {placeholder != null ? (
        <View style={styles.placeholder} pointerEvents="none">
          {placeholder}
        </View>
      ) : null}

      {uri ? (
        <AnimatedImage
          source={{ uri }}
          style={[styles.image, { opacity }]}
          resizeMode={resizeMode}
          onLoad={handleLoad}
          // No onError handler needed: on failure opacity stays 0 → placeholder shows.
          fadeDuration={0} // disable Android's built-in fade; we drive our own
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  placeholder: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    ...StyleSheet.absoluteFill,
  },
});
