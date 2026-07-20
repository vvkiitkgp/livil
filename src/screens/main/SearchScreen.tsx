import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Image,
  type ViewToken,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import FormInput from '../../components/FormInput';
import AddBadge from '../../components/AddBadge';
import PostCard from '../../components/PostCard';
import CommentsSheet from '../../components/CommentsSheet';
import { useCommentsCountDeltas } from '../../hooks/useCommentsCountDeltas';
import { COLORS } from '../../theme/colors';
import type { RootStackParamList } from '../../navigation/types';
import { searchProfiles, type ProfileSearchResult } from '../../services/tracks';
import { searchPosts, type FeedPost } from '../../services/posts';
import { searchAlbums, type AlbumSearchResult } from '../../services/albums';
import { supabase } from '../../../lib/supabase';
import { Icon } from '../../components/Icon';
import { GradientBorder } from '../../components/GradientBorder';
import { FLOATING_PLAYER_HEIGHT } from '../../components/FloatingPlayer';

type Tab = 'users' | 'tracks' | 'albums';

const FALLBACK_ACCENTS: [string, string][] = [
  ['#8B3DFF', '#3B1E6E'],
  ['#EC4899', '#8B3DFF'],
  ['#22D3EE', '#3B82F6'],
  ['#F59E0B', '#EF4444'],
];
type NavProp = NativeStackNavigationProp<RootStackParamList>;

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) { return '?'; }
  if (parts.length === 1) { return parts[0].slice(0, 2).toUpperCase(); }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function SearchScreen() {
  const navigation = useNavigation<NavProp>();
  const insets = useSafeAreaInsets();
  const comments = useCommentsCountDeltas();
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const handlePostDeleted = useCallback((postId: string) => {
    setDeletedIds(prev => {
      if (prev.has(postId)) { return prev; }
      const next = new Set(prev);
      next.add(postId);
      return next;
    });
  }, []);

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('users');
  const [userResults, setUserResults] = useState<ProfileSearchResult[]>([]);
  const [trackResults, setTrackResults] = useState<FeedPost[]>([]);
  const [albumResults, setAlbumResults] = useState<AlbumSearchResult[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [loadingAlbums, setLoadingAlbums] = useState(false);
  const [errorUsers, setErrorUsers] = useState('');
  const [errorTracks, setErrorTracks] = useState('');
  const [errorAlbums, setErrorAlbums] = useState('');
  const [meId, setMeId] = useState<string | null>(null);
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setMeId(data?.user?.id ?? null);
    });
  }, []);

  // Debounced user search
  useEffect(() => {
    if (tab !== 'users') { return; }
    let cancelled = false;
    setLoadingUsers(true);
    setErrorUsers('');
    const t = setTimeout(async () => {
      try {
        const data = await searchProfiles(query, {
          excludeUserIds: meId ? [meId] : [],
          limit: 20,
        });
        if (!cancelled) { setUserResults(data); }
      } catch (err) {
        if (!cancelled) {
          setErrorUsers(err instanceof Error ? err.message : 'Search failed.');
        }
      } finally {
        if (!cancelled) { setLoadingUsers(false); }
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, tab, meId]);

  // Debounced track search
  useEffect(() => {
    if (tab !== 'tracks') { return; }
    let cancelled = false;
    setLoadingTracks(true);
    setErrorTracks('');
    const t = setTimeout(async () => {
      try {
        const data = await searchPosts(query, { limit: 20 });
        if (!cancelled) { setTrackResults(data); }
      } catch (err) {
        if (!cancelled) {
          setErrorTracks(err instanceof Error ? err.message : 'Search failed.');
        }
      } finally {
        if (!cancelled) { setLoadingTracks(false); }
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, tab]);

  // Debounced album search
  useEffect(() => {
    if (tab !== 'albums') { return; }
    let cancelled = false;
    setLoadingAlbums(true);
    setErrorAlbums('');
    const t = setTimeout(async () => {
      try {
        const data = await searchAlbums(query, 20);
        if (!cancelled) { setAlbumResults(data); }
      } catch (err) {
        if (!cancelled) {
          setErrorAlbums(err instanceof Error ? err.message : 'Search failed.');
        }
      } finally {
        if (!cancelled) { setLoadingAlbums(false); }
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, tab]);

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
    minimumViewTime: 120,
  }).current;

  const handleViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const ids = new Set<string>();
      for (const v of viewableItems) {
        if (v.isViewable && v.item) {
          ids.add((v.item as FeedPost).id);
        }
      }
      setVisibleIds(ids);
    },
  ).current;

  const goToProfile = useCallback(
    (userId: string) => {
      navigation.navigate('UserProfile', { userId });
    },
    [navigation],
  );

  const renderUserRow = useCallback(
    ({ item }: { item: ProfileSearchResult }) => (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => goToProfile(item.id)}
        style={styles.userRow}
      >
        {item.avatarUrl ? (
          <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarInitials}>
              {initialsFor(item.displayName ?? item.username)}
            </Text>
          </View>
        )}
        <View style={styles.userInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.displayName} numberOfLines={1}>
              {item.displayName ?? item.username}
            </Text>
            <AddBadge userId={item.id} size="md" />
          </View>
          <Text style={styles.username} numberOfLines={1}>
            @{item.username}
          </Text>
        </View>
        <Icon name="forward" size={22} color={COLORS.textMuted} />
      </TouchableOpacity>
    ),
    [goToProfile],
  );

  const renderTrackRow = useCallback(
    ({ item }: { item: FeedPost }) => (
      <PostCard
        post={comments.withDelta(item)}
        visible={visibleIds.has(item.id)}
        pauseWhenOffScreen
        onCommentsPress={comments.openComments}
        onDeleted={handlePostDeleted}
      />
    ),
    [visibleIds, comments, handlePostDeleted],
  );

  const renderAlbumRow = useCallback(
    ({ item, index }: { item: AlbumSearchResult; index: number }) => {
      const accents = FALLBACK_ACCENTS[index % FALLBACK_ACCENTS.length]!;
      const initial = item.title.trim().charAt(0).toUpperCase() || '♪';
      return (
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.albumRow}
          onPress={() => navigation.navigate('AlbumDetail', { albumId: item.id, albumTitle: item.title })}
        >
          <View style={[styles.albumCover, { backgroundColor: accents[0] }]}>
            <View style={[styles.albumCoverAccent, { backgroundColor: accents[1] }]} />
            {item.coverArtUrl ? (
              <Image source={{ uri: item.coverArtUrl }} style={StyleSheet.absoluteFill} />
            ) : (
              <Text style={styles.albumInitial}>{initial}</Text>
            )}
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.displayName} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.username} numberOfLines={1}>
              @{item.uploaderUsername} · {item.trackCount} {item.trackCount === 1 ? 'track' : 'tracks'}
              {item.releaseYear ? ` · ${item.releaseYear}` : ''}
            </Text>
          </View>
          <Icon name="play" size={20} color={COLORS.purpleLight} />
        </TouchableOpacity>
      );
    },
    [navigation],
  );

  const trimmedQuery = query.trim();
  const loading = tab === 'users' ? loadingUsers : tab === 'tracks' ? loadingTracks : loadingAlbums;
  const error = tab === 'users' ? errorUsers : tab === 'tracks' ? errorTracks : errorAlbums;
  const hasResults =
    tab === 'users' ? userResults.length > 0
    : tab === 'tracks' ? trackResults.length > 0
    : albumResults.length > 0;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Search</Text>
        <Text style={styles.subtitle}>Find tracks, artists, and friends</Text>
      </View>

      {/* Search input */}
      <View style={styles.inputWrap}>
        <FormInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search users and tracks"
          autoCapitalize="none"
          autoCorrect={false}
          trailing={
            query.length > 0 ? (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="clear" size={14} color={COLORS.textMuted} />
              </TouchableOpacity>
            ) : null
          }
        />
      </View>

      {/* Segmented switcher */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => setTab('users')}
          style={[styles.tabPill, tab === 'users' && styles.tabPillActive]}
        >
          {tab === 'users' ? <GradientBorder borderRadius={999} /> : null}
          <Text style={[styles.tabPillText, tab === 'users' && styles.tabPillTextActive]}>
            Users
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => setTab('tracks')}
          style={[styles.tabPill, tab === 'tracks' && styles.tabPillActive]}
        >
          {tab === 'tracks' ? <GradientBorder borderRadius={999} /> : null}
          <Text style={[styles.tabPillText, tab === 'tracks' && styles.tabPillTextActive]}>
            Tracks
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => setTab('albums')}
          style={[styles.tabPill, tab === 'albums' && styles.tabPillActive]}
        >
          {tab === 'albums' ? <GradientBorder borderRadius={999} /> : null}
          <Text style={[styles.tabPillText, tab === 'albums' && styles.tabPillTextActive]}>
            Albums
          </Text>
        </TouchableOpacity>
      </View>

      {/* Body */}
      {error ? (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={COLORS.purpleLight} />
        </View>
      ) : !hasResults ? (
        <View style={styles.centerState}>
          {trimmedQuery.length === 0 ? (
            <>
              <Text style={styles.emptyTitle}>Discover something new</Text>
              <Text style={styles.emptyText}>
                {tab === 'users' ? 'Search by username or display name to find people.'
                : tab === 'tracks' ? 'Search by track title to find music.'
                : 'Search by album title to find releases.'}
              </Text>
            </>
          ) : (
            <Text style={styles.emptyText}>
              No {tab} match "{trimmedQuery}".
            </Text>
          )}
        </View>
      ) : tab === 'users' ? (
        <FlatList
          data={userResults}
          keyExtractor={item => item.id}
          renderItem={renderUserRow}
          contentContainerStyle={[styles.listContent, { paddingBottom: 64 + insets.bottom + 56 + FLOATING_PLAYER_HEIGHT + 16 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      ) : tab === 'tracks' ? (
        <FlatList
          data={trackResults.filter(p => !deletedIds.has(p.id))}
          keyExtractor={item => item.id}
          renderItem={renderTrackRow}
          contentContainerStyle={[styles.trackListContent, { paddingBottom: 64 + insets.bottom + 56 + FLOATING_PLAYER_HEIGHT + 16 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          viewabilityConfig={viewabilityConfig}
          onViewableItemsChanged={handleViewableItemsChanged}
        />
      ) : (
        <FlatList
          data={albumResults}
          keyExtractor={item => item.id}
          renderItem={renderAlbumRow}
          contentContainerStyle={[styles.listContent, { paddingBottom: 64 + insets.bottom + 56 + FLOATING_PLAYER_HEIGHT + 16 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      )}

      <CommentsSheet
        visible={comments.commentsPostId !== null}
        postId={comments.commentsPostId}
        onClose={comments.closeComments}
        onCommentsCountChange={delta => {
          if (comments.commentsPostId) {
            comments.applyDelta(comments.commentsPostId, delta);
          }
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
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
  inputWrap: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingBottom: 14,
    gap: 8,
  },
  tabPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  tabPillActive: {
    borderColor: 'transparent',
  },
  tabPillText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  tabPillTextActive: {
    color: COLORS.purpleNeon,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptyText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  errorText: {
    color: COLORS.error,
    fontSize: 14,
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 8,
  },
  trackListContent: {
    paddingBottom: 24,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '800',
  },
  userInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  displayName: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  username: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  albumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: 10,
  },
  albumCover: {
    width: 56, height: 56, borderRadius: 10, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  albumCoverAccent: {
    position: 'absolute', width: 36, height: 36, borderRadius: 18,
    bottom: -10, right: -10, opacity: 0.6,
  },
  albumInitial: { color: COLORS.white, fontSize: 22, fontWeight: '900' },
});
