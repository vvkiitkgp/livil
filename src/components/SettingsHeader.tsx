import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';

export type SettingsHeaderProps = {
  title: string;
  onBack: () => void;
};

/**
 * The shared bar across the four settings screens.
 *
 * No bottom hairline: the screens below are cards on the page background, so a
 * rule under the title fights the card edges. The header instead separates by
 * whitespace, matching the reference design.
 */
export function SettingsHeader({ title, onBack }: SettingsHeaderProps) {
  return (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.btn}
        onPress={onBack}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Icon name="back" size={30} color={COLORS.white} />
      </TouchableOpacity>
      <View style={styles.center}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {/* Mirrors the back button's width so the title stays optically centred. */}
      <View style={styles.btn} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  btn: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
});

export default SettingsHeader;
