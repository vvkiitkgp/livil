import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme/colors';
import { GradientBorder } from './GradientBorder';
import { Icon, type IconName } from './Icon';
import { SETTINGS_PAGE_INSET } from './SettingsSection';

export type SettingsHighlightCardProps = {
  icon: IconName;
  title: string;
  subtitle: string;
  /** Trailing pill label, e.g. "Invite". Omit for a plain pressable card. */
  actionLabel?: string;
  onPress: () => void;
};

const RADIUS = 18;

/**
 * The promoted card in Settings — Livil's answer to the screenshots' solid-blue
 * "Free plan / Upgrade" banner.
 *
 * A solid purple fill is exactly what the design system forbids at this size,
 * so the emphasis comes from a `GradientBorder` glow over the normal surface
 * instead. That reads as "this one is special" without a slab of #8B3DFF.
 *
 * No `overflow: 'hidden'` on the host: GradientBorder draws its bloom inward
 * within the bounds, and clipping to the padding box shaves the outer edge of
 * the glow along the curves.
 */
export function SettingsHighlightCard({
  icon,
  title,
  subtitle,
  actionLabel,
  onPress,
}: SettingsHighlightCardProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <GradientBorder borderRadius={RADIUS} />

      <View style={styles.tile}>
        <Icon name={icon} size={21} color={COLORS.purpleNeon} />
      </View>

      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>

      {actionLabel ? (
        <View style={styles.pill}>
          <Text style={styles.pillLabel}>{actionLabel}</Text>
        </View>
      ) : (
        <Icon name="disclosure" size={18} color={COLORS.textMuted} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    marginHorizontal: SETTINGS_PAGE_INSET,
    marginBottom: 22,
    padding: 15,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS,
  },
  cardPressed: {
    backgroundColor: COLORS.card,
  },
  tile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.purpleDim,
  },
  text: {
    flex: 1,
    gap: 3,
  },
  title: {
    color: COLORS.white,
    fontSize: 15.5,
    fontWeight: '700',
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    lineHeight: 17,
  },
  pill: {
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.purple,
  },
  pillLabel: {
    // purpleNeon, not purple: #8B3DFF on #12121C fails WCAG AA at this size.
    color: COLORS.purpleNeon,
    fontSize: 13.5,
    fontWeight: '700',
  },
});

export default SettingsHighlightCard;
