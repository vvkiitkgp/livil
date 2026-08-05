import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, StackActions } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../../theme/colors';
import { haptics } from '../../utils/haptics';
import { Icon } from '../../components/Icon';
import { FLOATING_PLAYER_HEIGHT } from '../../components/FloatingPlayer';
import FeedEndMessage from '../../components/FeedEndMessage';
import EmojiCoverArt from '../../components/EmojiCoverArt';
import { listRecentTracksForLibrary, type LibraryRecentTrack } from '../../services/tracks';
import {
  getLikedPostCount,
  getStarredUsersCount,
  fetchUserPlaylists,
  type UserPlaylist,
} from '../../services/playlists';
import { fetchAlbumsByUser, type AlbumSummary } from '../../services/albums';
import { supabase } from '../../../lib/supabase';
import type { RootStackParamList } from '../../navigation/types';

const FALLBACK_COVER_ACCENTS: [string, string][] = [
  ['#8B3DFF', '#3B1E6E'],
  ['#EC4899', '#8B3DFF'],
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

function PlaylistSkeleton() {
  return (
    <View style={styles.list}>
      {[0, 1, 2].map(i => (
        <View key={i} style={[styles.row, { opacity: 0.5 }]}>
          <View style={[styles.thumb, { backgroundColor: COLORS.border }]} />
          <View style={styles.rowText}>
            <View style={[styles.skelLine, { width: '55%', marginBottom: 6 }]} />
            <View style={[styles.skelLine, { width: '35%' }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function LibraryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const [recent, setRecent] = useState<LibraryRecentTrack[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState('');

  const [likedCount, setLikedCount] = useState<number | null>(null);
  const [starsCount, setStarsCount] = useState<number | null>(null);
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(true);

  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [albumsLoading, setAlbumsLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);

  const loadRecent = useCallback(async () => {
    setRecentError('');
    try {
      const rows = await listRecentTracksForLibrary();
      setRecent(rows);
    } catch (err) {
      setRecentError(err instanceof Error ? err.message : 'Could not load recently played.');
      setRecent([]);
    } finally {
      setRecentLoading(false);
    }
  }, []);

  const loadPlaylists = useCallback(async () => {
    try {
      const [liked, stars, custom] = await Promise.all([
        getLikedPostCount(),
        getStarredUsersCount(),
        fetchUserPlaylists(),
      ]);
      setLikedCount(liked);
      setStarsCount(stars);
      setPlaylists(custom);
    } catch {
      // non-critical — show zeros
    } finally {
      setPlaylistsLoading(false);
    }
  }, []);

  // Albums section appears for creators only — we silently fetch whatever the
  // viewer has; listeners with zero albums will see no section at all.
  const loadAlbums = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getUser();
      const me = data?.user?.id;
      if (!me) { setAlbums([]); return; }
      const list = await fetchAlbumsByUser(me);
      setAlbums(list);
    } catch {
      // non-critical — fall back to no albums (section just hides)
    } finally {
      setAlbumsLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void loadRecent();
    void loadPlaylists();
    void loadAlbums();
  }, [loadRecent, loadPlaylists, loadAlbums]);

  // Refresh playlists whenever the tab comes back into focus (e.g. after creating one)
  const isMounted = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!isMounted.current) {
        isMounted.current = true;
        return;
      }
      void loadPlaylists();
      void loadAlbums();
    }, [loadPlaylists, loadAlbums]),
  );

  const handleRefresh = useCallback(async () => {
    // Acknowledge the pull the moment it fires — the spinner is at the top
    // of the screen, often under the user's own thumb.
    haptics.select();
    setRefreshing(true);
    setRecentLoading(true);
    setPlaylistsLoading(true);
    setAlbumsLoading(true);
    await Promise.all([loadRecent(), loadPlaylists(), loadAlbums()]);
    setRefreshing(false);
  }, [loadRecent, loadPlaylists, loadAlbums]);

  const goToLiked = useCallback(() => {
    navigation.dispatch(StackActions.push('PlaylistDetail', { playlistId: 'liked', playlistName: 'Liked Songs' }));
  }, [navigation]);

  const goToFollowing = useCallback(() => {
    navigation.dispatch(StackActions.push('Following'));
  }, [navigation]);

  const goToPlaylist = useCallback((playlist: UserPlaylist) => {
    navigation.dispatch(StackActions.push('PlaylistDetail', { playlistId: playlist.id, playlistName: playlist.name }));
  }, [navigation]);

  const goToRecentlyPlayed = useCallback(() => {
    navigation.dispatch(StackActions.push('RecentlyPlayed'));
  }, [navigation]);

  const goToCreatePlaylist = useCallback(() => {
    navigation.dispatch(StackActions.push('CreatePlaylist'));
  }, [navigation]);

  const goToAlbum = useCallback((album: AlbumSummary) => {
    navigation.dispatch(StackActions.push('AlbumDetail', { albumId: album.id, albumTitle: album.title }));
  }, [navigation]);

  const goToCreateAlbum = useCallback(() => {
    navigation.dispatch(StackActions.push('CreateAlbum'));
  }, [navigation]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: 64 + insets.bottom + 56 + FLOATING_PLAYER_HEIGHT + 16 }]}
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

        {/* Recently Played */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recently Played</Text>
          <TouchableOpacity activeOpacity={0.7} onPress={goToRecentlyPlayed}>
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
                    <View style={[styles.recentCoverAccent, { backgroundColor: accents[1] }]} />
                    {track.coverArtUrl ? (
                      <Image source={{ uri: track.coverArtUrl }} style={styles.recentCoverImg} />
                    ) : (
                      <Text style={styles.recentCoverInitial}>{initials}</Text>
                    )}
                  </View>
                  <Text style={styles.recentTitle} numberOfLines={1}>{track.title}</Text>
                  <Text style={styles.recentArtist} numberOfLines={1}>{track.artistLabel}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* Albums — always render the section header + a "+ New" affordance so
            creators can start their first album. Once Phase 4 (Upload row +
            creator-only gating) lands, this falls back to "only show when
            viewer is a creator" — but for now anyone can spin one up to test
            the flow. */}
        {!albumsLoading ? (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Albums</Text>
              <TouchableOpacity onPress={goToCreateAlbum} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.sectionLink}>+ New</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.recentRow}
            >
              {albums.map((album, index) => {
                const accents = FALLBACK_COVER_ACCENTS[index % FALLBACK_COVER_ACCENTS.length]!;
                const initials = album.title.trim().charAt(0).toUpperCase() || '♪';
                return (
                  <Pressable
                    key={album.id}
                    style={styles.recentCard}
                    onPress={() => goToAlbum(album)}
                  >
                    <View style={[styles.recentCover, { backgroundColor: accents[0] }]}>
                      <View style={[styles.recentCoverAccent, { backgroundColor: accents[1] }]} />
                      {album.coverArtUrl ? (
                        <Image source={{ uri: album.coverArtUrl }} style={styles.recentCoverImg} />
                      ) : (
                        <Text style={styles.recentCoverInitial}>{initials}</Text>
                      )}
                    </View>
                    <Text style={styles.recentTitle} numberOfLines={1}>{album.title}</Text>
                    <Text style={styles.recentArtist} numberOfLines={1}>
                      {album.trackCount} {album.trackCount === 1 ? 'track' : 'tracks'}
                      {album.releaseYear ? ` · ${album.releaseYear}` : ''}
                    </Text>
                  </Pressable>
                );
              })}
              {/* "New album" tile — always the last card in the strip */}
              <Pressable style={styles.recentCard} onPress={goToCreateAlbum}>
                <View style={[styles.recentCover, styles.newAlbumCover]}>
                  <Icon name="add" size={32} color={COLORS.purpleLight} />
                </View>
                <Text style={styles.recentTitle} numberOfLines={1}>New album</Text>
                <Text style={styles.recentArtist} numberOfLines={1}>
                  {albums.length === 0 ? 'Start with your tracks' : 'Tag more of yours'}
                </Text>
              </Pressable>
            </ScrollView>
          </>
        ) : null}

        {/* Playlists */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Playlists</Text>
          <TouchableOpacity onPress={goToCreatePlaylist} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.sectionLink}>+ New</Text>
          </TouchableOpacity>
        </View>

        {playlistsLoading ? (
          <PlaylistSkeleton />
        ) : (
          <View style={styles.list}>
            {/* Liked Songs — virtual */}
            <TouchableOpacity style={styles.row} onPress={goToLiked} activeOpacity={0.75}>
              <View style={[styles.thumb, { backgroundColor: COLORS.purple }]}>
                <Icon name="heart" size={22} color={COLORS.white} weight="fill" />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Liked Songs</Text>
                <Text style={styles.rowSubtitle}>
                  {likedCount !== null ? `${likedCount} posts` : '—'}
                </Text>
              </View>
              <View style={{ marginRight: 6 }}>
                <Icon name="forward" size={24} color={COLORS.textMuted} />
              </View>
            </TouchableOpacity>

            {/* Following — virtual (user directory) */}
            <TouchableOpacity style={styles.row} onPress={goToFollowing} activeOpacity={0.75}>
              <View style={[styles.thumb, { backgroundColor: '#F59E0B' }]}>
                <Icon name="musicNote" size={22} color={COLORS.white} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Following</Text>
                <Text style={styles.rowSubtitle}>
                  {starsCount !== null ? `${starsCount} artists` : '—'}
                </Text>
              </View>
              <View style={{ marginRight: 6 }}>
                <Icon name="forward" size={24} color={COLORS.textMuted} />
              </View>
            </TouchableOpacity>

            {/* User custom playlists */}
            {playlists.map((playlist, index) => {
              const accents = FALLBACK_COVER_ACCENTS[(index + 2) % FALLBACK_COVER_ACCENTS.length]!;
              const initials = playlist.name.trim().charAt(0).toUpperCase() || '♪';
              const hasEmojiCover = !!playlist.coverEmoji && !!playlist.coverColor;
              return (
                <TouchableOpacity
                  key={playlist.id}
                  style={styles.row}
                  onPress={() => goToPlaylist(playlist)}
                  activeOpacity={0.75}
                >
                  {hasEmojiCover ? (
                    <EmojiCoverArt
                      emoji={playlist.coverEmoji}
                      color={playlist.coverColor}
                      color2={playlist.coverColor2}
                      size={52}
                      borderRadius={12}
                      gradientId={`lib_${playlist.id}`}
                    />
                  ) : (
                    <View style={[styles.thumb, { backgroundColor: accents[0], overflow: 'hidden' }]}>
                      {playlist.coverArtUrl ? (
                        <Image source={{ uri: playlist.coverArtUrl }} style={StyleSheet.absoluteFill} />
                      ) : (
                        <Text style={styles.thumbText}>{initials}</Text>
                      )}
                    </View>
                  )}
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{playlist.name}</Text>
                    <Text style={styles.rowSubtitle}>
                      {playlist.postCount} {playlist.postCount === 1 ? 'post' : 'posts'}
                    </Text>
                  </View>
                  <View style={{ marginRight: 6 }}>
                    <Icon name="forward" size={24} color={COLORS.textMuted} />
                  </View>
                </TouchableOpacity>
              );
            })}

            {playlists.length === 0 && (
              <View style={styles.emptyPlaylists}>
                <Text style={styles.emptyPlaylistsText}>
                  No playlists yet — add posts from the player using the + button.
                </Text>
              </View>
            )}
          </View>
        )}

        {!playlistsLoading && (
          <FeedEndMessage
            title="Your record crate, sorted"
            subtitle="Every track, playlist, and artist you've saved — all on one shelf."
          />
        )}
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
    paddingBottom: 0, // dynamic bottom padding set inline via insets
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
  newAlbumCover: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
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
    ...StyleSheet.absoluteFill,
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
  thumbEmoji: {
    fontSize: 28,
    lineHeight: 34,
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
  emptyPlaylists: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  emptyPlaylistsText: {
    color: COLORS.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
});
