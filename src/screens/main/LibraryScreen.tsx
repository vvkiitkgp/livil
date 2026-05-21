import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Image,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../../theme/colors';
import { listRecentTracksForLibrary, type LibraryRecentTrack } from '../../services/tracks';

const SECTIONS = [
  { id: 'l1', title: 'Liked Songs', count: '247 tracks', accent: '#7C3AED' },
  { id: 'l2', title: 'Recently Saved', count: '34 tracks', accent: '#EC4899' },
  { id: 'l3', title: 'My Playlists', count: '12 playlists', accent: '#22D3EE' },
  { id: 'l4', title: 'Following', count: '89 artists', accent: '#F59E0B' },
];

const FALLBACK_COVER_ACCENTS: [string, string][] = [
  ['#7C3AED', '#3B1E6E'],
  ['#EC4899', '#7C3AED'],
  ['#22D3EE', '#3B82F6'],
  ['#F59E0B', '#EF4444'],
];

function RecentSkeletonStrip() {
  const placeholders = Array.from({ length: 6 }, (_, i) => i);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.recentRow}
    >
      {placeholders.map(i => (
        <View key={i} style={styles.recentCard}>
          <View style={[styles.recentCover, styles.recentCoverSkeleton]} />
          <View style={[styles.skelLine, { width: '88%' }]} />
          <View style={[styles.skelLine, { width: '62%', marginTop: 8 }]} />
        </View>
      ))}
    </ScrollView>
  );
}

export default function LibraryScreen() {
  const [recent, setRecent] = useState<LibraryRecentTrack[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const loadRecent = useCallback(async () => {
    setRecentError('');
    try {
      const rows = await listRecentTracksForLibrary();
      setRecent(rows);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load recently played.';
      setRecentError(message);
      setRecent([]);
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRecent();
    setRefreshing(false);
  }, [loadRecent]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.purpleLight}
            colors={[COLORS.purple]}
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Your Library</Text>
          <Text style={styles.subtitle}>Everything you've saved, in one place</Text>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recently Played</Text>
          <TouchableOpacity activeOpacity={0.7}>
            <Text style={styles.sectionLink}>See all</Text>
          </TouchableOpacity>
        </View>

        {recentError ? (
          <Text style={styles.inlineError}>{recentError}</Text>
        ) : null}

        {recentLoading ? (
          <RecentSkeletonStrip />
        ) : recent.length === 0 ? (
          <View style={styles.recentEmpty}>
            <Text style={styles.recentEmptyTitle}>No listening history yet</Text>
            <Text style={styles.recentEmptyBody}>
              Play a track on Home or your profile — we'll surface it here automatically.
            </Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.recentRow}
          >
            {recent.map((track, index) => {
              const initials = track.title.trim().charAt(0).toUpperCase() || '♪';
              const accents = FALLBACK_COVER_ACCENTS[index % FALLBACK_COVER_ACCENTS.length]!;
              return (
                <Pressable key={`${track.trackId}-${track.playedAt}`} style={styles.recentCard}>
                  <View style={[styles.recentCover, { backgroundColor: accents[0] }]}>
                    <View
                      style={[styles.recentCoverAccent, { backgroundColor: accents[1] }]}
                    />
                    {track.coverArtUrl ? (
                      <Image source={{ uri: track.coverArtUrl }} style={styles.recentCoverImg} />
                    ) : (
                      <Text style={styles.recentCoverInitial}>{initials}</Text>
                    )}
                  </View>
                  <Text style={styles.recentTitle} numberOfLines={1}>
                    {track.title}
                  </Text>
                  <Text style={styles.recentArtist} numberOfLines={1}>
                    {track.artistLabel}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Collections</Text>
        </View>

        <View style={styles.list}>
          {SECTIONS.map(section => (
            <View key={section.id} style={styles.row}>
              <View style={[styles.thumb, { backgroundColor: section.accent }]}>
                <Text style={styles.thumbText}>{section.title.charAt(0)}</Text>
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{section.title}</Text>
                <Text style={styles.rowSubtitle}>{section.count}</Text>
              </View>
              <Text style={styles.chev}>›</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scroll: {
    paddingBottom: 40,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  title: {
    color: COLORS.white,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 14,
    marginTop: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 14,
    marginTop: 10,
  },
  sectionTitle: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  sectionLink: {
    color: COLORS.purpleLight,
    fontSize: 13,
    fontWeight: '600',
  },
  inlineError: {
    color: COLORS.error,
    fontSize: 13,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  recentRow: {
    paddingHorizontal: 20,
    paddingBottom: 18,
    gap: 14,
  },
  recentCard: {
    width: 144,
  },
  recentCover: {
    width: 144,
    height: 144,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  recentCoverSkeleton: {
    backgroundColor: COLORS.border,
  },
  recentCoverAccent: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    bottom: -40,
    right: -40,
    opacity: 0.65,
  },
  recentCoverImg: {
    ...StyleSheet.absoluteFillObject,
  },
  recentCoverInitial: {
    color: COLORS.white,
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: -1,
  },
  recentTitle: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  recentArtist: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  recentEmpty: {
    paddingHorizontal: 24,
    paddingBottom: 22,
    gap: 8,
  },
  recentEmptyTitle: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
  },
  recentEmptyBody: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  skelLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.border,
    opacity: 0.55,
  },
  list: {
    paddingHorizontal: 20,
    gap: 10,
    paddingBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 12,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbText: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: '800',
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
  },
  rowSubtitle: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  chev: {
    color: COLORS.textMuted,
    fontSize: 24,
    fontWeight: '300',
    marginRight: 6,
  },
});
