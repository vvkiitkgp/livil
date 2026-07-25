import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Platform,
  Animated,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  RefreshControl,
  Image,
  ScrollView,
  type ViewToken,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CompositeNavigationProp } from '@react-navigation/native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../../lib/supabase';
import { COLORS } from '../../theme/colors';
import type { AppTabParamList, RootStackParamList } from '../../navigation/types';
import PostCard from '../../components/PostCard';
import PostCardSkeleton from '../../components/PostCardSkeleton';
import FeedEndMessage from '../../components/FeedEndMessage';
import CommentsSheet from '../../components/CommentsSheet';
import { Icon } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { Button } from '../../components/Button';
import { GradientBorder } from '../../components/GradientBorder';
import { FLOATING_PLAYER_HEIGHT } from '../../components/FloatingPlayer';
import { useCommentsCountDeltas } from '../../hooks/useCommentsCountDeltas';
import { usePlayback } from '../../contexts/PlaybackContext';
import { useRelationships } from '../../contexts/RelationshipContext';
import { useChromeVisibility } from '../../contexts/ChromeVisibilityContext';
import {
  fetchHomeFeedPage,
  type FeedPost,
  type HomeFeedCursor,
} from '../../services/posts';
import { listActiveStories, type Story } from '../../services/stories';
import { useStories } from '../../contexts/StoriesContext';
import { groupStoriesByAuthor } from '../../utils/groupStoriesByAuthor';
import { listConversations } from '../../services/conversations';
import { getActivityUnreadCount } from '../../services/activity';

type HomeNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<AppTabParamList, 'Home'>,
  NativeStackNavigationProp<RootStackParamList>
>;

type ProfileSnippet = {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

/** FlatList rows — keeps `onViewableItemsMounted` wiring stable across loading ↔ loaded. */
type FeedListItem =
  | { kind: 'post'; post: FeedPost }
  | { kind: 'skeleton'; id: string };

const FEED_PAGE_SIZE = 12;
/** Fetch the next page while the viewer is still a few cards away from the bottom. */
const PREFETCH_FROM_END = 5;

/**
 * Warm RN's image cache for a freshly-fetched page so cover art / thumbnails /
 * avatars have already downloaded by the time their card scrolls into view — the
 * ProgressiveImage fade-in is then effectively instant. Fire-and-forget: a
 * prefetch failure is ignored (the <Image> just loads normally when rendered).
 */
function prefetchFeedMedia(posts: FeedPost[]): void {
  const urls = new Set<string>();
  for (const post of posts) {
    const candidates = [
      post.track.coverArtUrl,
      post.track.thumbnailUrl,
      post.author.avatarUrl,
      post.originalAuthor?.avatarUrl ?? null,
    ];
    for (const url of candidates) {
      if (url) {
        urls.add(url);
      }
    }
  }
  for (const url of urls) {
    Image.prefetch(url).catch(() => {});
  }
}



function storyInitials(author: { displayName: string | null; username: string }): string {
  const name = author.displayName?.trim() || author.username;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

function FriendStorySkeletonStrip() {
  const placeholders = useMemo(() => Array.from({ length: 8 }, (_, i) => i), []);
  return (
    <View style={styles.storySkeletonRow}>
      {placeholders.map(i => (
        <View key={i} style={styles.storySkeletonBubbleOuter}>
          <View style={styles.storySkeletonBubbleInner} />
        </View>
      ))}
    </View>
  );
}

function FriendStoriesRow({
  loading,
  stories,
}: {
  loading: boolean;
  stories: Story[];
}) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // One ring per author (Instagram-style). The viewer is handed the ordered
  // clusters so cross-author tap/swipe works; the tapped ring is startAuthorIndex.
  const clusters = useMemo(() => groupStoriesByAuthor(stories), [stories]);
  const routeClusters = useMemo(
    () => clusters.map(c => ({ authorId: c.authorId, storyIds: c.storyIds })),
    [clusters],
  );

  if (loading) {
    return (
      <View style={styles.storiesSection}>
        <Text style={styles.storiesHeading}>Friends</Text>
        <FriendStorySkeletonStrip />
      </View>
    );
  }

  if (stories.length === 0) {
    return (
      <View style={styles.storiesSection}>
        <Text style={styles.storiesHeading}>Friends</Text>
        <Text style={styles.storiesEmpty}>
          No stories from friends yet. Reposts as stories from your friends will appear here.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.storiesSection}>
      <Text style={styles.storiesHeading}>Friends</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.storiesRow}
      >
        {clusters.map((cluster, i) => {
          const seen = !cluster.hasUnseen;
          const count = cluster.storyIds.length;
          return (
            <Pressable
              key={cluster.authorId}
              style={styles.storyCell}
              onPress={() =>
                navigation.navigate('StoryViewer', {
                  clusters: routeClusters,
                  startAuthorIndex: i,
                  // Open at the first UNWATCHED clip (Instagram), not the start.
                  startStoryIndex: cluster.firstUnseenIndex,
                })
              }
            >
              <View style={styles.storyRingWrap}>
                <View style={[
                  styles.storyRing,
                  seen
                    ? { borderColor: COLORS.textMuted, shadowColor: 'transparent' }
                    : { borderColor: COLORS.purple, shadowColor: COLORS.purple },
                ]}>
                  <View style={styles.storyAvatar}>
                    {cluster.author.avatarUrl ? (
                      <Image source={{ uri: cluster.author.avatarUrl }} style={styles.storyAvatarImg} />
                    ) : (
                      <Text style={styles.storyAvatarText}>
                        {storyInitials(cluster.author)}
                      </Text>
                    )}
                  </View>
                </View>
                {count > 1 ? (
                  <View style={[styles.storyCountBadge, seen && styles.storyCountBadgeSeen]}>
                    <Text style={styles.storyCountText}>{count}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.storyUsername} numberOfLines={1}>
                @{cluster.author.username}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default function HomeScreen() {
  const navigation = useNavigation<HomeNavigation>();
  const playback = usePlayback();
  const comments = useCommentsCountDeltas();
  // Posts the viewer has deleted in this session. Filtered out before the
  // FlatList sees them, so the card unmounts immediately.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const handlePostDeleted = useCallback((postId: string) => {
    setDeletedIds(prev => {
      if (prev.has(postId)) { return prev; }
      const next = new Set(prev);
      next.add(postId);
      return next;
    });
  }, []);
  const { stories, setStories } = useStories();
  const { pendingIncomingCount } = useRelationships();
  const insets = useSafeAreaInsets();

  // Top bar hide/show on scroll direction
  const TOP_BAR_H = 64;
  const topBarAnim = useRef(new Animated.Value(0)).current;
  const lastScrollY = useRef(0);
  const topBarVisible = useRef(true);

  const showTopBar = useCallback(() => {
    if (!topBarVisible.current) {
      topBarVisible.current = true;
      Animated.spring(topBarAnim, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
    }
  }, [topBarAnim]);

  const hideTopBar = useCallback(() => {
    if (topBarVisible.current) {
      topBarVisible.current = false;
      Animated.spring(topBarAnim, { toValue: -(TOP_BAR_H + insets.top), useNativeDriver: true, bounciness: 0 }).start();
    }
  }, [topBarAnim, insets.top]);

  // Bottom nav bar: hide on scroll down, show instantly on scroll up — in lock-step
  // with the top bar's direction-based behaviour below.
  const { hideChrome, showChrome } = useChromeVisibility();

  const handleScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = e.nativeEvent.contentOffset.y;
    const diff = y - lastScrollY.current;
    lastScrollY.current = y;
    if (y < 10) { showTopBar(); showChrome(); return; }
    if (diff > 4) { hideTopBar(); hideChrome(); }
    else if (diff < -4) { showTopBar(); showChrome(); }
  }, [showTopBar, hideTopBar, showChrome, hideChrome]);

  // Always restore the chrome when leaving Home (e.g. switching tabs while the
  // bar is hidden) so it isn't stuck off-screen on the next screen.
  useFocusEffect(
    useCallback(() => {
      return () => { showChrome(); };
    }, [showChrome]),
  );

  const [meProfile, setMeProfile] = useState<ProfileSnippet | null>(null);
  const [totalUnread, setTotalUnread] = useState(0);
  // Unread livil Bot activity (likes/comments/reposts/milestones/friend outcomes).
  // These live in `activity_notifications` (services/activity), NOT the messages
  // table — so they must be counted separately from `totalUnread`.
  const [activityUnread, setActivityUnread] = useState(0);
  // Total badge count shown on the 💬 button = unread messages + incoming friend
  // requests + unread livil Bot activity.
  const notificationCount = totalUnread + pendingIncomingCount + activityUnread;

  const [storiesLoading, setStoriesLoading] = useState(true);

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [feedError, setFeedError] = useState('');
  // Mirrors `nextCursorRef.current === null` as state so the footer re-renders
  // when pagination is exhausted (refs alone don't trigger re-renders).
  const [endOfFeed, setEndOfFeed] = useState(false);

  const nextCursorRef = useRef<HomeFeedCursor | null>(null);
  const loadingMoreRef = useRef(false);
  const loadingInitialRef = useRef(true);

  // Viewability feeds ONLY the pagination prefetch (refs, no setState). The former
  // per-scroll `visibleIds` state re-rendered every mounted PostCard several times a
  // second while scrolling (the "large list is slow to update" warning) for a
  // `visible` prop PostCard hasn't read since the single-engine consolidation.
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
    minimumViewTime: 120,
  }).current;

  const postsRef = useRef<FeedPost[]>([]);
  postsRef.current = posts;

  useEffect(() => {
    if (!playback.activePostId) { return; }
    // Only reset the queue when the user tapped play in the feed, not when
    // playback advanced programmatically (queue navigation, next/prev).
    if (playback.playSourceRef.current !== 'user') { return; }
    const allPosts = postsRef.current;
    const startIdx = allPosts.findIndex(p => p.id === playback.activePostId);
    if (startIdx < 0) { return; }
    playback.setQueue(
      allPosts.map(p => {
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
      'Home',
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback.activePostId, playback.setQueue]);

  const appendFeedPageRef = useRef<(mode: 'initial' | 'refresh' | 'prefetch' | 'end') => Promise<void>>(
    async () => {},
  );

  const handleViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      let maxIndex = 0;
      for (const v of viewableItems) {
        if (typeof v.index === 'number') {
          maxIndex = Math.max(maxIndex, v.index);
        }
      }

      const len = postsRef.current.length;
      const nearEnd =
        len > 0 &&
        nextCursorRef.current !== null &&
        !loadingMoreRef.current &&
        !loadingInitialRef.current &&
        maxIndex >= len - PREFETCH_FROM_END;

      if (!nearEnd) {
        return;
      }

      // Never kick off pagination synchronously from this callback — it can trip RN invariant paths.
      setTimeout(() => {
        void appendFeedPageRef.current('prefetch');
      }, 0);
    },
  ).current;

  // Deliberately no pauseAll() on blur — audio should keep playing when the
  // user navigates to another screen (e.g. UserProfile). Cards render no inline
  // video (single-engine, ADR-0001), so nothing needs pausing on scroll-away.

  // One-time: load my profile for the hero avatar.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData?.user?.id;
        if (!uid) { return; }
        const { data, error } = await supabase
          .from('profiles')
          .select('username, display_name, avatar_url')
          .eq('id', uid)
          .maybeSingle();
        if (cancelled || error) { return; }
        if (data) {
          setMeProfile({
            username: data.username,
            displayName: data.display_name,
            avatarUrl: data.avatar_url,
          });
        }
      } catch {
        // Hero initials simply fall back to '?'.
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Re-fetch unread message count whenever Home regains focus.
  // Covers: user opens Inbox → reads messages (last_read_at advances) → returns
  // to Home and expects the badge to be cleared.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const convs = await listConversations();
          if (!cancelled) {
            setTotalUnread(convs.reduce((sum, c) => sum + c.unreadCount, 0));
          }
        } catch {
          // ignore
        }
        // livil Bot activity is a separate table — refetch its unread count too.
        // Covers: user opens Activity Center → markActivityRead() → returns to Home
        // and expects the bot's contribution to the badge cleared.
        try {
          const n = await getActivityUnreadCount();
          if (!cancelled) { setActivityUnread(n); }
        } catch {
          // ignore
        }
      })();
      return () => { cancelled = true; };
    }, []),
  );

  // Live: increment unread when a new message arrives in any of my conversations.
  // RLS lets the realtime worker filter to messages I can SELECT (i.e. ones in
  // conversations I'm a member of), so we don't need a per-conversation filter here.
  // Decrement on read is handled by the focus refetch above.
  useEffect(() => {
    let myId: string | null = null;
    let mounted = true;

    void supabase.auth.getUser().then(({ data }) => {
      myId = data?.user?.id ?? null;
    });

    console.log('[realtime] subscribing to home:unread');
    const channel = supabase
      .channel('home:unread')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload: { new: { sender_id?: string | null; kind?: string; deleted_at?: string | null } }) => {
          console.log('[realtime] home:unread got messages INSERT');
          if (!mounted) { return; }
          const row = payload.new;
          if (!row) { return; }
          if (row.kind === 'system') { return; }
          if (row.deleted_at) { return; }
          if (myId && row.sender_id === myId) { return; }
          setTotalUnread(n => n + 1);
        },
      )
      .subscribe(status => {
        console.log(`[realtime] home:unread status=${status}`);
      });

    return () => {
      mounted = false;
      void supabase.removeChannel(channel);
    };
  }, []);

  // Live: keep the livil Bot activity contribution to the badge current. Any
  // insert/update/delete on activity_notifications for me → refetch the count.
  // Refetch (not increment) because likes aggregate into an existing row (an
  // arriving like is an UPDATE, not always an INSERT), and mark-read is an
  // UPDATE too — a naive +1 would drift. `recipient_id` filter mirrors the
  // ActivityCenterScreen subscription; the channel is gated on the resolved id.
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void supabase.auth.getUser().then(({ data }) => {
      const myId = data?.user?.id;
      if (!myId || cancelled) { return; }
      channel = supabase
        .channel(`home:activity:${myId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'activity_notifications',
            filter: `recipient_id=eq.${myId}`,
          },
          () => {
            void getActivityUnreadCount()
              .then(n => { if (!cancelled) { setActivityUnread(n); } })
              .catch(() => { /* ignore */ });
          },
        )
        .subscribe();
    });
    return () => {
      cancelled = true;
      if (channel) { void supabase.removeChannel(channel); }
    };
  }, []);

  const appendFeedPage = useCallback(async (mode: 'initial' | 'refresh' | 'prefetch' | 'end') => {
    if (loadingMoreRef.current) {
      return;
    }
    if ((mode === 'prefetch' || mode === 'end') && nextCursorRef.current === null) {
      return;
    }

    loadingMoreRef.current = true;
    // Surface the skeleton footer for any pagination fetch (prefetch + end).
    // Initial/refresh are handled by their own indicators, not this footer.
    const showSpinner = mode === 'end' || mode === 'prefetch';
    if (showSpinner) {
      setLoadingMore(true);
    }
    if (mode === 'initial') {
      setLoadingInitial(true);
      setFeedError('');
      nextCursorRef.current = null;
      setPosts([]);
      setEndOfFeed(false);
    }
    if (mode === 'refresh') {
      setFeedError('');
      nextCursorRef.current = null;
      setEndOfFeed(false);
    }

    try {
      const cursor =
        mode === 'initial' || mode === 'refresh'
          ? null
          : nextCursorRef.current;

      const { posts: chunk, nextCursor } = await fetchHomeFeedPage({
        limit: FEED_PAGE_SIZE,
        cursor,
      });

      // Warm the cache for this page's media so cards below the fold (and the
      // next page's cards) fade in instantly instead of popping when scrolled to.
      prefetchFeedMedia(chunk);

      setPosts(prev => {
        if (mode === 'initial' || mode === 'refresh') {
          return chunk;
        }
        const seen = new Set(prev.map(p => p.id));
        const merged = chunk.filter(p => !seen.has(p.id));
        return [...prev, ...merged];
      });

      nextCursorRef.current = nextCursor;
      setEndOfFeed(nextCursor === null);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message || 'Could not load your feed.'
          : typeof err === 'string'
            ? err
            : 'Could not load your feed.';
      if (mode === 'initial' || mode === 'refresh') {
        setFeedError(message);
      }
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
      setLoadingInitial(false);
    }
  }, []);

  appendFeedPageRef.current = appendFeedPage;

  useEffect(() => {
    loadingInitialRef.current = loadingInitial;
  }, [loadingInitial]);

  useEffect(() => {
    let cancelled = false;

    const storiesPromise = (async () => {
      setStoriesLoading(true);
      try {
        const loadedStories = await listActiveStories();
        if (!cancelled) {
          setStories(loadedStories);
        }
      } catch {
        if (!cancelled) {
          setStories([]);
        }
      } finally {
        if (!cancelled) {
          setStoriesLoading(false);
        }
      }
    })();

    void Promise.all([storiesPromise, appendFeedPage('initial')]);

    return () => {
      cancelled = true;
    };
  }, [appendFeedPage, setStories]);

  const handleRefresh = useCallback(async () => {
    playback.pauseAll();
    // The fixed top bar sits above the list at the same spot the pull-to-refresh
    // spinner draws in — slide it out of the way for the duration of the refresh
    // so the spinner is actually visible, then let it back in once done.
    hideTopBar();
    setRefreshing(true);
    try {
      await Promise.all([
        (async () => {
          try {
            const loadedStories = await listActiveStories();
            setStories(loadedStories);
          } catch {
            setStories([]);
          }
        })(),
        appendFeedPage('refresh'),
      ]);
    } finally {
      setRefreshing(false);
      showTopBar();
    }
  }, [appendFeedPage, playback, hideTopBar, showTopBar, setStories]);

  const handleEndReached = useCallback(() => {
    void appendFeedPage('end');
  }, [appendFeedPage]);

  const feedRows = useMemo((): FeedListItem[] => {
    if (loadingInitial) {
      return Array.from({ length: 4 }, (_, i) => ({
        kind: 'skeleton' as const,
        id: `sk-${i}`,
      }));
    }
    return posts
      .filter(post => !deletedIds.has(post.id))
      .map(post => ({ kind: 'post' as const, post }));
  }, [loadingInitial, posts, deletedIds]);

  const renderFeedItem = useCallback(
    ({ item }: { item: FeedListItem }) => {
      if (item.kind === 'skeleton') {
        return <PostCardSkeleton />;
      }
      return (
        <PostCard
          post={comments.withDelta(item.post)}
          onCommentsPress={comments.openComments}
          onDeleted={handlePostDeleted}
        />
      );
    },
    [comments, handlePostDeleted],
  );

  const feedKeyExtractor = useCallback((item: FeedListItem) => {
    return item.kind === 'post' ? item.post.id : item.id;
  }, []);

  const listHeader = useMemo(
    () => (
      <>
        {/* Spacer so content starts below the fixed top bar */}
        <View style={{ height: TOP_BAR_H }} />

        {/*
          TODO: Featured Today — curated editorial spotlight card once CMS + tooling exists.
          Previous UI lived here as a purple gradient hero linking into a programmed playlist.

        <Pressable style={styles.featured}>
          ...
        </Pressable>
        */}

        <FriendStoriesRow loading={storiesLoading} stories={stories} />

        <View style={styles.feedHeadingBlock}>
          <Text style={styles.feedHeading}>For you</Text>
          <Text style={styles.feedSubheading}>
            {loadingInitial
              ? 'Loading your personalized mix…'
              : "Mutual friends first, people you star next, then what's trending."}
          </Text>
        </View>

        {feedError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{feedError}</Text>
            <Button
              label="Retry"
              size="md"
              variant="primary"
              style={styles.retryButton}
              onPress={() => void appendFeedPage('initial')}
            />
          </View>
        ) : null}
      </>
    ),
    // Lint reports meProfile/navigation/notificationCount as unnecessary here.
    // Removing them would change when this header recomputes; with no tests over
    // the feed that is an unverifiable change. Left as-is pending coverage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigation, meProfile, storiesLoading, stories, feedError, loadingInitial, appendFeedPage, notificationCount],
  );

  const footer = useMemo(() => {
    if (loadingInitial || posts.length === 0) {
      return <View style={styles.footerSpace} />;
    }
    if (loadingMore) {
      return (
        <>
          <PostCardSkeleton />
          <PostCardSkeleton />
        </>
      );
    }
    if (endOfFeed) {
      return <FeedEndMessage />;
    }
    return <View style={styles.footerSpace} />;
  }, [loadingMore, posts.length, loadingInitial, endOfFeed]);

  const tabBarHeight = Platform.OS === 'ios' ? 84 : 64 + insets.bottom;
  const listContentStyle = useMemo(
    () => [
      styles.listContent,
      { paddingBottom: tabBarHeight + 56 + FLOATING_PLAYER_HEIGHT + 16 },
      !loadingInitial && feedRows.length === 0 ? styles.listContentFlex : null,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feedRows.length, loadingInitial, tabBarHeight],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <FlatList
        data={feedRows}
        keyExtractor={feedKeyExtractor}
        renderItem={renderFeedItem}
        ListHeaderComponent={listHeader}
        ListFooterComponent={footer}
        removeClippedSubviews={false}
        ListEmptyComponent={
          loadingInitial ? undefined : (
            <View style={styles.emptyFeed}>
              {feedError ? (
                <>
                  <Text style={styles.emptyFeedTitle}>Couldn't load the feed</Text>
                  <Text style={styles.emptyFeedBody}>{feedError}</Text>
                  <Text style={styles.emptyFeedHint}>Pull to refresh or tap Retry above.</Text>
                </>
              ) : (
                <>
                  <Text style={styles.emptyFeedTitle}>No posts yet</Text>
                  <Text style={styles.emptyFeedBody}>
                    Follow friends or upload a track — new posts will appear here automatically.
                  </Text>
                </>
              )}
            </View>
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.purpleLight}
            colors={[COLORS.purple]}
          />
        }
        onEndReached={() => {
          if (!loadingInitial) {
            handleEndReached();
          }
        }}
        onEndReachedThreshold={0.35}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={handleViewableItemsChanged}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={listContentStyle}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      />

      {/* Fixed top bar — slides up on scroll down, returns on scroll up */}
      <Animated.View
        style={[styles.topBarFixed, { top: insets.top, transform: [{ translateY: topBarAnim }] }]}
        pointerEvents="box-none"
      >
        <View style={styles.topBar}>
          {/* The mark carries the brand on its own now, so the row needs an
              explicit label — without the "livil" text there is nothing for a
              screen reader to announce. */}
          <View style={styles.brandRow} accessibilityRole="header" accessibilityLabel="Livil">
            {/* Mark only — the pulse glyph is itself a stylized wordmark, so the
                "livil" text alongside it was redundant. Black-and-white to match
                the app icon; the header is already near-black, so the icon's dark
                plate is the background itself and the mark needs no tile. */}
            <Logo size={96} color={COLORS.white} />
          </View>
          <View style={styles.topBarActions}>
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.uploadButton}
              onPress={() => navigation.navigate('Upload')}
              accessibilityLabel="Upload music"
            >
              <GradientBorder borderRadius={19} />
              <Text style={styles.uploadButtonText}>+</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.inboxButton}
              onPress={() => navigation.navigate('Inbox')}
              accessibilityLabel="Open messages"
            >
              <Icon name="send" size={18} color={COLORS.white} />
              {notificationCount > 0 && (
                <View style={styles.inboxBadge}>
                  <Text style={styles.inboxBadgeText}>
                    {notificationCount > 99 ? '99+' : notificationCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>

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
    paddingBottom: 0, // dynamic — computed inline via insets
  },
  listContentFlex: {
    flexGrow: 1,
  },

  topBarFixed: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(10, 10, 15, 0.90)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(139, 61, 255, 0.25)',
    zIndex: 10,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  uploadButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadButtonText: {
    color: COLORS.purpleNeon,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 26,
    marginTop: -2,
  },
  inboxButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inboxIcon: { fontSize: 18 },
  inboxBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: COLORS.purple,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: COLORS.bg,
  },
  inboxBadgeText: { color: COLORS.white, fontSize: 9, fontWeight: '800' },

  storiesSection: {
    paddingBottom: 12,
  },
  storiesHeading: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '800',
    paddingHorizontal: 20,
    marginBottom: 12,
    letterSpacing: -0.2,
  },
  storiesEmpty: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  storiesRow: {
    paddingHorizontal: 16,
    gap: 14,
    paddingBottom: 4,
  },
  storyCell: {
    width: 76,
    alignItems: 'center',
    gap: 8,
  },
  storyRingWrap: {
    width: 74,
    height: 74,
  },
  storyCountBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: COLORS.purple,
    borderWidth: 2,
    borderColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyCountBadgeSeen: {
    backgroundColor: COLORS.textMuted,
  },
  storyCountText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '800',
  },
  storyRing: {
    width: 74,
    height: 74,
    borderRadius: 37,
    padding: 3,
    borderWidth: 2,
    borderColor: COLORS.purple,
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  storyAvatar: {
    flex: 1,
    borderRadius: 34,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: COLORS.bg,
  },
  storyAvatarImg: {
    width: '100%',
    height: '100%',
  },
  storyAvatarText: {
    color: COLORS.white,
    fontWeight: '800',
    fontSize: 18,
  },
  storyUsername: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    maxWidth: 76,
    textAlign: 'center',
  },

  storySkeletonRow: {
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  storySkeletonBubbleOuter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 2,
    borderColor: COLORS.border,
    padding: 3,
    opacity: 0.55,
  },
  storySkeletonBubbleInner: {
    flex: 1,
    borderRadius: 34,
    backgroundColor: COLORS.surface,
  },

  feedHeadingBlock: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 6,
  },
  feedHeading: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  feedSubheading: {
    color: COLORS.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },

  errorBanner: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.errorBorder,
    backgroundColor: COLORS.errorBg,
  },
  errorBannerText: {
    color: COLORS.error,
    fontSize: 13,
    lineHeight: 18,
  },
  retryButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
  },

  emptyFeed: {
    paddingHorizontal: 28,
    paddingVertical: 36,
    alignItems: 'center',
    gap: 10,
  },
  emptyFeedTitle: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '800',
  },
  emptyFeedBody: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  emptyFeedHint: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 12,
    textAlign: 'center',
  },

  footerSpace: {
    height: 16,
  },

});
