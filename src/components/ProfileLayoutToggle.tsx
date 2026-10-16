import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { COLORS } from '../theme/colors';
import { GradientBorder } from './GradientBorder';
import { Icon, type IconName } from './Icon';
import type { ProfileLayout } from '../hooks/useProfileLayout';
import { haptics } from '../utils/haptics';

const OPTIONS: { value: ProfileLayout; icon: IconName; label: string }[] = [
  { value: 'list', icon: 'layoutList', label: 'Show as a list' },
  { value: 'grid', icon: 'layoutGrid', label: 'Show as a grid' },
];

/**
 * The list ↔ grid switch at the end of the profile's tab row (Reposts and Uploads only).
 * The chosen side wears the purple outline, like the selected tab pill beside it.
 */
export default function ProfileLayoutToggle({
  value,
  onChange,
}: {
  value: ProfileLayout;
  onChange: (next: ProfileLayout) => void;
}) {
  return (
    <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel="Layout">
      {OPTIONS.map(o => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              if (on) { return; }
              haptics.select();
              onChange(o.value);
            }}
            hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
            style={({ pressed }) => [styles.option, pressed && !on && styles.optionPressed]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
          >
            {on ? <GradientBorder borderRadius={999} /> : null}
            <Icon name={o.icon} size={18} color={on ? COLORS.purpleNeon : COLORS.textSecondary} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    gap: 2,
    padding: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  option: {
    width: 36,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionPressed: { opacity: 0.6 },
});
