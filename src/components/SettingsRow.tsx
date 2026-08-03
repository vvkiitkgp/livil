import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { COLORS } from '../theme/colors';
import { Icon, type IconName } from './Icon';

/** Row's horizontal padding. */
export const SETTINGS_ROW_INSET = 14;

/** Tile size + gap, exported so SettingsSection aligns separators to the label. */
export const SETTINGS_ICON_TILE = 34;
export const SETTINGS_ICON_GAP = 12;

export type SettingsRowProps = {
  label: string;
  /** Second line under the label, e.g. "Friends can see what you're playing". */
  subtitle?: string;
  /**
   * Leading glyph, drawn inside a tinted rounded tile. Optional so rows in an
   * icon-less group stay flush-left.
   */
  icon?: IconName;
  /** Tint override for the icon tile — used by destructive rows. */
  iconColor?: string;
  iconBackground?: string;
  /** Omit for a non-interactive row (a `value`-only row). */
  onPress?: () => void;
  /** Right-hand static value, e.g. "On" / "@vvk". Ignored when `toggle` is set. */
  value?: string;
  /**
   * Renders a Switch on the right instead of a chevron. The row itself becomes
   * the switch's hit target, which is why pressing the row flips the value.
   */
  toggle?: {
    value: boolean;
    onValueChange: (next: boolean) => void;
    disabled?: boolean;
  };
  /**
   * Irreversible actions (delete account) get a red label and red icon tile —
   * no fill, no border, no separate row shape.
   */
  destructive?: boolean;
  /** Swaps the chevron for an "opens outside the app" glyph. */
  external?: boolean;
  /** Off for rows that act rather than navigate, e.g. Sign out. */
  chevron?: boolean;
  disabled?: boolean;
};

/**
 * A settings list row. Deliberately not `Button`: settings entries are list
 * rows, and button chrome (outline, gradient border) stacks into a column of
 * chunky controls. No `android_ripple` — it paints a rectangle that ignores
 * borderRadius.
 *
 * The leading icon sits in a `purpleDim` tile. That tile is one of the
 * documented exceptions to the no-solid-purple-fill rule: it is a 34px
 * decorative container at 15% alpha, not a control.
 */
export function SettingsRow({
  label,
  subtitle,
  icon,
  iconColor,
  iconBackground,
  onPress,
  value,
  toggle,
  destructive = false,
  external = false,
  chevron = true,
  disabled = false,
}: SettingsRowProps) {
  const tint = iconColor ?? (destructive ? COLORS.error : COLORS.purple);
  const tileBg = iconBackground ?? (destructive ? COLORS.errorBg : COLORS.purpleDim);

  // A toggle row's press target is the whole row, so tapping the label flips
  // the switch — a bare Switch is a small target on a 56px row.
  const handlePress = toggle ? () => toggle.onValueChange(!toggle.value) : onPress;

  const body = (
    <>
      {icon ? (
        <View style={[styles.tile, { backgroundColor: tileBg }]}>
          <Icon name={icon} size={19} color={tint} />
        </View>
      ) : null}

      <View style={styles.text}>
        <Text style={[styles.label, destructive && styles.labelDestructive]} numberOfLines={1}>
          {label}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {toggle ? (
        <Switch
          value={toggle.value}
          onValueChange={toggle.onValueChange}
          disabled={toggle.disabled || disabled}
          // The false-state track is the input background, not grey: on
          // #0A0A0F a default grey track reads as a disabled control.
          trackColor={{ false: COLORS.inputBg, true: COLORS.purple }}
          thumbColor={COLORS.white}
          ios_backgroundColor={COLORS.inputBg}
        />
      ) : value ? (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null}

      {!toggle && chevron ? (
        <View style={styles.chevron}>
          <Icon
            name={external ? 'externalLink' : 'disclosure'}
            size={external ? 16 : 18}
            color={COLORS.textMuted}
          />
        </View>
      ) : null}
    </>
  );

  if (!handlePress) {
    return <View style={styles.row}>{body}</View>;
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole={toggle ? 'switch' : 'button'}
      accessibilityLabel={label}
      accessibilityHint={subtitle}
      accessibilityState={toggle ? { checked: toggle.value, disabled } : { disabled }}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
        disabled && styles.rowDisabled,
      ]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingVertical: 11,
    paddingHorizontal: SETTINGS_ROW_INSET,
    gap: SETTINGS_ICON_GAP,
  },
  rowPressed: {
    backgroundColor: COLORS.card,
  },
  rowDisabled: {
    opacity: 0.45,
  },
  tile: {
    width: SETTINGS_ICON_TILE,
    height: SETTINGS_ICON_TILE,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: 2,
  },
  label: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '500',
  },
  labelDestructive: {
    color: COLORS.error,
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    lineHeight: 17,
  },
  value: {
    color: COLORS.textSecondary,
    fontSize: 14,
    maxWidth: 140,
  },
  chevron: {
    marginLeft: 2,
  },
});

export default SettingsRow;
