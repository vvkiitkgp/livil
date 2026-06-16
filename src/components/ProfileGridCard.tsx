import React from 'react';
import { View, Text, StyleSheet, Pressable, Image, Dimensions } from 'react-native';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';
import EmojiCoverArt from './EmojiCoverArt';
import type { PlaylistVisibility } from '../services/playlists';

// Profile grid is 2 columns with 16px horizontal padding and 12px gap, so each
// card is roughly (screenWidth - 16*2 - 12) / 2. Snapshot at module load —
// fine for phones (no rotation in Livil).
const CARD_ART_SIZE = Math.floor((Dimensions.get('window').width - 16 * 2 - 12) / 2);

const FALLBACK_ACCENTS: [string, string][] = [
  ['#7C3AED', '#3B1E6E'],
  ['#EC4899', '#7C3AED'],
  ['#22D3EE', '#3B82F6'],
  ['#F59E0B', '#EF4444'],
];

export default function ProfileGridCard({
  title,
  subtitle,
  coverArtUrl,
  coverEmoji,
  coverColor,
  coverColor2,
  visibility,
  showVisibilityChip,
  index,
  onPress,
}: {
  title: string;
  subtitle: string;
  coverArtUrl: string | null;
  /** Playlist-only: emoji+color custom cover. Takes precedence over coverArtUrl. */
  coverEmoji?: string | null;
  coverColor?: string | null;
  /** Playlist-only: 2nd color makes it a gradient. */
  coverColor2?: string | null;
  /** Only set for playlist cards. */
  visibility?: PlaylistVisibility;
  /** Show the chip only on the owner's own profile. */
  showVisibilityChip?: boolean;
  index: number;
  onPress: () => void;
}) {
  const accents = FALLBACK_ACCENTS[index % FALLBACK_ACCENTS.length]!;
  const initial = title.trim().charAt(0).toUpperCase() || '♪';
  const hasEmojiCover = !!coverEmoji && !!coverColor;
  const chipIcon: 'public' | 'friends' | 'lock' | null = visibility === 'public' ? 'public'
    : visibility === 'friends' ? 'friends'
    : visibility === 'private' ? 'lock'
    : null;

  return (
    <Pressable style={styles.card} onPress={onPress} android_ripple={{ color: COLORS.purpleDim }}>
      <View style={styles.art}>
        {hasEmojiCover ? (
          <EmojiCoverArt
            emoji={coverEmoji ?? null}
            color={coverColor ?? null}
            color2={coverColor2 ?? null}
            size={CARD_ART_SIZE}
            borderRadius={14}
            gradientId={`grid_${index}`}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: accents[0], borderRadius: 14 }]}>
            <View style={[styles.artAccent, { backgroundColor: accents[1] }]} />
            {coverArtUrl ? (
              <Image source={{ uri: coverArtUrl }} style={StyleSheet.absoluteFill} />
            ) : (
              <Text style={styles.initial}>{initial}</Text>
            )}
          </View>
        )}
        {showVisibilityChip && chipIcon ? (
          <View style={styles.chip}>
            <Icon name={chipIcon} size={12} color={COLORS.white} />
          </View>
        ) : null}
      </View>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <Text style={styles.sub} numberOfLines={1}>{subtitle}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 0 },
  art: {
    aspectRatio: 1,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  artAccent: {
    position: 'absolute',
    width: '60%', height: '60%',
    borderRadius: 999,
    bottom: -20, right: -20,
    opacity: 0.55,
  },
  initial: { color: COLORS.white, fontSize: 44, fontWeight: '900', letterSpacing: -1 },
  emojiCover: { fontSize: 56, lineHeight: 64 },
  chip: {
    position: 'absolute', top: 8, left: 8,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: COLORS.white, fontSize: 13, fontWeight: '700' },
  sub: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
});
