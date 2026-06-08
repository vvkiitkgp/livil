import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Pressable,
  Image,
  RefreshControl,
  ActivityIndicator,
  ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, StackActions } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import { fetchLikedPosts, fetchPlaylistPosts, type PlaylistItem } from '../../services/playlists';
import { usePlayback } from '../../contexts/PlaybackContext';
import type { NowPlayingInfo } from '../../contexts/PlaybackContext';

type Props = NativeStackScreenProps<RootStackParamList, 'PlaylistDetail'>;

const FALLBACK_ACCENTS: [string, string][] = [
  ['#7C3AED', '#3B1E6E'],
  ['#EC4899', '#7C3AED'],
  ['#22D3EE', '#3B82F6'],
  ['#F59E0B', '#EF4444'],
];

function TrackRow({
  item,
  index,
  onPress,
  isCurrent,
}: {
  item: PlaylistItem;
  index: number;
  onPress: () => void;
  isCurrent: boolean;
}) {
  const accents = FALLBACK_ACCENTS[index % FALLBACK_ACCENTS.length]!;
  const initials = item.title.trim().charAt(0).toUpperCase() || '♪';

  return (
    <Pressable
      style={[styles.row, isCurrent && styles.rowActive]}
      onPress={onPress}
      android_ripple={{ color: COLORS.purpleDim }}
    >
      <View style={[styles.cover, { backgroundColor: accents[0] }]}>
        <View style={[styles.coverAccent, { backgroundColor: accents[1] }]} />
        {item.coverArtUrl ? (
          <Image source={{ uri: item.coverArtUrl }} style={StyleSheet.absoluteFill} />
        ) : (
          <Text style={styles.coverInitial}>{initials}</Text>
        )}
      </View>
      <View style={styles.meta}>
        <Text style={[styles.title, isCurrent && styles.titleActive]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>{item.artistName}</Text>
      </View>
      {isCurrent && <View style={styles.activeDot} />}
    </Pressable>
  );
}

export default function PlaylistScreen({ route }: Props) {
  const { playlistId, playlistName } = route.params;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { nowPlaying, setQueue, setNowPlaying, requestPlay, openFullScreenPlayer } = usePlayback();

  const [items, setItems] = useState<PlaylistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const data = playlistId === 'liked'
        ? await fetchLikedPosts()
        : await fetchPlaylistPosts(playlistId);
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load playlist.');
    } finally {
      setLoading(false);
    }
  }, [playlistId]);

  useEffect(() => { void load(); }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handlePressItem = useCallback((index: number) => {
    if (items.length === 0) { return; }
    const toInfo = (item: typeof items[number]): NowPlayingInfo => ({
      postId: item.postId,
      trackId: item.trackId,
      title: item.title,
      artistName: item.artistName,
      authorId: item.authorId,
      authorUsername: item.authorUsername,
      authorAvatarUrl: item.authorAvatarUrl,
      coverArtUrl: item.coverArtUrl,
      thumbnailUrl: item.thumbnailUrl,
      mediaKind: item.mediaKind,
      audioUrl: item.audioUrl ?? undefined,
      videoUrl: item.videoUrl ?? undefined,
      likesCount: 0,
      commentsCount: 0,
      repostsCount: 0,
      viewsCount: 0,
      viewerHasLiked: false,
      clipStartSec: null,
      clipEndSec: null,
      kind: 'upload',
      originalPostId: null,
      knownDurationSec: 0,
    });
    const queue = items.map(toInfo);
    setQueue(queue, index, `playlist:${playlistName}`);
    setNowPlaying(queue[index]!);
    requestPlay(queue[index]!.postId);
    openFullScreenPlayer();
  }, [items, playlistName, setQueue, setNowPlaying, requestPlay, openFullScreenPlayer]);

  const renderItem = useCallback(({ item, index }: ListRenderItemInfo<PlaylistItem>) => (
    <TrackRow
      item={item}
      index={index}
      onPress={() => handlePressItem(index)}
      isCurrent={nowPlaying?.postId === item.postId}
    />
  ), [handlePressItem, nowPlaying?.postId]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{playlistName}</Text>
          {!loading && (
            <Text style={styles.headerSubtitle}>
              {items.length} {items.length === 1 ? 'post' : 'posts'}
            </Text>
          )}
        </View>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={COLORS.purpleLight} style={styles.loader} />
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item.postId}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.purpleLight}
              colors={[COLORS.purple]}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>
                {playlistId === 'liked' ? 'No liked posts yet' : 'No posts in this playlist yet'}
              </Text>
              <Text style={styles.emptyBody}>
                {playlistId === 'liked'
                  ? 'Like posts from the home feed — they appear here automatically.'
                  : 'Add posts from the full-screen player using the + button.'}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  backBtn: { width: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { color: COLORS.white, fontSize: 32, fontWeight: '300', lineHeight: 36 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: COLORS.white, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  headerSubtitle: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

  loader: { marginTop: 60 },
  errorText: { color: COLORS.error, fontSize: 14, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },

  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 12,
  },
  rowActive: { backgroundColor: COLORS.purpleDim },

  cover: {
    width: 52,
    height: 52,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  coverAccent: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    bottom: -16,
    right: -16,
    opacity: 0.65,
  },
  coverInitial: { color: COLORS.white, fontSize: 22, fontWeight: '900' },

  meta: { flex: 1, minWidth: 0 },
  title: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  titleActive: { color: COLORS.purpleLight },
  artist: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.purple, flexShrink: 0 },

  empty: { paddingHorizontal: 24, paddingTop: 60, alignItems: 'center', gap: 10 },
  emptyTitle: { color: COLORS.white, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  emptyBody: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
