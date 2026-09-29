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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import { haptics } from '../../utils/haptics';
import { listRecentTracksPage, type LibraryRecentTrack } from '../../services/tracks';
import { Icon } from '../../components/Icon';
import { usePlayRecentlyPlayed } from '../../hooks/usePlayRecentlyPlayed';

const PAGE_SIZE = 30;

const FALLBACK_ACCENTS: [string, string][] = [
  ['#8B3DFF', '#3B1E6E'],
  ['#EC4899', '#8B3DFF'],
  ['#22D3EE', '#3B82F6'],
  ['#F59E0B', '#EF4444'],
];

function TrackRow({
  item,
  index,
  onPress,
}: {
  item: LibraryRecentTrack;
  index: number;
  onPress: (item: LibraryRecentTrack) => void;
}) {
  const accents = FALLBACK_ACCENTS[index % FALLBACK_ACCENTS.length]!;
  const initials = item.title.trim().charAt(0).toUpperCase() || '♪';

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={`${item.title} by ${item.artistLabel}`}
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
        <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.artist} numberOfLines={1}>{item.artistLabel}</Text>
      </View>
    </Pressable>
  );
}

export default function RecentlyPlayedScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [tracks, setTracks] = useState<LibraryRecentTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Where the next page starts; null = no more history. From the raw rows, not the
  // visible ones — a hidden row must not make a full page look like the last one.
  const [nextBefore, setNextBefore] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await listRecentTracksPage(PAGE_SIZE);
      setTracks(page.items);
      setNextBefore(page.nextBefore);
      setError('');
    } catch (err) {
      // Keep whatever is already on screen; only an empty list shows the error.
      setError(err instanceof Error ? err.message : 'Could not load recently played.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Coming back from a post you just played should show it at the top.
  const firstFocus = React.useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) { firstFocus.current = false; return; }
      void load();
    }, [load]),
  );

  const handleEndReached = useCallback(async () => {
    if (loadingMore || !nextBefore) { return; }
    setLoadingMore(true);
    try {
      const page = await listRecentTracksPage(PAGE_SIZE, nextBefore);
      setTracks(prev => [...prev, ...page.items.filter(m => !prev.some(p => p.trackId === m.trackId))]);
      setNextBefore(page.nextBefore);
    } catch {
      // Silent: the next scroll to the end retries.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextBefore]);

  // Play the tapped row, with the whole list queued in the same order.
  const playRecent = usePlayRecentlyPlayed();
  const handleOpen = useCallback((item: LibraryRecentTrack) => {
    void playRecent(tracks, tracks.indexOf(item));
  }, [playRecent, tracks]);

  const handleRefresh = useCallback(async () => {
    // Acknowledge the pull the moment it fires — the spinner is at the top
    // of the screen, often under the user's own thumb.
    haptics.select();
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const renderItem = useCallback(({ item, index }: ListRenderItemInfo<LibraryRecentTrack>) => (
    <TrackRow item={item} index={index} onPress={handleOpen} />
  ), [handleOpen]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Icon name="back" size={32} color={COLORS.white} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Recently Played</Text>
          {!loading && tracks.length > 0 && (
            <Text style={styles.headerSubtitle}>
              {tracks.length}{nextBefore ? '+' : ''} {tracks.length === 1 ? 'track' : 'tracks'}
            </Text>
          )}
        </View>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={COLORS.purpleLight} style={styles.loader} />
      ) : error && tracks.length === 0 ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <FlatList
          data={tracks}
          keyExtractor={item => item.trackId}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={COLORS.purpleLight} style={styles.more} /> : null
          }
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
              <Text style={styles.emptyTitle}>No listening history yet</Text>
              <Text style={styles.emptyBody}>
                Play a track for a few seconds — it will show up here.
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
  rowPressed: { opacity: 0.6 },
  more: { marginVertical: 16 },

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
  artist: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

  empty: { paddingHorizontal: 24, paddingTop: 60, alignItems: 'center', gap: 10 },
  emptyTitle: { color: COLORS.white, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  emptyBody: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
