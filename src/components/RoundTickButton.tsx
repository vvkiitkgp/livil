import React from 'react';
import { StyleSheet, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { COLORS } from '../theme/colors';
import { GradientBorder } from './GradientBorder';
import { Icon } from './Icon';

export const ROUND_TICK_SIZE = 32;
const SIZE = ROUND_TICK_SIZE;

/**
 * The round ✓ at the right of the "+ Something else" boxes (tags, roles) and of the comment
 * box: the purple glow when there is something to add or send, a plain grey ring while the
 * box is empty. Meant for a FormInput's `trailing` slot, which owns the gap to the field's
 * edge.
 */
export default function RoundTickButton({
  enabled,
  onPress,
  accessibilityLabel,
  style,
}: {
  enabled: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  /** The touch area around the circle (e.g. a shorter box's vertical padding). */
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!enabled}
      activeOpacity={0.7}
      style={[styles.hit, style]}
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
