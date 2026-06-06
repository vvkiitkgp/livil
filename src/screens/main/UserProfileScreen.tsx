import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Image,
  type ViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../../lib/supabase';
import { COLORS } from '../../theme/colors';
import PostCard from '../../components/PostCard';
import { usePlayback } from '../../contexts/PlaybackContext';
import {
  listPostsForUser,
  getProfileStats,
  type FeedPost,
  type ProfileStats,
} from '../../services/posts';
import { getFollowCounts, type FollowCounts } from '../../services/follows';
import { useRelationships } from '../../contexts/RelationshipContext';
import AddUserSheet from '../../components/AddUserSheet';
import type { RootStackParamList } from '../../navigation/types';

type UserProfileRouteProp = RouteProp<RootStackParamList, 'UserProfile'>;
type NavProp = NativeStackNavigationProp<RootStackParamList>;

type ProfileRow = {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
};

type Tab = 'posts' | 'creator';

const PAGE_SIZE = 10;

type ListItem =
  | { kind: 'tabs'; key: string }
  | { kind: 'empty'; key: string }
  | { kind: 'loading'; key: string }
  | { kind: 'post'; post: FeedPost; key: string };

function avatarInitials(profile: ProfileRow | null): string {
  if (!profile) { return '?'; }
  const name = profile.display_name?.trim() || profile.username;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) { return '?'; }
  if (parts.length === 1) { return parts[0]!.slice(0, 2).toUpperCase(); }
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

function formatStat(n: number): string {
  if (n < 1000) { return String(n); }
  if (n < 1_000_000) { return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`; }
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

function renderCta(
  status: ReturnType<ReturnType<typeof useRelationships>['status']>,
  onPress: () => void,
) {
  if (status === 'me') { return null; }
  const map: Record<string, { label: string; primary: boolean }> = {
    none: { label: 'Add', primary: true },
    pending_outgoing: { label: 'Requested', primary: false },
    pending_incoming: { label: 'Accept Friend Request', primary: true },
    friend: { label: 'Friends ✓', primary: false },
    star: { label: 'Starred ✓', primary: false },
  };
  const conf = map[status] ?? map.none;
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      style={[styles.ctaBtn, conf.primary ? styles.ctaBtnPrimary : styles.ctaBtnSecondary]}
    >
      <Text style={conf.primary ? styles.ctaBtnPrimaryText : styles.ctaBtnSecondaryText}>
        {conf.label}
      </Text>
    </TouchableOpacity>
  );
}

export default function UserProfileScreen() {
  const route = useRoute<UserProfileRouteProp>();
  const navigation = useNavigation<NavProp>();
  const { userId } = route.params;
  const playback = usePlayback();
  const rel = useRelationships();
  const [sheetOpen, setSheetOpen] = useState(false);

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [stats, setStats] = useState<ProfileStats>({ posts: 0, uploads: 0 });
  const [followCounts, setFollowCounts] = useState<FollowCounts>({ fans: 0, friends: 0, stars: 0 });

  const [tab, setTab] = useState<Tab>('posts');
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [endReached, setEndReached] = useState(false);
  const [error, setError] = useState('');

  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  useEffect(() => {
    if (!playback.activePostId) { return; }
    if (playback.playSourceRef.current !== 'user') { return; }
    const startIdx = posts.findIndex(p => p.id === playback.activePostId);
    if (startIdx < 0) { return; }
    playback.setQueue(
      posts.map(p => {
        const displayAuthor = (p.kind === 'repost' && p.originalAuthor) ? p.originalAuthor : p.author;
        return {
          postId: p.id,
          trackId: p.track.id,
          title: p.track.title,
          artistName: displayAuthor.displayName ?? displayAuthor.username,
          authorId: displayAuthor.id,
          authorUsername: displayAuthor.username,
          authorAvatarUrl: displayAuthor.avatarUrl,
          coverArtUrl: p.track.coverArtUrl,
          mediaKind: p.track.mediaKind,
          audioUrl: p.track.audioUrl ?? undefined,
          videoUrl: p.track.videoUrl ?? undefined,
          likesCount: p.likesCount,
          commentsCount: p.commentsCount,
          repostsCount: p.repostsCount,
          viewsCount: p.viewsCount,
          viewerHasLiked: p.viewerHasLiked,
          clipStartSec: p.clipStartSec,
          clipEndSec: p.clipEndSec,
          kind: p.kind,
          originalPostId: p.originalPostId,
          knownDurationSec: 0,
        };
      }),
      startIdx,
      `profile:@${profile?.username ?? ''}`,
    );
  }, [playback.activePostId, posts, playback.setQueue]);

  const handleViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const ids = new Set<string>();
      for (const v of viewableItems) {
        const item = v.item as ListItem | undefined;
        if (item?.kind === 'post' && v.isViewable) { ids.add(item.post.id); }
      }
      setVisibleIds(ids);
    },
  ).current;

  const fetchProfileAndStats = useCallback(async (uid: string) => {
    const [profRes, statsData, follow] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, username, display_name, bio, avatar_url')
        .eq('id', uid)
        .maybeSingle(),
      getProfileStats(uid),
      getFollowCounts(uid),
    ]);
    if (profRes.error) { throw new Error(profRes.error.message); }
    setProfile(profRes.data ? (profRes.data as ProfileRow) : null);
    setStats(statsData);
    setFollowCounts(follow);
  }, []);

  const fetchPosts = useCallback(
    async (uid: string, currentTab: Tab, before?: string) => {
      return listPostsForUser(uid, {
        kind: currentTab === 'creator' ? 'upload' : undefined,
        limit: PAGE_SIZE,
        before,
      });
    },
    [],
  );

  const refresh = useCallback(
    async (currentTab: Tab) => {
      setError('');
      try {
        await fetchProfileAndStats(userId);
        const fresh = await fetchPosts(userId, currentTab);
        setPosts(fresh);
        setEndReached(fresh.length < PAGE_SIZE);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load profile.');
      }
    },
    [userId, fetchPosts, fetchProfileAndStats],
  );

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await refresh(tab);
      if (!cancelled) { setLoading(false); }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTabChange = useCallback(
    async (next: Tab) => {
      if (next === tab) { return; }
      playback.pauseAll();
      setTab(next);
      setPosts([]);
      setEndReached(false);
      setLoading(true);
      await refresh(next);
      setLoading(false);
    },
    [tab, refresh, playback],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    playback.pauseAll();
    await refresh(tab);
    setRefreshing(false);
  }, [refresh, tab, playback]);

  const handleEndReached = useCallback(async () => {
    if (loadingMore || endReached || posts.length === 0) { return; }
    setLoadingMore(true);
    try {
      const last = posts[posts.length - 1]!;
      const more = await fetchPosts(userId, tab, last.createdAt);
      if (more.length === 0) {
        setEndReached(true);
      } else {
        const seen = new Set(posts.map(p => p.id));
        const appended = more.filter(p => !seen.has(p.id));
        setPosts(prev => [...prev, ...appended]);
        if (more.length < PAGE_SIZE) { setEndReached(true); }
      }
    } finally {
      setLoadingMore(false);
    }
  }, [endReached, fetchPosts, loadingMore, posts, tab, userId]);

  const listData = useMemo<ListItem[]>(() => {
    const head: ListItem = { kind: 'tabs', key: '__tabs__' };
    if (posts.length > 0) {
      return [head, ...posts.map<ListItem>(p => ({ kind: 'post', post: p, key: p.id }))];
    }
    if (loading) { return [head, { kind: 'loading', key: '__loading__' }]; }
    return [head, { kind: 'empty', key: '__empty__' }];
  }, [posts, loading]);

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.kind === 'tabs') {
        return (
          <View style={styles.tabBar}>
            {(['posts', 'creator'] as Tab[]).map(t => (
              <TouchableOpacity
                key={t}
                style={styles.tabButton}
                activeOpacity={0.7}
                onPress={() => handleTabChange(t)}
              >
                <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </Text>
                <View style={[styles.tabIndicator, tab === t && styles.tabIndicatorActive]} />
              </TouchableOpacity>
            ))}
          </View>
        );
      }
      if (item.kind === 'loading') {
        return <View style={styles.emptyWrap}><ActivityIndicator color={COLORS.purpleLight} /></View>;
      }
      if (item.kind === 'empty') {
        return (
          <View style={styles.emptyWrap}>
            <View style={styles.emptyArt}><Text style={styles.emptyArtGlyph}>♪</Text></View>
            <Text style={styles.emptyTitle}>
              {tab === 'creator' ? 'No uploads yet' : 'Nothing here yet'}
            </Text>
          </View>
        );
      }
      return <PostCard post={item.post} visible={visibleIds.has(item.post.id)} />;
    },
    [handleTabChange, tab, visibleIds],
  );

  const renderHeader = useCallback(() => {
    const initials = avatarInitials(profile);
    const display = profile?.display_name ?? profile?.username ?? '...';
    const handle = profile?.username ?? '...';
    return (
      <View style={styles.headerWrap}>
        {/* Top bar with back button */}
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.backBtnText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.screenTitle} numberOfLines={1}>{handle}</Text>
          <View style={styles.backBtnSpacer} />
        </View>

        <View style={styles.hero}>
          <View style={styles.avatarRing}>
            <View style={styles.avatarRingGlow} />
            <View style={styles.avatarInner}>
              {profile?.avatar_url ? (
                <Image source={{ uri: profile.avatar_url }} style={styles.avatarImg} />
              ) : (
                <Text style={styles.avatarText}>{initials}</Text>
              )}
            </View>
          </View>
          <Text style={styles.displayName} numberOfLines={1}>{display}</Text>
          <Text style={styles.handle} numberOfLines={1}>@{handle}</Text>
          {profile?.bio ? (
            <Text style={styles.bio} numberOfLines={3}>{profile.bio}</Text>
          ) : null}
          {renderCta(rel.status(userId), () => setSheetOpen(true))}
        </View>

        <View style={styles.socialPills}>
          <View style={styles.socialPill}>
            <Text style={styles.socialPillValue}>{formatStat(followCounts.fans)}</Text>
            <Text style={styles.socialPillLabel}>Fans</Text>
          </View>
          <View style={styles.socialPillDivider} />
          <View style={styles.socialPill}>
            <Text style={styles.socialPillValue}>{formatStat(followCounts.friends)}</Text>
            <Text style={styles.socialPillLabel}>Friends</Text>
          </View>
          <View style={styles.socialPillDivider} />
          <View style={styles.socialPill}>
            <Text style={styles.socialPillValue}>{formatStat(followCounts.stars)}</Text>
            <Text style={styles.socialPillLabel}>Stars</Text>
          </View>
        </View>

        <View style={styles.contentStats}>
          <Text style={styles.contentStatsText}>
            <Text style={styles.contentStatsValue}>{formatStat(stats.posts)}</Text>
            {' '}post{stats.posts === 1 ? '' : 's'}
            <Text style={styles.contentStatsDivider}>  ·  </Text>
            <Text style={styles.contentStatsValue}>{formatStat(stats.uploads)}</Text>
            {' '}upload{stats.uploads === 1 ? '' : 's'}
          </Text>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </View>
    );
  }, [profile, stats, followCounts, error, navigation, rel, userId]);

  const renderFooter = useCallback(() => {
    if (!loadingMore) { return <View style={styles.listFooter} />; }
    return <View style={styles.footerLoading}><ActivityIndicator color={COLORS.purpleLight} /></View>;
  }, [loadingMore]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={listData}
        keyExtractor={item => item.key}
        renderItem={renderItem}
        ListHeaderComponent={renderHeader}
        ListFooterComponent={renderFooter}
        stickyHeaderIndices={[1]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.purpleLight}
            colors={[COLORS.purple]}
          />
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.4}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={handleViewableItemsChanged}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
      />
      {sheetOpen && (
        <AddUserSheet
          userId={userId}
          visible={sheetOpen}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </SafeAreaView>
  );
}

const AVATAR_D = 80;
const RING_D = AVATAR_D + 8;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  listContent: { paddingBottom: 40 },

  headerWrap: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },

  topBar: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 12,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backBtnText: { color: COLORS.white, fontSize: 22, fontWeight: '400' },
  backBtnSpacer: { width: 40 },
  screenTitle: {
    flex: 1, color: COLORS.white, fontSize: 16, fontWeight: '700',
    textAlign: 'center', letterSpacing: -0.2,
  },

  hero: { alignItems: 'center', paddingTop: 8, paddingBottom: 16 },
  avatarRing: {
    width: RING_D, height: RING_D, borderRadius: RING_D / 2,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  avatarRingGlow: {
    position: 'absolute', width: RING_D, height: RING_D, borderRadius: RING_D / 2,
    borderWidth: 2, borderColor: COLORS.purple,
    shadowColor: COLORS.purple, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7, shadowRadius: 10, elevation: 8,
  },
  avatarInner: {
    width: AVATAR_D, height: AVATAR_D, borderRadius: AVATAR_D / 2,
    backgroundColor: COLORS.purpleDim, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { color: COLORS.purpleLight, fontSize: 26, fontWeight: '800' },
  displayName: { color: COLORS.white, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  handle: { color: COLORS.textMuted, fontSize: 14, marginTop: 2 },
  bio: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 8, textAlign: 'center' },

  ctaBtn: {
    marginTop: 14,
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 160,
  },
  ctaBtnPrimary: {
    backgroundColor: COLORS.purple,
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaBtnPrimaryText: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  ctaBtnSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  ctaBtnSecondaryText: { color: COLORS.white, fontSize: 14, fontWeight: '600' },

  socialPills: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.surface, borderRadius: 16,
    borderWidth: 1, borderColor: COLORS.border,
    marginHorizontal: 4, marginBottom: 12, paddingVertical: 12,
  },
  socialPill: { flex: 1, alignItems: 'center' },
  socialPillValue: { color: COLORS.white, fontSize: 18, fontWeight: '800' },
  socialPillLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '600', marginTop: 2 },
  socialPillDivider: { width: 1, height: 32, backgroundColor: COLORS.border },

  contentStats: { alignItems: 'center', marginBottom: 8 },
  contentStatsText: { color: COLORS.textSecondary, fontSize: 13 },
  contentStatsValue: { color: COLORS.white, fontWeight: '700' },
  contentStatsDivider: { color: COLORS.border },

  errorBox: {
    backgroundColor: '#2D0A0A', borderRadius: 10,
    padding: 12, marginVertical: 8,
  },
  errorText: { color: '#FF6B6B', fontSize: 13 },

  tabBar: {
    flexDirection: 'row', backgroundColor: COLORS.bg,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
  },
  tabButton: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabLabel: { color: COLORS.textMuted, fontSize: 14, fontWeight: '600' },
  tabLabelActive: { color: COLORS.white },
  tabIndicator: { height: 2, width: 24, borderRadius: 1, marginTop: 6, backgroundColor: 'transparent' },
  tabIndicatorActive: { backgroundColor: COLORS.purple },

  emptyWrap: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyArt: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: COLORS.purpleDim, alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  emptyArtGlyph: { color: COLORS.purpleLight, fontSize: 28 },
  emptyTitle: { color: COLORS.white, fontSize: 16, fontWeight: '700', textAlign: 'center' },

  listFooter: { height: 40 },
  footerLoading: { padding: 20, alignItems: 'center' },
});
