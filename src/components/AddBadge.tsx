import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { COLORS } from '../theme/colors';
import { useRelationships } from '../contexts/RelationshipContext';
import AddUserSheet from './AddUserSheet';

type Size = 'sm' | 'md';

const DIMS: Record<Size, { box: number; font: number; lineHeight: number }> = {
  sm: { box: 16, font: 14, lineHeight: 14 },
  md: { box: 22, font: 18, lineHeight: 18 },
};

/**
 * Small filled `＋` glyph rendered next to a username. Returns null when the
 * viewer already has any relationship with this user (friend, star, pending,
 * or self) — so it's safe to drop anywhere a user is rendered.
 */
export default function AddBadge({
  userId,
  size = 'sm',
}: {
  userId: string | null | undefined;
  size?: Size;
}) {
  const rel = useRelationships();
  const [sheetOpen, setSheetOpen] = useState(false);

  if (!userId) { return null; }
  if (rel.status(userId) !== 'none') { return null; }

  const dim = DIMS[size];

  return (
    <>
      <TouchableOpacity
        accessibilityLabel="Add user"
        onPress={() => setSheetOpen(true)}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        style={[
          styles.badge,
          { width: dim.box, height: dim.box, borderRadius: dim.box / 2 },
        ]}
      >
        <Text style={[styles.plus, { fontSize: dim.font, lineHeight: dim.lineHeight }]}>
          ＋
        </Text>
      </TouchableOpacity>
      {sheetOpen && (
        <AddUserSheet
          userId={userId}
          visible={sheetOpen}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 3,
  },
  plus: {
    color: COLORS.white,
    fontWeight: '600',
    textAlign: 'center',
  },
});
