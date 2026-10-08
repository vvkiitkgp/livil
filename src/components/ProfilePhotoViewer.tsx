import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { COLORS } from '../theme/colors';

type Props = {
  /** The photo to show; the viewer renders nothing without one. */
  uri: string | null;
  visible: boolean;
  onClose: () => void;
  /** For screen readers: "@riya's profile photo". */
  label: string;
};

/** Share of the screen's shorter side the photo fills — Instagram's enlarged circle. */
const FILL = 0.8;
const ENTER_MS = 180;

/**
 * Instagram-style profile photo viewer: the avatar, enlarged into a big circle over a
 * dimmed screen. Tap anywhere (or Android back) to close.
 *
 * Opened by tapping the profile avatar, on ProfileScreen (your own) and
 * UserProfileScreen (anyone else's).
 *
 * Avatars are stored cropped to 512×512 (profileService AVATAR_CROP_OPTIONS), so the
 * circle is capped at FILL of the screen rather than going edge to edge.
 */
export default function ProfilePhotoViewer({ uri, visible, onClose, label }: Props) {
  const { width, height } = useWindowDimensions();
  const size = Math.round(Math.min(width, height) * FILL);

  // Kept mounted through the fade-out, then unmounted.
  const [shown, setShown] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setShown(true);
      Animated.spring(progress, {
        toValue: 1,
        speed: 18,
        bounciness: 6,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(progress, {
        toValue: 0,
        duration: ENTER_MS,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setShown(false);
        }
      });
    }
  }, [visible, progress]);

  if (!uri) {
    return null;
  }

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });

  return (
    <Modal
      visible={shown}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={`${label}. Tap to close`}
      >
        <Animated.View style={[styles.backdrop, { opacity: progress }]}>
          <Animated.View
            style={[
              styles.circle,
              { width: size, height: size, borderRadius: size / 2 },
              { opacity: progress, transform: [{ scale }] },
            ]}
          >
            <Image source={{ uri }} style={styles.photo} resizeMode="cover" />
          </Animated.View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // overflow: 'hidden' clips the square photo to the circle — a real clip of a child
  // image, not a GradientBorder host (CLAUDE.md allows it here).
  circle: {
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
});
