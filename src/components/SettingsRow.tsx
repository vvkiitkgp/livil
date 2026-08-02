import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';

/** Row's left padding. `SettingsSection` insets separators by this so they align with the label. */
export const SETTINGS_ROW_INSET = 16;

export type SettingsRowProps = {
  label: string;
  onPress: () => void;
  /**
   * Irreversible actions (delete account) get a red label and nothing else —
   * no fill, no border, no separate row shape.
   */
  destructive?: boolean;
  /** Off for rows that act rather than navigate, e.g. Sign out. */
  chevron?: boolean;
};

/**
 * A settings list row. Deliberately not `Button`: settings entries are list
 * rows, and button chrome (outline, gradient border) stacks into a column of
 * chunky controls. No `android_ripple` — it paints a rectangle that ignores
 * borderRadius.
 */
export function SettingsRow({
  label,
  onPress,
  destructive = false,
  chevron = true,
}: SettingsRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Text style={[styles.label, destructive && styles.labelDestructive]} numberOfLines={1}>
        {label}
      </Text>
      {chevron ? (
        <View style={styles.chevron}>
          <Icon name="disclosure" size={18} color={COLORS.textMuted} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingVertical: 14,
    paddingHorizontal: SETTINGS_ROW_INSET,
  },
  rowPressed: {
    backgroundColor: COLORS.surface,
  },
  label: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '500',
    flexShrink: 1,
  },
  labelDestructive: {
    color: COLORS.error,
  },
  chevron: {
    marginLeft: 12,
  },
});

export default SettingsRow;
