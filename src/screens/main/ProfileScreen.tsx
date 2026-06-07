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
  Linking,
  type ViewToken,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../../lib/supabase';
import { COLORS } from '../../theme/colors';
import PostCard from '../../components/PostCard';
import CommentsSheet from '../../components/CommentsSheet';
import { useCommentsCountDeltas } from '../../hooks/useCommentsCountDeltas';
import ConfirmActionModal from '../../components/ConfirmActionModal';
import { usePlayback } from '../../contexts/PlaybackContext';
import { useToast } from '../../contexts/ToastContext';
import {
  listPostsForUser,
  getProfileStats,
  type FeedPost,
  type ProfileStats,
} from '../../services/posts';
import { getFollowCounts, type FollowCounts } from '../../services/follows';
import type { RootStackParamList } from '../../navigation/types';

type ProfileRow = {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  links: string[];
};

function linkHost(url: string): string {
  try {
    const u = new URL(url);
    return u.host.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] ?? url;
  }
}

function normalizeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

const VISIBLE_LINK_CHIPS = 5;

type Tab = 'posts' | 'creator';

const PAGE_SIZE = 10;

// Sentinel item type so we can render the tab bar as the first sticky row of
// the FlatList while still keeping the hero block scrollable above it.
type ListItem =
  | { kind: 'tabs'; key: string }
  | { kind: 'empty'; key: string }
  | { kind: 'loading'; key: string }
  | { kind: 'post'; post: FeedPost; key: string };

function avatarInitials(profile: ProfileRow | null): string {
  if (!profile) {return '?';}
  const name = profile.display_name?.trim() || profile.username;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {return '?';}
  if (parts.length === 1) {return parts[0]!.slice(0, 2).toUpperCase();}
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

function formatStat(n: number): string {
  if (n < 1000) {return String(n);}
  if (n < 1_000_000) {return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;}
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

export default function ProfileScreen() {
  const playback = usePlayback();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { showToast } = useToast();
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

  const openLink = useCallback((url: string) => {
    const normalized = normalizeUrl(url);
    Linking.openURL(normalized).catch(() => {
      showToast("Couldn't open that link.", { kind: 'error' });
    });
  }, [showToast]);

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
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [allLinksOpen, setAllLinksOpen] = useState(false);
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
      `profile:@${profile?.username ?? 'me'}`,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback.activePostId, posts, playback.setQueue]);

  const handleViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const ids = new Set<string>();
      for (const v of viewableItems) {
        const item = v.item as ListItem | undefined;
        if (item?.kind === 'post' && v.isViewable) {
          ids.add(item.post.id);
        }
      }
      setVisibleIds(ids);
    },
  ).current;

  // Deliberately no pauseAll() on blur — audio should keep playing when the
  // user navigates to another screen. PostCard's `visible` prop handles inline video.

  const fetchProfileAndStats = useCallback(async (userId: string) => {
    const [profRes, statsData, follow] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, username, display_name, bio, avatar_url, links')
        .eq('id', userId)
        .maybeSingle(),
      getProfileStats(userId),
      getFollowCounts(userId),
    ]);
    if (profRes.error) {throw new Error(profRes.error.message);}
    // profRes.data is null if the profile row hasn't been created yet for some
    // reason. We don't fail the whole load — the hero just shows placeholder
    // text and the stats below still render fine.
    setProfile(profRes.data ? (profRes.data as ProfileRow) : null);
    setStats(statsData);
    setFollowCounts(follow);
  }, []);

  const fetchPosts = useCallback(
    async (userId: string, currentTab: Tab, before?: string) => {
      return listPostsForUser(userId, {
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
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData?.user) {
          throw new Error('You must be signed in to view your profile.');
        }
        const me = userData.user.id;
        await fetchProfileAndStats(me);
        const fresh = await fetchPosts(me, currentTab);
        setPosts(fresh);
        setEndReached(fresh.length < PAGE_SIZE);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load profile.';
        setError(message);
      }
    },
    [fetchPosts, fetchProfileAndStats],
  );

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await refresh(tab);
      if (!cancelled) {setLoading(false);}
    })();
    return () => {
      cancelled = true;
    };
    // We deliberately only run on mount; tab changes are handled separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh profile fields when the screen regains focus (e.g. after returning
  // from EditProfile). Posts/stats are skipped to keep the refetch cheap.
  const hasMountedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasMountedRef.current) {
        hasMountedRef.current = true;
        return;
      }
      (async () => {
        try {
          const { data: userData } = await supabase.auth.getUser();
          const me = userData?.user?.id;
          if (!me) {return;}
          await fetchProfileAndStats(me);
        } catch {
          // Silent on focus refetch; initial load already surfaces errors.
        }
      })();
    }, [fetchProfileAndStats]),
  );

  // Tab change → reload first page.
  const handleTabChange = useCallback(
    async (next: Tab) => {
      if (next === tab) {return;}
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
    if (loadingMore || endReached || posts.length === 0) {return;}
    setLoadingMore(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const me = userData?.user?.id;
      if (!me) {return;}
      const last = posts[posts.length - 1]!;
      const more = await fetchPosts(me, tab, last.createdAt);
      if (more.length === 0) {
        setEndReached(true);
      } else {
        // Deduplicate just in case the cursor returns an overlapping row.
        const seen = new Set(posts.map(p => p.id));
        const appended = more.filter(p => !seen.has(p.id));
        setPosts(prev => [...prev, ...appended]);
        if (more.length < PAGE_SIZE) {setEndReached(true);}
      }
    } finally {
      setLoadingMore(false);
    }
  }, [endReached, fetchPosts, loadingMore, posts, tab]);

  const handleSignOut = useCallback(() => {
    setSignOutOpen(true);
  }, []);

  const confirmSignOut = useCallback(async () => {
    if (signOutBusy) { return; }
    setSignOutBusy(true);
    playback.pauseAll();
    await supabase.auth.signOut();
    setSignOutBusy(false);
    setSignOutOpen(false);
  }, [playback, signOutBusy]);

  // Build the list data: a sentinel item for the sticky tab bar, then either
  // posts or an empty/loading placeholder. We can't lean on ListEmptyComponent
  // because the tab-bar sentinel always keeps the list non-empty.
  const listData = useMemo<ListItem[]>(() => {
    const head: ListItem = { kind: 'tabs', key: '__tabs__' };
    const visiblePosts = posts.filter(p => !deletedIds.has(p.id));
    if (visiblePosts.length > 0) {
      return [head, ...visiblePosts.map<ListItem>(p => ({ kind: 'post', post: p, key: p.id }))];
    }
    if (loading) {
      return [head, { kind: 'loading', key: '__loading__' }];
    }
    return [head, { kind: 'empty', key: '__empty__' }];
  }, [posts, loading, deletedIds]);

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.kind === 'tabs') {
        return (
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={styles.tabButton}
              activeOpacity={0.7}
              onPress={() => handleTabChange('posts')}
            >
              <Text style={[styles.tabLabel, tab === 'posts' && styles.tabLabelActive]}>Posts</Text>
              <View
                style={[styles.tabIndicator, tab === 'posts' && styles.tabIndicatorActive]}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.tabButton}
              activeOpacity={0.7}
              onPress={() => handleTabChange('creator')}
            >
              <Text style={[styles.tabLabel, tab === 'creator' && styles.tabLabelActive]}>
                Creator
              </Text>
              <View
                style={[styles.tabIndicator, tab === 'creator' && styles.tabIndicatorActive]}
              />
            </TouchableOpacity>
          </View>
        );
      }
      if (item.kind === 'loading') {
        return (
          <View style={styles.emptyWrap}>
            <ActivityIndicator color={COLORS.purpleLight} />
          </View>
        );
      }
      if (item.kind === 'empty') {
        return (
          <View style={styles.emptyWrap}>
            <View style={styles.emptyArt}>
              <Text style={styles.emptyArtGlyph}>♪</Text>
            </View>
            <Text style={styles.emptyTitle}>
              {tab === 'creator' ? 'No uploads yet' : 'Nothing here yet'}
            </Text>
            <Text style={styles.emptyBody}>
              {tab === 'creator'
                ? 'Upload a track and it will land here as a Creator post.'
                : 'Upload your first track or repost something you love.'}
            </Text>
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
    [handleTabChange, tab, visibleIds, comments, handlePostDeleted],
  );

  const renderHeader = useCallback(() => {
    const initials = avatarInitials(profile);
    const display = profile?.display_name ?? profile?.username ?? 'Your profile';
    const handle = profile?.username ?? '...';
    return (
      <View style={styles.headerWrap}>
        <View style={styles.topBar}>
          <Text style={styles.brand}>livil</Text>
          <TouchableOpacity
            style={styles.signOutInline}
            onPress={handleSignOut}
            activeOpacity={0.8}
            accessibilityLabel="Sign out"
          >
            <Text style={styles.signOutInlineText}>Sign out</Text>
          </TouchableOpacity>
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
          <Text style={styles.displayName} numberOfLines={1}>
            {display}
          </Text>
          <Text style={styles.handle} numberOfLines={1}>
            @{handle}
          </Text>
          {profile?.bio ? (
            <Text style={styles.bio} numberOfLines={3}>
              {profile.bio}
            </Text>
          ) : null}
          {profile?.links && profile.links.length > 0 ? (
            <View style={styles.linksRow}>
              {profile.links.slice(0, VISIBLE_LINK_CHIPS).map(url => (
                <TouchableOpacity
                  key={url}
                  style={styles.linkChip}
                  activeOpacity={0.7}
                  onPress={() => openLink(url)}
                >
                  <Text style={styles.linkChipIcon}>↗</Text>
                  <Text style={styles.linkChipText} numberOfLines={1}>
                    {linkHost(url)}
                  </Text>
                </TouchableOpacity>
              ))}
              {profile.links.length > VISIBLE_LINK_CHIPS ? (
                <TouchableOpacity
                  style={styles.linkChip}
                  activeOpacity={0.7}
                  onPress={() => setAllLinksOpen(true)}
                >
                  <Text style={styles.linkChipText}>
                    +{profile.links.length - VISIBLE_LINK_CHIPS} more
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* Primary social stats */}
        <View style={styles.socialPills}>
          <TouchableOpacity style={styles.socialPill} activeOpacity={0.85}>
            <Text style={styles.socialPillValue}>{formatStat(followCounts.fans)}</Text>
            <Text style={styles.socialPillLabel}>Fans</Text>
          </TouchableOpacity>
          <View style={styles.socialPillDivider} />
          <TouchableOpacity style={styles.socialPill} activeOpacity={0.85}>
            <Text style={styles.socialPillValue}>{formatStat(followCounts.friends)}</Text>
            <Text style={styles.socialPillLabel}>Friends</Text>
          </TouchableOpacity>
          <View style={styles.socialPillDivider} />
          <TouchableOpacity style={styles.socialPill} activeOpacity={0.85}>
            <Text style={styles.socialPillValue}>{formatStat(followCounts.stars)}</Text>
            <Text style={styles.socialPillLabel}>Stars</Text>
          </TouchableOpacity>
        </View>

        {/* Secondary stats */}
        <View style={styles.contentStats}>
          <Text style={styles.contentStatsText}>
            <Text style={styles.contentStatsValue}>{formatStat(stats.posts)}</Text> post
            {stats.posts === 1 ? '' : 's'}
            <Text style={styles.contentStatsDivider}>  ·  </Text>
            <Text style={styles.contentStatsValue}>{formatStat(stats.uploads)}</Text> upload
            {stats.uploads === 1 ? '' : 's'}
          </Text>
        </View>

        {/* Action buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionButton, styles.actionButtonPrimary]}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('EditProfile')}
          >
            <Text style={styles.actionButtonPrimaryText}>Edit profile</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.actionButtonGhost]}
            activeOpacity={0.85}
          >
            <Text style={styles.actionButtonGhostText}>Share</Text>
          </TouchableOpacity>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </View>
    );
  }, [profile, stats, followCounts, error, handleSignOut, navigation]);

  const renderFooter = useCallback(() => {
    if (!loadingMore) {return <View style={styles.listFooter} />;}
    return (
      <View style={styles.footerLoading}>
        <ActivityIndicator color={COLORS.purpleLight} />
      </View>
    );
  }, [loadingMore]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
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
        contentContainerStyle={[styles.listContent, { paddingBottom: 64 + insets.bottom + 48 }]}
      />

      <ConfirmActionModal
        visible={signOutOpen}
        title="Sign out of Livil?"
        message="You'll need your password to sign back in."
        bullets={[
          'Playback stops on this device',
          'Push notifications pause until you sign in again',
          'Your music and friends stay safe',
        ]}
        glyph="↪"
        tone="destructive"
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        busy={signOutBusy}
        onConfirm={confirmSignOut}
        onCancel={() => setSignOutOpen(false)}
      />

      <ConfirmActionModal
        visible={allLinksOpen}
        title="All links"
        message={`${profile?.links.length ?? 0} link${(profile?.links.length ?? 0) === 1 ? '' : 's'} on this profile`}
        bullets={profile?.links.map(linkHost) ?? []}
        glyph="↗"
        tone="primary"
        confirmLabel="Close"
        cancelLabel="Dismiss"
        onConfirm={() => setAllLinksOpen(false)}
        onCancel={() => setAllLinksOpen(false)}
      />

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
  listContent: {
    paddingBottom: 40,
  },
  headerWrap: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  brand: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  signOutInline: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  signOutInlineText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  hero: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 20,
  },
  avatarRing: {
    width: 116,
    height: 116,
    borderRadius: 58,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  avatarRingGlow: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: COLORS.purpleGlow,
    opacity: 0.6,
  },
  avatarInner: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: COLORS.bg,
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.55,
    shadowRadius: 18,
    elevation: 10,
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    color: COLORS.white,
    fontSize: 38,
    fontWeight: '900',
    letterSpacing: -1.2,
  },
  displayName: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  handle: {
    color: COLORS.purpleLight,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  bio: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 24,
  },
  linksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 16,
  },
  linkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 180,
  },
  linkChipIcon: {
    color: COLORS.purpleLight,
    fontSize: 12,
    marginRight: 5,
  },
  linkChipText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  socialPills: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 8,
    marginBottom: 12,
  },
  socialPill: {
    flex: 1,
    alignItems: 'center',
  },
  socialPillValue: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  socialPillLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 2,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  socialPillDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    backgroundColor: COLORS.border,
  },
  contentStats: {
    alignItems: 'center',
    marginBottom: 14,
  },
  contentStatsText: {
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  contentStatsValue: {
    color: COLORS.white,
    fontWeight: '800',
  },
  contentStatsDivider: {
    color: COLORS.textMuted,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonPrimary: {
    backgroundColor: COLORS.purple,
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  actionButtonPrimaryText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  actionButtonGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionButtonGhostText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '700',
  },
  errorBox: {
    marginTop: 14,
    padding: 12,
    backgroundColor: COLORS.errorBg,
    borderWidth: 1,
    borderColor: COLORS.errorBorder,
    borderRadius: 12,
  },
  errorText: {
    color: COLORS.error,
    fontSize: 13,
    lineHeight: 18,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.bg,
    paddingTop: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
  },
  tabLabel: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  tabLabelActive: {
    color: COLORS.white,
  },
  tabIndicator: {
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'transparent',
    marginTop: 8,
  },
  tabIndicatorActive: {
    backgroundColor: COLORS.purple,
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 4,
  },
  emptyWrap: {
    paddingHorizontal: 32,
    paddingTop: 50,
    paddingBottom: 40,
    alignItems: 'center',
  },
  emptyArt: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1,
    borderColor: COLORS.purple,
    marginBottom: 16,
  },
  emptyArtGlyph: {
    color: COLORS.purpleLight,
    fontSize: 40,
  },
  emptyTitle: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
  },
  emptyBody: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  footerLoading: {
    paddingVertical: 22,
    alignItems: 'center',
  },
  listFooter: {
    height: 12,
  },
});
