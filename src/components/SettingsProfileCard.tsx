import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';
import { SETTINGS_PAGE_INSET } from './SettingsSection';

export type SettingsProfileCardProps = {
  displayName: string | null;
  username: string | null;
  email: string | null;
  avatarUrl: string | null;
  /** Skeleton state while the profile resolves. */
  loading?: boolean;
  onPress: () => void;
};

/** Up to two initials, matching ProfileScreen's avatar fallback. */
function initialsOf(displayName: string | null, username: string | null): string {
  const name = displayName?.trim() || username?.trim();
  if (!name) {
    return '♪';
  }
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '♪';
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

/**
 * The identity block at the top of Settings: avatar, name, handle, and the way
 * in to Edit profile.
 *
 * The camera badge is decorative — it advertises that the avatar is editable,
 * but the whole card (not the badge) is the press target, so there is no small
 * hit area to miss. Tapping anywhere lands on EditProfile, where the avatar
 * picker lives.
 */
export function SettingsProfileCard({
  displayName,
  username,
  email,
  avatarUrl,
  loading = false,
  onPress,
}: SettingsProfileCardProps) {
  const name = displayName?.trim() || (username ? `@${username}` : 'Your profile');
  // Handle line prefers the @handle and falls back to the email, so the row is
  // never blank for a Google user who has not set a display name yet.
  const secondary = username ? `@${username}` : email ?? '';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Edit profile"
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.avatarWrap}>
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitials}>{initialsOf(displayName, username)}</Text>
          </View>
        )}
        <View style={styles.cameraBadge}>
          <Icon name="camera" size={11} color={COLORS.white} />
        </View>
      </View>

      <View style={styles.text}>
        {loading ? (
          <>
            <View style={[styles.skeleton, styles.skeletonName]} />
            <View style={[styles.skeleton, styles.skeletonHandle]} />
          </>
        ) : (
          <>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            {secondary ? (
              <Text style={styles.secondary} numberOfLines={1}>
                {secondary}
              </Text>
            ) : null}
          </>
        )}
      </View>

      <Text style={styles.edit}>Edit</Text>
    </Pressable>
  );
}

const AVATAR = 58;

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: SETTINGS_PAGE_INSET,
    marginBottom: 22,
    padding: 14,
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  cardPressed: {
    backgroundColor: COLORS.card,
  },
  // Not clipped: the camera badge deliberately overhangs the avatar's corner.
  avatarWrap: {
    width: AVATAR,
    height: AVATAR,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: COLORS.card,
  },
  // Decorative fallback — exempt from the no-solid-purple-fill rule.
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.purpleDeep,
  },
  avatarInitials: {
    color: COLORS.white,
    fontSize: 21,
    fontWeight: '700',
  },
  cameraBadge: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.purple,
    // Ring in the card colour so the badge reads as detached from the avatar.
    borderWidth: 2,
    borderColor: COLORS.surface,
  },
  text: {
    flex: 1,
    gap: 3,
  },
  name: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  secondary: {
    color: COLORS.textSecondary,
    fontSize: 13.5,
  },
  edit: {
    color: COLORS.purpleNeon,
    fontSize: 14.5,
    fontWeight: '600',
  },
  skeleton: {
    backgroundColor: COLORS.card,
    borderRadius: 6,
  },
  skeletonName: {
    width: '58%',
    height: 17,
  },
  skeletonHandle: {
    width: '38%',
    height: 13,
    marginTop: 4,
  },
});

export default SettingsProfileCard;
