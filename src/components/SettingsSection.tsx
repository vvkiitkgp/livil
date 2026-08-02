import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme/colors';
import { SETTINGS_ROW_INSET } from './SettingsRow';

export type SettingsSectionProps = {
  /** Muted group header. Omit for an unlabelled group. */
  title?: string;
  children: React.ReactNode;
};

/**
 * A group of `SettingsRow`s. Owns the separators so rows do not need to know
 * whether they are last.
 */
export function SettingsSection({ title, children }: SettingsSectionProps) {
  const rows = React.Children.toArray(children);

  return (
    <View style={styles.section}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {rows.map((row, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <View style={styles.separator} /> : null}
          {row}
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 24,
  },
  title: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
    paddingHorizontal: SETTINGS_ROW_INSET,
    marginBottom: 4,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginLeft: SETTINGS_ROW_INSET,
  },
});

export default SettingsSection;
