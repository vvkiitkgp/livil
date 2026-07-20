import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Pressable,
  Image,
  RefreshControl,
  ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';
import { Button } from './Button';
import { FLOATING_PLAYER_HEIGHT } from './FloatingPlayer';
import EmojiCoverArt from './EmojiCoverArt';
import type { PlaylistVisibility } from '../services/playlists';

export type DetailTrack = {
  id: string;
  title: string;
  subtitle?: string;
  coverArtUrl: string | null;
  /** Shown on the right for ALBUM rows. Ignored for playlist rows. */
  durationSec: number | null;
  /** Shown on the right for PLAYLIST rows (poster's avatar). Ignored for album rows. */
  posterAvatarUrl?: string | null;
  /** Initials fallback for the playlist row's right-avatar when posterAvatarUrl is null. */
  posterName?: string | null;
};

export type DetailKind = 'album' | 'playlist';

export type DetailViewProps = {
  kind: DetailKind;
  title: string;
  coverArtUrl: string | null;
  /** Playlist-only emoji+color cover; takes precedence over coverArtUrl when both present. */
  coverEmoji?: string | null;
  coverColor?: string | null;
  coverColor2?: string | null;
  // Owner
  ownerHandle: string;
  ownerDisplayName: string | null;
  isOwner: boolean;
  // Album-only metadata
  releaseYear?: number | null;
  // Playlist-only metadata
  visibility?: PlaylistVisibility;
  // Stats line
  countLabel: string;        // "5 tracks" / "12 posts"
  totalDurationSec?: number; // album: sum of track durations. playlist: optional.
  // Tracks
  tracks: DetailTrack[];
  currentTrackId: string | null;
  // Actions
  onBack: () => void;
  onPlay: () => void;
  onShuffle: () => void;
  onPressTrack: (index: number) => void;
  onPressOwner: () => void;
  onOverflow?: () => void;
  // Empty state
  emptyTitle?: string;
  emptyBody?: string;
  // Pull-to-refresh
  refreshing?: boolean;
  onRefresh?: () => void;
};

const FALLBACK_ACCENTS: [string, string][] = [
  ['#8B3DFF', '#3B1E6E'],
  ['#EC4899', '#8B3DFF'],
  ['#22D3EE', '#3B82F6'],
  ['#F59E0B', '#EF4444'],
];

function formatDuration(sec: number | null | undefined): string {
  if (!sec || sec <= 0) { return '—'; }
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatTotalDuration(sec: number): string {
  if (sec <= 0) { return ''; }
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) { return `${h}h ${m}m`; }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function visibilityChip(v: PlaylistVisibility): { icon: 'public' | 'friends' | 'lock'; label: string } {
  switch (v) {
    case 'public': return { icon: 'public', label: 'Public' };
    case 'friends': return { icon: 'friends', label: 'Friends only' };
    case 'private': return { icon: 'lock', label: 'Private' };
  }
}

function TrackRow({
  item,
  index,
  isCurrent,
  kind,
  showSubtitle,
  onPress,
}: {
  item: DetailTrack;
  index: number;
  isCurrent: boolean;
  kind: DetailKind;
  showSubtitle: boolean;
  onPress: () => void;
}) {
  const accents = FALLBACK_ACCENTS[index % FALLBACK_ACCENTS.length]!;
  const initial = item.title.trim().charAt(0).toUpperCase() || '♪';
  // For playlists, surface the poster's avatar on the right (rows can be by
  // different uploaders). For albums, every row is the same uploader (already
  // shown in the hero) so we surface duration instead.
  const showPosterAvatar = kind === 'playlist';
  const posterInitial = (item.posterName ?? '').trim().charAt(0).toUpperCase() || '♪';

  return (
    <Pressable
      style={[rowStyles.row, isCurrent && rowStyles.rowActive]}
      onPress={onPress}
      android_ripple={{ color: COLORS.purpleDim }}
    >
      <Text style={[rowStyles.num, isCurrent && rowStyles.numActive]}>{index + 1}</Text>
      <View style={[rowStyles.cover, { backgroundColor: accents[0] }]}>
        <View style={[rowStyles.coverAccent, { backgroundColor: accents[1] }]} />
        {item.coverArtUrl ? (
          <Image source={{ uri: item.coverArtUrl }} style={StyleSheet.absoluteFill} />
        ) : (
          <Text style={rowStyles.coverInitial}>{initial}</Text>
        )}
      </View>
      <View style={rowStyles.body}>
        <Text style={[rowStyles.title, isCurrent && rowStyles.titleActive]} numberOfLines={1}>{item.title}</Text>
        {showSubtitle && item.subtitle ? (
          <Text style={rowStyles.subtitle} numberOfLines={1}>{item.subtitle}</Text>
        ) : null}
      </View>
      {showPosterAvatar ? (
        <View style={rowStyles.posterAvatar}>
          {item.posterAvatarUrl ? (
            <Image source={{ uri: item.posterAvatarUrl }} style={StyleSheet.absoluteFill} />
          ) : (
            <Text style={rowStyles.posterInitial}>{posterInitial}</Text>
          )}
        </View>
      ) : (
        <Text style={rowStyles.duration}>{formatDuration(item.durationSec)}</Text>
      )}
    </Pressable>
  );
}

export default function DetailView(props: DetailViewProps) {
  const {
    kind, title, coverArtUrl, coverEmoji, coverColor, coverColor2,
    ownerHandle, ownerDisplayName, isOwner,
    releaseYear, visibility, countLabel, totalDurationSec, tracks, currentTrackId,
    onBack, onPlay, onShuffle, onPressTrack, onPressOwner, onOverflow,
    emptyTitle, emptyBody, refreshing, onRefresh,
  } = props;
  const hasEmojiCover = !!coverEmoji && !!coverColor;

  const insets = useSafeAreaInsets();

  const metaLine = useMemo(() => {
    const parts: string[] = [countLabel];
    if (totalDurationSec && totalDurationSec > 0) { parts.push(formatTotalDuration(totalDurationSec)); }
    if (releaseYear) { parts.push(String(releaseYear)); }
    return parts.join(' · ');
  }, [countLabel, totalDurationSec, releaseYear]);

  const heroAccent = FALLBACK_ACCENTS[(title.length) % FALLBACK_ACCENTS.length]!;

  const visChip = visibility ? visibilityChip(visibility) : null;

  const showRowSubtitle = kind === 'playlist';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Icon name="back" size={28} color={COLORS.white} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        {isOwner && onOverflow ? (
          <TouchableOpacity style={styles.iconBtn} onPress={onOverflow} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="overflow" size={24} color={COLORS.white} />
          </TouchableOpacity>
        ) : <View style={styles.iconBtn} />}
      </View>

      <FlatList
        data={tracks}
        keyExtractor={(t, i) => `${t.id}:${i}`}
        refreshControl={onRefresh ? (
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.purpleLight}
            colors={[COLORS.purple]}
          />
        ) : undefined}
        renderItem={({ item, index }: ListRenderItemInfo<DetailTrack>) => (
          <TrackRow
            item={item}
            index={index}
            isCurrent={currentTrackId === item.id}
            kind={kind}
            showSubtitle={showRowSubtitle}
            onPress={() => onPressTrack(index)}
          />
        )}
        contentContainerStyle={{ paddingBottom: insets.bottom + 64 + FLOATING_PLAYER_HEIGHT + 16 }}
        ListHeaderComponent={
          <View style={styles.hero}>
            {hasEmojiCover ? (
              <View style={{ marginBottom: 12 }}>
                <EmojiCoverArt
                  emoji={coverEmoji ?? null}
                  color={coverColor ?? null}
                  color2={coverColor2 ?? null}
                  size={180}
                  borderRadius={14}
                  gradientId="detailHero"
                />
              </View>
            ) : (
              <View style={[styles.heroArt, { backgroundColor: heroAccent[0] }]}>
                <View style={[styles.heroArtAccent, { backgroundColor: heroAccent[1] }]} />
                {coverArtUrl ? (
                  <Image source={{ uri: coverArtUrl }} style={StyleSheet.absoluteFill} />
                ) : (
                  <Text style={styles.heroInitial}>{title.trim().charAt(0).toUpperCase() || '♪'}</Text>
                )}
              </View>
            )}

            <View style={[styles.kindTag, kind === 'playlist' && styles.kindTagPlaylist]}>
              <Icon name={kind === 'album' ? 'disc' : 'playlist'} size={11} color={kind === 'album' ? COLORS.purpleLight : COLORS.info} />
              <Text style={[styles.kindTagText, kind === 'playlist' && styles.kindTagTextPlaylist]}>
                {kind === 'album' ? 'ALBUM' : 'PLAYLIST'}
              </Text>
            </View>

            <Text style={styles.heroTitle}>{title}</Text>

            <TouchableOpacity onPress={onPressOwner} hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}>
              <Text style={styles.ownerLine}>
                <Text style={styles.ownerBy}>by </Text>
                <Text style={styles.ownerHandle}>@{ownerHandle}</Text>
                {ownerDisplayName ? <Text style={styles.ownerDisplay}>  ·  {ownerDisplayName}</Text> : null}
              </Text>
            </TouchableOpacity>

            {visChip ? (
              <View style={[styles.visChip, visChipStyle(visibility!)]}>
                <Icon name={visChip.icon} size={11} color={visChipColor(visibility!)} />
                <Text style={[styles.visChipText, { color: visChipColor(visibility!) }]}>{visChip.label}</Text>
              </View>
            ) : null}

            <Text style={styles.metaLine}>{metaLine}</Text>

            {tracks.length > 0 ? (
              <View style={styles.actionRow}>
                <Button label="Play" icon="play" variant="primary" size="md" onPress={onPlay} style={styles.pill} />
                <Button label="Shuffle" icon="shuffle" variant="secondary" size="md" onPress={onShuffle} style={styles.pill} />
              </View>
            ) : null}

            {tracks.length > 0 ? (
              <Text style={styles.tracksLabel}>{kind === 'album' ? 'TRACKS' : 'POSTS'}</Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{emptyTitle ?? (kind === 'album' ? 'No tracks in this album yet' : 'No posts in this playlist yet')}</Text>
            <Text style={styles.emptyBody}>{emptyBody ?? (kind === 'album' ? 'Tag a track into this album from the track’s overflow menu.' : 'Add posts from the full-screen player using the + button.')}</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

function visChipStyle(v: PlaylistVisibility) {
  switch (v) {
    case 'public': return { backgroundColor: 'rgba(0, 200, 83, 0.10)', borderColor: 'rgba(0, 200, 83, 0.35)' };
    case 'friends': return { backgroundColor: 'rgba(167, 139, 250, 0.12)', borderColor: 'rgba(167, 139, 250, 0.35)' };
    case 'private': return { backgroundColor: COLORS.errorBg, borderColor: COLORS.errorBorder };
  }
}

function visChipColor(v: PlaylistVisibility): string {
  switch (v) {
    case 'public': return '#00C853';
    case 'friends': return COLORS.purpleLight;
    case 'private': return COLORS.error;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 6 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  hero: { paddingHorizontal: 24, paddingTop: 4, paddingBottom: 18, alignItems: 'center' },
  heroArt: {
    width: 180, height: 180, borderRadius: 14, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  heroArtAccent: {
    position: 'absolute', width: 140, height: 140, borderRadius: 70,
    bottom: -40, right: -40, opacity: 0.55,
  },
  heroInitial: { color: COLORS.white, fontSize: 64, fontWeight: '900' },
  heroEmojiCover: { fontSize: 96, lineHeight: 110 },

  kindTag: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(167,139,250,0.45)', marginTop: 4,
  },
  kindTagPlaylist: { borderColor: COLORS.infoBorder },
  kindTagText: { color: COLORS.purpleLight, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  kindTagTextPlaylist: { color: COLORS.info },

  heroTitle: { color: COLORS.white, fontSize: 24, fontWeight: '900', textAlign: 'center', marginTop: 8, letterSpacing: -0.4 },
  ownerLine: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4, textAlign: 'center' },
  ownerBy: { color: COLORS.textSecondary },
  ownerHandle: { color: COLORS.purpleLight, fontWeight: '700' },
  ownerDisplay: { color: COLORS.textSecondary },

  visChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999,
    borderWidth: 1, marginTop: 8,
  },
  visChipText: { fontSize: 11, fontWeight: '700' },

  metaLine: { color: COLORS.textSecondary, fontSize: 12, marginTop: 8 },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  pill: { paddingHorizontal: 22 },

  tracksLabel: { color: COLORS.textSecondary, fontSize: 10, letterSpacing: 1.5, fontWeight: '700', alignSelf: 'flex-start', marginTop: 22 },

  empty: { paddingHorizontal: 24, paddingTop: 20, alignItems: 'center', gap: 10 },
  emptyTitle: { color: COLORS.white, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  emptyBody: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
});

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 22, paddingVertical: 9,
  },
  rowActive: { backgroundColor: COLORS.purpleDim },
  num: { width: 18, color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', textAlign: 'right' },
  numActive: { color: COLORS.purpleLight },
  cover: {
    width: 42, height: 42, borderRadius: 6, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  coverAccent: {
    position: 'absolute', width: 32, height: 32, borderRadius: 16,
    bottom: -12, right: -12, opacity: 0.6,
  },
  coverInitial: { color: COLORS.white, fontSize: 17, fontWeight: '900' },
  body: { flex: 1, minWidth: 0 },
  title: { color: COLORS.white, fontSize: 14, fontWeight: '600' },
  titleActive: { color: COLORS.purpleLight },
  subtitle: { color: COLORS.textSecondary, fontSize: 11, marginTop: 1 },
  duration: { color: COLORS.textSecondary, fontSize: 12 },
  posterAvatar: {
    width: 28, height: 28, borderRadius: 14, overflow: 'hidden',
    backgroundColor: COLORS.purple,
    alignItems: 'center', justifyContent: 'center',
  },
  posterInitial: { color: COLORS.white, fontSize: 12, fontWeight: '800' },
});
