import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme/colors';
import {
  SETTINGS_ICON_GAP,
  SETTINGS_ICON_TILE,
  SETTINGS_ROW_INSET,
} from './SettingsRow';

/** Page gutter. Cards inset from the screen edge; headers align to the card. */
export const SETTINGS_PAGE_INSET = 16;

export type SettingsSectionProps = {
  /** Uppercase muted group header. Omit for an unlabelled group. */
  title?: string;
  /**
   * Separators normally start under the label (past the icon tile). Set this
   * for a group whose rows have no icon, so they run the full card width.
   */
  flushSeparators?: boolean;
  children: React.ReactNode;
};

/**
 * A card of `SettingsRow`s. Owns the separators so rows do not need to know
 * whether they are last.
 *
 * `overflow: 'hidden'` is correct here and is not the GradientBorder trap:
 * this card has no gradient outline to clip, and the clip is what keeps a
 * pressed row's highlight inside the rounded corners.
 */
export function SettingsSection({
  title,
  flushSeparators = false,
  children,
}: SettingsSectionProps) {
  // `toArray` drops null/false children, so `{cond ? <Row/> : null}` inside a
  // section does not leave a stray separator behind.
  const rows = React.Children.toArray(children);
  if (rows.length === 0) {
    return null;
  }

  const separatorInset = flushSeparators
    ? 0
    : SETTINGS_ROW_INSET + SETTINGS_ICON_TILE + SETTINGS_ICON_GAP;

  return (
    <View style={styles.group}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <View style={styles.card}>
        {rows.map((row, i) => (
          <React.Fragment key={i}>
            {i > 0 ? (
              <View style={[styles.separator, { marginLeft: separatorInset }]} />
            ) : null}
            {row}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    marginBottom: 22,
    paddingHorizontal: SETTINGS_PAGE_INSET,
  },
  title: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
  },
});

export default SettingsSection;
