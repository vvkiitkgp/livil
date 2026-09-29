import React, { useEffect, useMemo, useRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { COLORS } from '../theme/colors';
import {
  MAX_FACES,
  clusterLayout,
  faceInitials,
  hashString,
  type GroupFace,
  type Slot,
} from '../utils/groupFaces';

/** Fallback fills for faces with no photo — decorative, exempt from the no-fill rule. */
const FALLBACK_FILLS = [
  COLORS.purpleRoyal,
  COLORS.purpleDeep,
  COLORS.purpleDeepest,
  COLORS.infoDeep,
  COLORS.card,
];

const MOVE_MS = 350;

/**
 * The group picture: up to six members' faces packed into a circle, the most recent
 * speaker largest and ringed. `faces` must already be in "last spoke" order.
 *
 * `visitSeed` is the per-visit shuffle — change it (e.g. on screen focus) and the whole
 * arrangement rotates to a new random position. When the order of `faces` changes (a
 * new message), each face glides to its new slot; slots never move on their own.
 * Faces are keyed by user id, so a person keeps their view across moves.
 */
export default function GroupAvatarCluster({
  conversationId,
  faces,
  size,
  visitSeed,
  fallbackLabel,
}: {
  conversationId: string;
  faces: GroupFace[] | undefined;
  size: number;
  visitSeed: number;
  /** Shown when there are no faces yet (first load, or a fetch failed). */
  fallbackLabel: string;
}) {
  const shown = useMemo(() => (faces ?? []).slice(0, MAX_FACES), [faces]);
  const slots = useMemo(
    () => clusterLayout(shown.length, conversationId, visitSeed),
    [shown.length, conversationId, visitSeed],
  );

  const label = useMemo(() => {
    if (shown.length === 0) { return fallbackLabel; }
    const names = shown.slice(0, 2).map(f => f.displayName || f.username || 'someone');
    const rest = (faces?.length ?? 0) - names.length;
    return `Group picture: ${names.join(', ')}${rest > 0 ? ` and ${rest} other${rest === 1 ? '' : 's'}` : ''}`;
  }, [shown, faces, fallbackLabel]);

  if (shown.length === 0) {
    return (
      <View
        style={[styles.frame, styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}
        accessible
        accessibilityLabel={fallbackLabel}
      >
        <Text style={[styles.fallbackText, { fontSize: size * 0.3 }]}>
          {fallbackLabel.trim().slice(0, 2).toUpperCase() || '♪'}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[styles.frame, { width: size, height: size, borderRadius: size / 2 }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      {shown.map((f, i) => (
        <Face
          key={f.userId}
          face={f}
          slot={slots[i]!}
          frame={size}
          latest={i === 0 && f.lastSentAt !== null}
        />
      ))}
    </View>
  );
}

function Face({
  face,
  slot,
  frame,
  latest,
}: {
  face: GroupFace;
  slot: Slot;
  frame: number;
  latest: boolean;
}) {
  const half = frame / 2;
  const d = slot.r * frame; // diameter in px (r is a fraction of the RADIUS → r*2*half)
  const left = half + slot.x * half - d / 2;
  const top = half + slot.y * half - d / 2;

  const x = useSharedValue(left);
  const y = useSharedValue(top);
  const s = useSharedValue(d);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    x.value = withTiming(left, { duration: MOVE_MS });
    y.value = withTiming(top, { duration: MOVE_MS });
    s.value = withTiming(d, { duration: MOVE_MS });
  }, [left, top, d, x, y, s]);

  const style = useAnimatedStyle(() => ({
    left: x.value,
    top: y.value,
    width: s.value,
    height: s.value,
    borderRadius: s.value / 2,
  }));

  const stroke = latest ? Math.max(1.5, frame * 0.03) : Math.max(1, frame * 0.02);
  const fill = FALLBACK_FILLS[hashString(face.userId) % FALLBACK_FILLS.length];

  return (
    <Animated.View
      style={[
        styles.face,
        { borderWidth: stroke, borderColor: latest ? COLORS.purpleNeon : COLORS.bg, backgroundColor: fill },
        style,
      ]}
    >
      {face.avatarUrl ? (
        <Image source={{ uri: face.avatarUrl }} style={styles.photo} />
      ) : d >= 14 ? (
        // Below ~14px a letter is illegible; the coloured dot alone reads as "and others".
        <Text style={[styles.initials, { fontSize: Math.max(7, d * 0.38) }]} numberOfLines={1}>
          {faceInitials(face)}
        </Text>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  frame: { backgroundColor: COLORS.surface, position: 'relative' },
  fallback: {
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1,
    borderColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackText: { color: COLORS.purpleLight, fontWeight: '700' },
  // overflow: 'hidden' is right here: it clips the photo to the circle (the avatar
  // exception to the GradientBorder rule — there is no GradientBorder on this view).
  face: { position: 'absolute', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  photo: { width: '100%', height: '100%' },
  initials: { color: COLORS.white, fontWeight: '700' },
});
