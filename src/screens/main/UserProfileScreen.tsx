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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../../lib/supabase';
import { COLORS } from '../../theme/colors';
import { Icon } from '../../components/Icon';
import { FLOATING_PLAYER_HEIGHT } from '../../components/FloatingPlayer';
import PostCard from '../../components/PostCard';
import PostCardSkeleton from '../../components/PostCardSkeleton';
import FeedEndMessage from '../../components/FeedEndMessage';
import CommentsSheet from '../../components/CommentsSheet';
import { useCommentsCountDeltas } from '../../hooks/useCommentsCountDeltas';
import { usePlayback } from '../../contexts/PlaybackContext';
import {
  listPostsForUser,
  getProfileStats,
  type FeedPost,
  type ProfileStats,
} from '../../services/posts';
import { getFollowCounts, type FollowCounts } from '../../services/follows';
import { fetchPlaylistsForUser, type UserPlaylist } from '../../services/playlists';
import { fetchAlbumsByUser, type AlbumSummary } from '../../services/albums';
import ProfileTabBar, { type ProfileTab, type TabCounts } from '../../components/ProfileTabBar';
import ProfileGridCard from '../../components/ProfileGridCard';
import { useRelationships } from '../../contexts/RelationshipContext';
import { useToast } from '../../contexts/ToastContext';
import AddUserSheet from '../../components/AddUserSheet';
import { getOrCreateDm } from '../../services/conversations';
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

const PAGE_SIZE = 10;

type ListItem =
  | { kind: 'tabs'; key: string }
  | { kind: 'empty'; key: string }
  | { kind: 'loading'; key: string }
  | { kind: 'post'; post: FeedPost; key: string }
  | { kind: 'album-row'; a: AlbumSummary; b: AlbumSummary | null; key: string }
  | { kind: 'playlist-row'; a: UserPlaylist; b: UserPlaylist | null; key: string };

function pairs<T>(arr: T[]): Array<[T, T | null]> {
  const out: Array<[T, T | null]> = [];
  for (let i = 0; i < arr.length; i += 2) {
    out.push([arr[i]!, arr[i + 1] ?? null]);
  }
  return out;
}

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
  const insets = useSafeAreaInsets();
  const { userId, focusPostId, openComments, highlightCommentId } = route.params;
  const playback = usePlayback();
  const rel = useRelationships();
  const { showToast } = useToast();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [messagingBusy, setMessagingBusy] = useState(false);
  const comments = useCommentsCountDeltas();
  const listRef = useRef<FlatList<ListItem>>(null);
  // Tracks whether the activity-center deep-link side effects (scroll-to-post,
  // auto-open comments) have already fired this mount — they're one-shot.
  const focusHandledRef = useRef(false);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const handlePostDeleted = useCallback((postId: string) => {
    setDeletedIds(prev => {
      if (prev.has(postId)) { return prev; }
      const next = new Set(prev);
      next.add(postId);
      return next;
    });
  }, []);

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [stats, setStats] = useState<ProfileStats>({ posts: 0, uploads: 0 });
  const [followCounts, setFollowCounts] = useState<FollowCounts>({ fans: 0, friends: 0, stars: 0 });

  const [tab, setTab] = useState<ProfileTab>('reposts');
  const [tabCounts, setTabCounts] = useState<TabCounts>({ reposts: 0, uploads: 0, albums: 0, playlists: 0 });
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
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
          thumbnailUrl: p.track.thumbnailUrl,
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
          knownDurationSec: p.track.durationSeconds ?? 0,
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
    async (uid: string, currentTab: ProfileTab, before?: string) => {
      const kind: 'upload' | 'repost' | undefined = currentTab === 'reposts' ? 'repost'
        : currentTab === 'uploads' ? 'upload'
        : undefined;
      return listPostsForUser(uid, {
        kind,
        limit: PAGE_SIZE,
        before,
      });
    },
    [],
  );

  const fetchTabCounts = useCallback(async (uid: string): Promise<TabCounts> => {
    const [reposts, uploads, albumsRes, playlistsRes] = await Promise.all([
      supabase.from('posts').select('id', { count: 'exact', head: true }).eq('author_id', uid).eq('kind', 'repost'),
      supabase.from('posts').select('id', { count: 'exact', head: true }).eq('author_id', uid).eq('kind', 'upload'),
      supabase.from('albums').select('id', { count: 'exact', head: true }).eq('uploader_id', uid),
      supabase.from('playlists').select('id', { count: 'exact', head: true }).eq('user_id', uid),
    ]);
    return {
      reposts: reposts.count ?? 0,
      uploads: uploads.count ?? 0,
      albums: albumsRes.count ?? 0,
      playlists: playlistsRes.count ?? 0,
    };
  }, []);

  const refresh = useCallback(
    async (currentTab: ProfileTab) => {
      setError('');
      try {
        await fetchProfileAndStats(userId);
        const counts = await fetchTabCounts(userId);
        setTabCounts(counts);

        if (currentTab === 'reposts' || currentTab === 'uploads') {
          const fresh = await fetchPosts(userId, currentTab);
          setPosts(fresh);
          setEndReached(fresh.length < PAGE_SIZE);
        } else if (currentTab === 'albums') {
          setAlbums(await fetchAlbumsByUser(userId));
          setEndReached(true);
        } else {
          setPlaylists(await fetchPlaylistsForUser(userId));
          setEndReached(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load profile.');
      }
    },
    [userId, fetchPosts, fetchProfileAndStats, fetchTabCounts],
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

  // One-shot deep-link side effects when arriving from an activity-center tap.
  // Runs once after posts load: scroll the focused post into view, then (for a
  // comment notification) auto-open the CommentsSheet so the highlight fires.
  useEffect(() => {
    if (focusHandledRef.current) { return; }
    if (loading || !focusPostId) { return; }
    const idx = posts.findIndex(p => p.id === focusPostId);
    if (idx < 0) { return; }  // not in the first page — bail; user can scroll manually
    focusHandledRef.current = true;
    // +1 to skip the sticky tab-bar row at listData[0].
    const listIndex = idx + 1;
    setTimeout(() => {
      listRef.current?.scrollToIndex({ index: listIndex, animated: true, viewPosition: 0.1 });
    }, 150);
    if (openComments) {
      setTimeout(() => comments.openComments(focusPostId), 450);
    }
  }, [loading, posts, focusPostId, openComments, comments]);

  const handleTabChange = useCallback(
    async (next: ProfileTab) => {
      if (next === tab) { return; }
      playback.pauseAll();
      setTab(next);
      setPosts([]);
      setAlbums([]);
      setPlaylists([]);
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
    if (tab !== 'reposts' && tab !== 'uploads') { return; }
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

  const handleMessage = useCallback(async () => {
    if (messagingBusy) { return; }
    setMessagingBusy(true);
    try {
      const convId = await getOrCreateDm(userId);
      const title = profile?.display_name ?? profile?.username ?? 'Chat';
      navigation.navigate('Conversation', { conversationId: convId, title, kind: 'dm' });
    } catch {
      showToast('Could not open conversation.', { kind: 'error' });
    } finally {
      setMessagingBusy(false);
    }
  }, [messagingBusy, userId, profile, navigation, showToast]);

  const listData = useMemo<ListItem[]>(() => {
    const head: ListItem = { kind: 'tabs', key: '__tabs__' };
    if (loading) { return [head, { kind: 'loading', key: '__loading__' }]; }
    if (tab === 'reposts' || tab === 'uploads') {
      const visiblePosts = posts.filter(p => !deletedIds.has(p.id));
      if (visiblePosts.length > 0) {
        return [head, ...visiblePosts.map<ListItem>(p => ({ kind: 'post', post: p, key: p.id }))];
      }
      return [head, { kind: 'empty', key: '__empty__' }];
    }
    if (tab === 'albums') {
      if (albums.length === 0) { return [head, { kind: 'empty', key: '__empty__' }]; }
      return [head, ...pairs(albums).map<ListItem>(([a, b], i) => ({
        kind: 'album-row', a, b, key: `album-row-${i}`,
      }))];
    }
    if (playlists.length === 0) { return [head, { kind: 'empty', key: '__empty__' }]; }
    return [head, ...pairs(playlists).map<ListItem>(([a, b], i) => ({
      kind: 'playlist-row', a, b, key: `playlist-row-${i}`,
    }))];
  }, [tab, posts, albums, playlists, loading, deletedIds]);

  const goToAlbum = useCallback((a: AlbumSummary) => {
    navigation.navigate('AlbumDetail', { albumId: a.id, albumTitle: a.title });
  }, [navigation]);

  const goToPlaylist = useCallback((p: UserPlaylist) => {
    navigation.navigate('PlaylistDetail', { playlistId: p.id, playlistName: p.name });
  }, [navigation]);

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.kind === 'tabs') {
        return <ProfileTabBar active={tab} counts={tabCounts} onChange={handleTabChange} />;
      }
      if (item.kind === 'loading') {
        return <View style={styles.emptyWrap}><ActivityIndicator color={COLORS.purpleLight} /></View>;
      }
      if (item.kind === 'empty') {
        const tabEmpty = {
          reposts: 'No reposts yet',
          uploads: 'No uploads yet',
          albums: 'No albums yet',
          playlists: 'No playlists yet',
        }[tab];
        return (
          <View style={styles.emptyWrap}>
            <View style={styles.emptyArt}><Icon name="musicNote" size={28} color={COLORS.purpleLight} /></View>
            <Text style={styles.emptyTitle}>{tabEmpty}</Text>
          </View>
        );
      }
      if (item.kind === 'album-row') {
        return (
          <View style={styles.gridRow}>
            <ProfileGridCard
              title={item.a.title}
              subtitle={`${item.a.trackCount} ${item.a.trackCount === 1 ? 'track' : 'tracks'}${item.a.releaseYear ? ` · ${item.a.releaseYear}` : ''}`}
              coverArtUrl={item.a.coverArtUrl}
              index={0}
              onPress={() => goToAlbum(item.a)}
            />
            {item.b ? (
              <ProfileGridCard
                title={item.b.title}
                subtitle={`${item.b.trackCount} ${item.b.trackCount === 1 ? 'track' : 'tracks'}${item.b.releaseYear ? ` · ${item.b.releaseYear}` : ''}`}
                coverArtUrl={item.b.coverArtUrl}
                index={1}
                onPress={() => goToAlbum(item.b!)}
              />
            ) : <View style={{ flex: 1 }} />}
          </View>
        );
      }
      if (item.kind === 'playlist-row') {
        // No visibility chip when viewing somebody else's profile — if they
        // can see the card, they're allowed to (RLS already enforced it).
        return (
          <View style={styles.gridRow}>
            <ProfileGridCard
              title={item.a.name}
              subtitle={`${item.a.postCount} ${item.a.postCount === 1 ? 'post' : 'posts'}`}
              coverArtUrl={item.a.coverArtUrl}
              coverEmoji={item.a.coverEmoji}
              coverColor={item.a.coverColor}
              coverColor2={item.a.coverColor2}
              index={0}
              onPress={() => goToPlaylist(item.a)}
            />
            {item.b ? (
              <ProfileGridCard
                title={item.b.name}
                subtitle={`${item.b.postCount} ${item.b.postCount === 1 ? 'post' : 'posts'}`}
                coverArtUrl={item.b.coverArtUrl}
                coverEmoji={item.b.coverEmoji}
                coverColor={item.b.coverColor}
                coverColor2={item.b.coverColor2}
                index={1}
                onPress={() => goToPlaylist(item.b!)}
              />
            ) : <View style={{ flex: 1 }} />}
          </View>
        );
      }
      return (
        <PostCard
          post={comments.withDelta(item.post)}
          visible={visibleIds.has(item.post.id)}
          onCommentsPress={comments.openComments}
          onDeleted={handlePostDeleted}
        />
      );
    },
    [tab, tabCounts, handleTabChange, visibleIds, comments, handlePostDeleted, goToAlbum, goToPlaylist],
  );

  const renderHeader = useCallback(() => {
    const initials = avatarInitials(profile);
    const display = profile?.display_name ?? profile?.username ?? '';
    const handle = profile?.username ?? '';
    const isProfileLoading = loading && !profile;
    const relStatus = rel.status(userId);
    return (
      <View style={styles.headerWrap}>
        {/* Top bar with back button */}
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="backArrow" size={22} color={COLORS.white} />
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
              ) : profile ? (
                <Text style={styles.avatarText}>{initials}</Text>
              ) : null}
            </View>
          </View>
          {isProfileLoading ? (
            <>
              <View style={styles.skeletonLine} />
              <View style={styles.skeletonLineSm} />
            </>
          ) : (
            <>
              <Text style={styles.displayName} numberOfLines={1}>{display}</Text>
              <Text style={styles.handle} numberOfLines={1}>@{handle}</Text>
            </>
          )}
          {profile?.bio ? (
            <Text style={styles.bio} numberOfLines={3}>{profile.bio}</Text>
          ) : null}
          {relStatus !== 'me' && (
            <View style={styles.heroActions}>
              {renderCta(relStatus, () => setSheetOpen(true))}
              <TouchableOpacity
                style={styles.msgBtn}
                activeOpacity={0.8}
                onPress={handleMessage}
                disabled={messagingBusy}
              >
                {messagingBusy ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <Text style={styles.msgBtnText}>Message</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
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
  }, [profile, stats, followCounts, error, loading, navigation, rel, userId, handleMessage, messagingBusy]);

  const renderFooter = useCallback(() => {
    if (loadingMore) {
      return (
        <>
          <PostCardSkeleton />
          <PostCardSkeleton />
        </>
      );
    }
    if (endReached && posts.length > 0) {
      return (
        <FeedEndMessage
          title="That's their whole set"
          subtitle="Every track they've dropped lives right here."
        />
      );
    }
    return <View style={styles.listFooter} />;
  }, [loadingMore, endReached, posts.length]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        ref={listRef}
        data={listData}
        keyExtractor={item => item.key}
        renderItem={renderItem}
        ListHeaderComponent={renderHeader}
        ListFooterComponent={renderFooter}
        stickyHeaderIndices={[1]}
        onScrollToIndexFailed={() => { /* item not laid out yet — silently skip */ }}
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
        contentContainerStyle={[styles.listContent, { paddingBottom: 64 + insets.bottom + 56 + FLOATING_PLAYER_HEIGHT + 16 }]}
      />
      {sheetOpen && (
        <AddUserSheet
          userId={userId}
          visible={sheetOpen}
          onClose={() => setSheetOpen(false)}
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
        highlightCommentId={
          // Only honour the highlight when the open request is for the post that
          // triggered the activity tap — otherwise an unrelated open would still
          // try to pulse a stale comment id.
          comments.commentsPostId && comments.commentsPostId === focusPostId
            ? highlightCommentId ?? null
            : null
        }
      />
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
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
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
    marginBottom: 12,
  },
  tabButton: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabLabel: { color: COLORS.textMuted, fontSize: 14, fontWeight: '600' },
  tabLabelActive: { color: COLORS.white },
  tabIndicator: { height: 2, width: 24, borderRadius: 1, marginTop: 6, backgroundColor: 'transparent' },
  tabIndicatorActive: { backgroundColor: COLORS.purple },

  gridRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingBottom: 16 },
  emptyWrap: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyArt: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: COLORS.purpleDim, alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { color: COLORS.white, fontSize: 16, fontWeight: '700', textAlign: 'center' },

  listFooter: { height: 40 },

  heroActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    alignSelf: 'stretch',
    paddingHorizontal: 16,
  },
  msgBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  msgBtnText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '700',
  },
  skeletonLine: {
    height: 20,
    width: 130,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
    marginTop: 10,
    opacity: 0.7,
  },
  skeletonLineSm: {
    height: 13,
    width: 85,
    borderRadius: 6,
    backgroundColor: COLORS.surface,
    marginTop: 6,
    opacity: 0.7,
  },
});
