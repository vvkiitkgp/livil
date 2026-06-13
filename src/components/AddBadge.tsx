import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { COLORS } from '../theme/colors';
import { useRelationships } from '../contexts/RelationshipContext';
import AddUserSheet from './AddUserSheet';

type Size = 'sm' | 'md';

/**
 * Pill-shaped "+ Add" button rendered next to a username. Returns null when the
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

  const isMd = size === 'md';

  return (
    <>
      <TouchableOpacity
        accessibilityLabel="Add user"
        onPress={() => setSheetOpen(true)}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        style={[styles.pill, isMd ? styles.pillMd : styles.pillSm]}
      >
        <Text style={[styles.icon, isMd ? styles.iconMd : styles.iconSm]}>+</Text>
        <Text style={[styles.label, isMd ? styles.labelMd : styles.labelSm]}>Add</Text>
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
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1,
    borderColor: COLORS.purple,
    borderRadius: 20,
  },
  pillSm: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    gap: 2,
  },
  pillMd: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    gap: 3,
  },
  icon: {
    color: COLORS.purple,
    fontWeight: '700',
  },
  iconSm: {
    fontSize: 10,
    lineHeight: 14,
  },
  iconMd: {
    fontSize: 12,
    lineHeight: 16,
  },
  label: {
    color: COLORS.purple,
    fontWeight: '600',
  },
  labelSm: {
    fontSize: 10,
    lineHeight: 14,
  },
  labelMd: {
    fontSize: 12,
    lineHeight: 16,
  },
});
