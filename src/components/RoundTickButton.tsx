import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../theme/colors';
import { GradientBorder } from './GradientBorder';
import { Icon } from './Icon';

const SIZE = 32;

/**
 * The round ✓ at the right of the "+ Something else" boxes (tags, roles): the purple glow
 * when there is something to add, a plain grey ring while the box is empty. Meant for a
 * FormInput's `trailing` slot, which owns the gap to the field's edge.
 */
export default function RoundTickButton({
  enabled,
  onPress,
  accessibilityLabel,
}: {
  enabled: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!enabled}
      activeOpacity={0.7}
      style={styles.hit}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !enabled }}
    >
      <View style={[styles.circle, !enabled && styles.circleIdle]}>
        {enabled ? <GradientBorder borderRadius={SIZE / 2} /> : null}
        <Icon name="check" size={16} color={enabled ? COLORS.purpleNeon : COLORS.textMuted} weight="bold" />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  hit: { paddingLeft: 8, paddingRight: 10, paddingVertical: 8 },
  circle: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleIdle: { borderWidth: 1.5, borderColor: COLORS.border },
});
