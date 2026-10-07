import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';

import { COLORS } from '../theme/colors';
import type { ProfilePerson } from '../services/follows';
import { mutualsParts, mutualsSentence } from '../utils/mutualsText';

const FACE = 22;
const OVERLAP = 7;

/**
 * Instagram's "Followed by" line: up to three overlapping faces, then the sentence with the
 * names in bold. Renders nothing when there is nobody in common, so a caller can always
 * mount it without checking.
 */
export default function MutualsLine({
  lead,
  people,
  otherNoun,
  onPress,
}: {
  lead: string;
  people: readonly ProfilePerson[];
  otherNoun?: { one: string; many: string };
  onPress: () => void;
}) {
  const parts = mutualsParts(lead, people.map(p => p.username), otherNoun);
  if (!parts) { return null; }
  const faces = people.slice(0, 3);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={mutualsSentence(parts)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {/* A row of Views, not Images inside Text — faces are not inline text. */}
      <View style={[styles.faces, { width: FACE + (faces.length - 1) * (FACE - OVERLAP) }]}>
        {faces.map((p, i) => (
          <View
            key={p.userId}
            style={[styles.face, { left: i * (FACE - OVERLAP), zIndex: faces.length - i }]}
          >
            {p.avatarUrl ? (
              <Image source={{ uri: p.avatarUrl }} style={styles.faceImg} />
            ) : (
              <Text style={styles.faceInitial}>
                {(p.displayName || p.username).charAt(0).toUpperCase() || '?'}
              </Text>
            )}
          </View>
        ))}
      </View>
      <Text style={styles.text} numberOfLines={2}>
        {parts.map((part, i) => (
          <Text key={i} style={part.bold ? styles.bold : undefined}>{part.text}</Text>
        ))}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, maxWidth: '100%' },
  pressed: { opacity: 0.6 },
  faces: { height: FACE },
  face: {
    position: 'absolute',
    top: 0,
    width: FACE,
    height: FACE,
    borderRadius: FACE / 2,
    // The page colour as a ring, so overlapping faces read as separate circles.
    borderWidth: 1.5,
    borderColor: COLORS.bg,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  faceImg: { width: '100%', height: '100%' },
  faceInitial: { color: COLORS.white, fontSize: 10, fontWeight: '700' },
  text: { flexShrink: 1, color: COLORS.textSecondary, fontSize: 13, lineHeight: 18 },
  bold: { color: COLORS.white, fontWeight: '700' },
});
