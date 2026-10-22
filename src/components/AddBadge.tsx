import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { COLORS } from '../theme/colors';
import { useRelationships } from '../contexts/RelationshipContext';
import AddUserSheet from './AddUserSheet';
import { GradientBorder } from './GradientBorder';
import { Icon } from './Icon';

type Size = 'sm' | 'md';

const PILL_RADIUS = 999;

/**
 * Pill-shaped "+ Friend" button rendered next to a username (it read "+ Add", then
 * briefly "+ Vibe", until the owner settled on Friend, 2026-10-22); it opens AddUserSheet
 * (Friend or Star). Returns null when the viewer already has any relationship with this
 * user (friend, star, pending, or self) — so it's safe to drop anywhere a user is rendered.
 *
 * Hidden by default until relationships have loaded. Before `ready` the context's
 * sets are empty, so every user reads as 'none' — rendering the pill on every row
 * of the feed and inbox and then popping it off the friends a moment later. Absent
 * is the safe default: the only cost is the badge appearing a beat late for someone
 * you really can add.
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
  if (!rel.ready) { return null; }
  if (rel.status(userId) !== 'none') { return null; }

  const isMd = size === 'md';

  return (
    <>
      <TouchableOpacity
        accessibilityLabel="Add as friend or star"
        onPress={() => setSheetOpen(true)}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        style={[styles.pill, isMd ? styles.pillMd : styles.pillSm]}
      >
        {/* The Button look at pill size: see-through, purple gradient glow outline, neon
            label (owner, 2026-10-22: the old purple-tinted fill read as off-theme). */}
        <GradientBorder borderRadius={PILL_RADIUS} strokeWidth={1} />
        <Icon name="add" size={isMd ? 12 : 10} color={COLORS.purpleNeon} />
        <Text style={[styles.label, isMd ? styles.labelMd : styles.labelSm]}>Friend</Text>
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
  // No fill and no flat border: GradientBorder is the outline. No overflow: 'hidden'
  // either — it would shave the glow's outer edge (see CLAUDE.md, Buttons).
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: PILL_RADIUS,
  },
  pillSm: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 2,
  },
  pillMd: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 3,
  },
  // purpleNeon, not purple: #8B3DFF fails contrast on the dark background.
  label: {
    color: COLORS.purpleNeon,
    fontWeight: '700',
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
