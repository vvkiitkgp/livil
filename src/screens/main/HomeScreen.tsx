import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Platform,
  AppState,
  Animated,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  RefreshControl,
  Image,
  ScrollView,
  type ViewToken,
} from 'react-native';
import Reanimated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CompositeNavigationProp } from '@react-navigation/native';
import { useNavigation, useFocusEffect, useRoute, type RouteProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../../lib/supabase';
import { COLORS } from '../../theme/colors';
import { haptics } from '../../utils/haptics';
import type { AppTabParamList, RootStackParamList } from '../../navigation/types';
import PostCard from '../../components/PostCard';
import PostCardSkeleton from '../../components/PostCardSkeleton';
import FeedEndMessage from '../../components/FeedEndMessage';
import CommentsSheet from '../../components/CommentsSheet';
import { Icon } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { Button } from '../../components/Button';
import { FLOATING_PLAYER_HEIGHT } from '../../components/FloatingPlayer';
import { HomeFeedTabs } from '../../components/HomeFeedTabs';
import { useCommentsCountDeltas } from '../../hooks/useCommentsCountDeltas';
import { usePlayback } from '../../contexts/PlaybackContext';
import { useRelationships } from '../../contexts/RelationshipContext';
import { useChromeVisibility } from '../../contexts/ChromeVisibilityContext';
import {
  isPlayableInLivil,
  type FeedPost,
  type HomeFeedTab,
} from '../../services/posts';
import { useHomeFeed, type HomeFeedState } from '../../hooks/useHomeFeed';
import { useNewOnLivilDot } from '../../hooks/useNewOnLivilDot';
import {
  clampScrollOffset,
  isTabBarPinned,
  pinTop,
} from '../../utils/homeTabsPin';
import { useSpotifyAvailability } from '../../services/spotify';
import { recordImpression, flushImpressions } from '../../services/feedImpressions';
import { listActiveStories, type Story } from '../../services/stories';
import { useStories } from '../../contexts/StoriesContext';
import { groupStoriesByAuthor } from '../../utils/groupStoriesByAuthor';
import { listConversations } from '../../services/conversations';
import { getActivityUnreadCount } from '../../services/activity';
import {
  setAppBadgeCount,
  resyncAppBadgeCount,
  onBadgeRefreshRequested,
} from '../../services/appBadge';
import { retryOnce } from '../../utils/retryOnce';

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
/** The fixed top bar's height; the list clears it (iOS inset, Android spacer). */
const TOP_BAR_H = 64;
/** Where a list rests before any scroll: iOS clears the top bar with a content inset. */
const RESTING_Y = Platform.OS === 'ios' ? -TOP_BAR_H : 0;
/** Home's pages, left to right. */
const PAGE_INDEX: Record<HomeFeedTab, number> = { for_you: 0, new_on_livil: 1 };
/** How far a feed drifts sideways as it fades out (and in from), for a sense of direction. */
const SWITCH_NUDGE = 14;
const SWITCH_MS = 200;
/** Fetch the next page while the viewer is still a few cards away from the bottom. */
const PREFETCH_FROM_END = 5;

/**
 * How long a card must stay on screen before it counts as having been SHOWN (PROP-0010).
 *
 * Deliberately not expressed as `minimumViewTime` on the shared `viewabilityConfig`: that
 * config also drives the pagination prefetch, and raising it to 1.2s would delay every
 * next-page fetch by the same amount. Dwell is timed here instead, per card, and the timer
 * is cancelled if the card scrolls away first — so flicking past ten cards to reach the
 * eleventh records one impression, not eleven.
 */
const IMPRESSION_DWELL_MS = 1200;

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
                  seen ? styles.storyRingSeen : styles.storyRingUnseen,
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

/**
 * What sits above one page's posts: stories, the For you | New on Livil pills, the line
 * under them and any load error. A component (not a render function) so each page's
 * ListHeaderComponent is an ELEMENT of a stable type — a function there would remount the
 * header on every new identity (CLAUDE.md).
 */
function HomeListHeader({
  which,
  storiesLoading,
  stories,
  showTabs,
  tabsHidden,
  activeTab,
  onSelectTab,
  newDot,
  onTabsLayout,
  loading,
  feedError,
  onRetry,
}: {
  which: HomeFeedTab;
  storiesLoading: boolean;
  stories: Story[];
  showTabs: boolean;
  tabsHidden: boolean;
  activeTab: HomeFeedTab;
  onSelectTab: (tab: HomeFeedTab) => void;
  newDot: boolean;
  onTabsLayout: (y: number) => void;
  loading: boolean;
  feedError: string;
  onRetry: () => void;
}) {
  return (
    <>
      {/* Spacer so content starts below the fixed top bar — Android only. iOS clears the
          bar with a content inset instead (see FEED_INSET_IOS), which is what puts the
          pull-to-refresh spinner BELOW the bar: a spacer is content, and the spinner draws
          above content, i.e. behind the bar. */}
      {Platform.OS === 'android' ? <View style={{ height: TOP_BAR_H }} /> : null}

      <FriendStoriesRow loading={storiesLoading} stories={stories} />

      {/* The in-list For you | New on Livil switch. Its position decides when the pinned
          copy (rendered over the pages) takes over. */}
      {showTabs ? (
        <View
          onLayout={e => onTabsLayout(e.nativeEvent.layout.y)}
          // While the pinned copy is up, this one is under the translucent top bar,
          // where it would show through as a ghost of the same pills.
          style={tabsHidden ? styles.inListTabsHidden : undefined}
        >
          <HomeFeedTabs active={activeTab} onSelect={onSelectTab} showNewDot={newDot} />
        </View>
      ) : null}

      <View style={styles.feedHeadingBlock}>
        {/* Without the tabs (backend not there yet), Home reads as it always has. */}
        {showTabs ? null : <Text style={styles.feedHeading}>For you</Text>}
        <Text style={styles.feedSubheading}>
          {which === 'for_you'
            ? loading
              ? 'Loading your personalized mix…'
              : "Mutual friends first, people you star next, then what's trending."
            : loading
              ? 'Loading new songs…'
              : "Only songs uploaded to Livil. Friends first, people you star next, then what's trending."}
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
            onPress={onRetry}
          />
        </View>
      ) : null}
    </>
  );
}

/**
 * One of Home's two stacked feeds. Both stay mounted and drawn — switching never rebuilds a
 * feed card by card (owner report: the cards visibly morphed one by one when one list was
 * handed the other feed's posts). The one on screen is fully visible and touchable; the
 * other is transparent and ignores touches. A switch fades between them with a small
 * sideways drift, on the UI thread, and a fast tap-back simply turns the fade around.
 */
function FeedLayer({
  index,
  progress,
  active,
  children,
}: {
  index: number;
  progress: SharedValue<number>;
  active: boolean;
  children: React.ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    const distance = progress.value - index;
    return {
      opacity: 1 - Math.min(1, Math.abs(distance)),
      transform: [{ translateX: -distance * SWITCH_NUDGE }],
    };
  });
  return (
    <Reanimated.View
      style={[StyleSheet.absoluteFill, active ? styles.feedLayerActive : null, style]}
      pointerEvents={active ? 'auto' : 'none'}
    >
      {children}
    </Reanimated.View>
  );
}

/** One page's rows: skeletons until its first load lands, then its posts. */
function useFeedRows(feed: HomeFeedState, deletedIds: Set<string>): FeedListItem[] {
  return useMemo((): FeedListItem[] => {
    if (feed.loadingInitial) {
      return Array.from({ length: 4 }, (_, i) => ({ kind: 'skeleton' as const, id: `sk-${i}` }));
    }
    return feed.posts
      .filter(post => !deletedIds.has(post.id))
      .map(post => ({ kind: 'post' as const, post }));
  }, [feed.loadingInitial, feed.posts, deletedIds]);
}

/** One page's footer: the paging skeletons, the end of the feed, or room to scroll. */
function useFeedFooter(feed: HomeFeedState): React.ReactElement {
  return useMemo(() => {
    if (feed.loadingInitial || feed.posts.length === 0) {
      return <View style={styles.footerSpace} />;
    }
    if (feed.loadingMore) {
      return (
        <>
          <PostCardSkeleton />
          <PostCardSkeleton />
        </>
      );
    }
    if (feed.endOfFeed) {
      return <FeedEndMessage />;
    }
    return <View style={styles.footerSpace} />;
  }, [feed.loadingMore, feed.posts.length, feed.loadingInitial, feed.endOfFeed]);
}

export default function HomeScreen() {
  const navigation = useNavigation<HomeNavigation>();
  const spotify = useSpotifyAvailability();
  const playback = usePlayback();
  // Posts the viewer has deleted in this session. Filtered out before the
  // FlatList sees them, so the card unmounts immediately.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  // Mirrors deletedIds for appendFeedPage (memoised with no deps), so it can tell
  // which card is actually the first on screen.
  const deletedIdsRef = useRef(deletedIds);
  deletedIdsRef.current = deletedIds;
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

  // Home's two pages (owner design 2026-10-14): For you, and New on Livil — the same
  // ranker server-side with one filter, uploads only — stacked, both drawn, and a pill tap
  // fades between them. `tab` is the feed on screen.
  const [tab, setTab] = useState<HomeFeedTab>('for_you');
  const tabRef = useRef(tab);
  tabRef.current = tab;

  // Top bar hide/show on scroll direction
  // iOS: clear the floating top bar with an inset rather than a spacer row, so
  // UIRefreshControl sits under the bar instead of behind it. The resting scroll
  // offset becomes -TOP_BAR_H; handleScroll's `y < 10` "at the top" test still
  // holds for it.
  const FEED_INSET_IOS = useMemo(() => ({
    contentInset: { top: TOP_BAR_H },
    contentOffset: { x: 0, y: -TOP_BAR_H },
    scrollIndicatorInsets: { top: TOP_BAR_H },
  }), []);
  const topBarAnim = useRef(new Animated.Value(0)).current;
  // Each page keeps its own scroll; the one on screen drives the top bar and the pins.
  const lastScrollYRef = useRef<Record<HomeFeedTab, number>>({
    for_you: RESTING_Y,
    new_on_livil: RESTING_Y,
  });
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

  // ── For you | New on Livil: the pinned copy ─────────────────────────────────
  // The tab bar lives in the list under the stories. Once it would scroll under the top
  // bar (or off the top, while the top bar is hidden) a copy pinned to the screen takes
  // over, following the top bar as it slides. Two copies rather than FlatList's
  // stickyHeaderIndices: a sticky header sticks to the list's own top edge, which is
  // underneath the floating top bar whenever that is showing.
  const tabBarYRef = useRef<number | null>(null);
  const pinnedRef = useRef(false);
  const [pinned, setPinned] = useState(false);
  const updatePinned = useCallback((scrollY: number) => {
    const tabY = tabBarYRef.current;
    if (tabY === null) { return; }
    const next = isTabBarPinned(tabY, scrollY, pinTop(topBarVisible.current, TOP_BAR_H));
    if (next !== pinnedRef.current) {
      pinnedRef.current = next;
      setPinned(next);
    }
  }, []);
  // After a programmatic scroll, decide from where the list can really rest: a short tab
  // clamps the scroll, and iOS may not report that with a scroll event (homeTabsPin.ts).
  const viewportHRef = useRef(0);
  const contentHRef = useRef<Record<HomeFeedTab, number>>({ for_you: 0, new_on_livil: 0 });
  const recheckPin = useCallback(() => {
    const which = tabRef.current;
    const contentH = contentHRef.current[which];
    if (!viewportHRef.current || !contentH) { return; }
    const y = clampScrollOffset(lastScrollYRef.current[which], contentH, viewportHRef.current, RESTING_Y);
    lastScrollYRef.current[which] = y;
    updatePinned(y);
  }, [updatePinned]);
  const pinnedTabsY = useMemo(
    () => topBarAnim.interpolate({
      inputRange: [-(TOP_BAR_H + insets.top), 0],
      outputRange: [-TOP_BAR_H, 0],
      extrapolate: 'clamp',
    }),
    [topBarAnim, insets.top],
  );

  const handleScrollFor = useCallback((which: HomeFeedTab, y: number) => {
    const diff = y - lastScrollYRef.current[which];
    lastScrollYRef.current[which] = y;
    // The page off screen can still report (momentum, content resizing): it only records
    // where it is. The page on screen moves the shared bars and the pins.
    if (which !== tabRef.current) { return; }
    // Tabs stay mounted when you leave them, and a list can still emit scroll events
    // off-screen (momentum, content resizing). Only the visible tab may move the
    // shared tab bar — otherwise Home could hide it while you are on Library, a tab
    // root with no back gesture, and there is then no way out.
    if (navigation.isFocused()) {
      if (y < 10) { showTopBar(); showChrome(); }
      else if (diff > 4) { hideTopBar(); hideChrome(); }
      else if (diff < -4) { showTopBar(); showChrome(); }
    }
    updatePinned(y);
  }, [navigation, showTopBar, hideTopBar, showChrome, hideChrome, updatePinned]);
  const onScrollForYou = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => handleScrollFor('for_you', e.nativeEvent.contentOffset.y),
    [handleScrollFor],
  );
  const onScrollNewOnLivil = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => handleScrollFor('new_on_livil', e.nativeEvent.contentOffset.y),
    [handleScrollFor],
  );

  // Always restore the chrome when leaving Home (e.g. switching tabs while the
  // bar is hidden) so it isn't stuck off-screen on the next screen.
  //
  // Leaving is also the moment to send whatever impressions are still buffered: the
  // viewer may not come back for hours, and a batch that never leaves the device is a
  // post the feed goes on repeating.
  useFocusEffect(
    useCallback(() => {
      return () => {
        showChrome();
        flushImpressions();
      };
    }, [showChrome]),
  );

  // Loaded for the hero, which no longer shows it; kept until that load is removed on its own.
  const [_meProfile, setMeProfile] = useState<ProfileSnippet | null>(null);
  const [totalUnread, setTotalUnread] = useState(0);
  // Unread livil Bot activity (likes/comments/reposts/milestones/friend outcomes).
  // These live in `activity_notifications` (services/activity), NOT the messages
  // table — so they must be counted separately from `totalUnread`.
  const [activityUnread, setActivityUnread] = useState(0);
  // Total badge count shown on the 💬 button = unread messages + incoming friend
  // requests + unread livil Bot activity.
  const notificationCount = totalUnread + pendingIncomingCount + activityUnread;

  // Mirror the in-app badge onto the home-screen icon.
  //
  // This screen is the only place all three counts exist at once, and it keeps
  // them live (realtime subscriptions above + the focus refetch below), so it is
  // the natural owner. HomeScreen is a bottom-tab screen and therefore stays
  // mounted while the user is signed in -- the badge keeps tracking on the Search
  // or Profile tab, not just here.
  //
  // iOS gets the exact number. Android cannot be told a number at all and instead
  // clears when this reaches zero; the rest of the time its launcher sums the
  // notifications in the tray. See src/services/appBadge.ts.
  useEffect(() => {
    void setAppBadgeCount(notificationCount);
  }, [notificationCount]);

  const [storiesLoading, setStoriesLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);

  // Cards currently being timed for the dwell threshold, and the ones already counted in
  // this feed session. `countedRef` is what stops a card being re-armed every time it
  // re-enters the viewport while the viewer scrolls up and down the same stretch — the
  // server's 10-minute window would collapse those anyway, but not sending them is cheaper
  // than having them ignored.
  // Counted per tab: each tab has its own passes, and a new pass in one must not make the
  // other's already-counted cards count again.
  const dwellTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const countedRef = useRef<Record<HomeFeedTab, Set<string>>>({
    for_you: new Set(),
    new_on_livil: new Set(),
  });

  // A new pass is about to replace one tab's list wholesale, so anything mid-dwell is
  // measuring a card that is on its way off screen. Send what has been counted and start
  // that tab clean — a post that comes back in the new page is a new showing, and the
  // server's 10-minute window decides whether it counts as a separate occasion.
  const settleImpressions = useCallback((which: HomeFeedTab) => {
    for (const timer of dwellTimersRef.current.values()) { clearTimeout(timer); }
    dwellTimersRef.current.clear();
    countedRef.current[which].clear();
    flushImpressions();
  }, []);

  // Each feed keeps its own pass, cursor and list; `feed` is the one on screen. New on
  // Livil loads the first time it is opened.
  const isDeleted = (postId: string) => deletedIdsRef.current.has(postId);
  const forYou = useHomeFeed('for_you', {
    pageSize: FEED_PAGE_SIZE,
    onNewPass: () => settleImpressions('for_you'),
    isDeleted,
    onPage: prefetchFeedMedia,
  });
  const newOnLivil = useHomeFeed('new_on_livil', {
    pageSize: FEED_PAGE_SIZE,
    onNewPass: () => settleImpressions('new_on_livil'),
    isDeleted,
    onPage: prefetchFeedMedia,
  });
  // A database without the New on Livil function (the migration not yet applied) hides
  // the tabs instead of showing an error — the order the app and the backend land in is
  // not guaranteed (CLAUDE.md, Production compatibility).
  const newTabAvailable = !newOnLivil.unavailable;
  // Decided at render, not in an effect: the effect below only re-syncs `tab`, and until it
  // runs, the frame would otherwise show the missing function's error.
  const shownTab: HomeFeedTab = newTabAvailable ? tab : 'for_you';
  const feed = shownTab === 'for_you' ? forYou : newOnLivil;
  // Read by callbacks created once (viewability, refresh) — always the feed on screen.
  const feedRef = useRef(feed);
  feedRef.current = feed;
  // Both, for each page's own callbacks (its prefetch, its end of list).
  const feedsRef = useRef<Record<HomeFeedTab, HomeFeedState>>({ for_you: forYou, new_on_livil: newOnLivil });
  feedsRef.current = { for_you: forYou, new_on_livil: newOnLivil };
  // A comment made on a card in either tab adjusts that post's count in both. The tab on
  // screen goes first: a delta is measured against the first copy of the post found, and
  // that must be the copy the viewer is looking at.
  const bothFeedsPosts = useMemo(
    () => (shownTab === 'for_you'
      ? [...forYou.posts, ...newOnLivil.posts]
      : [...newOnLivil.posts, ...forYou.posts]),
    [shownTab, forYou.posts, newOnLivil.posts],
  );
  const comments = useCommentsCountDeltas(bothFeedsPosts);
  const clearCommentDeltas = comments.clearDeltas;

  const forYouListRef = useRef<FlatList<FeedListItem>>(null);
  const newOnLivilListRef = useRef<FlatList<FeedListItem>>(null);
  const listRefs = useMemo(
    () => ({ for_you: forYouListRef, new_on_livil: newOnLivilListRef }),
    [],
  );

  // ── The New on Livil dot ────────────────────────────────────────────────────
  // Means "an upload newer than your New on Livil list": the list only reloads when the
  // viewer pulls to refresh (owner decision), so the dot stays until they do.
  const { newDot, refresh: refreshNewDot, markSeen: markNewOnLivilSeen } = useNewOnLivilDot();

  // ── Switching tabs ──────────────────────────────────────────────────────────
  const forYouLoad = forYou.appendFeedPage;
  const newOnLivilLoad = newOnLivil.appendFeedPage;
  const forYouStarted = forYou.startedRef;
  const newOnLivilStarted = newOnLivil.startedRef;
  // 0 = For you on screen, 1 = New on Livil, anything between mid-fade.
  const pageProgress = useSharedValue(0);

  // Before a switch, line the arriving feed up with the leaving one, so the stories and
  // pills (each feed carries its own copy at its top) stay exactly where they are while the
  // feeds fade: above the pin point both take the same offset; below it the header is off
  // screen (the pinned pills already stand still), and the arriving feed only needs to be at
  // least that far down — further, and it stays where it was left.
  const alignOtherPage = useCallback((from: HomeFeedTab) => {
    const other: HomeFeedTab = from === 'for_you' ? 'new_on_livil' : 'for_you';
    const fromY = lastScrollYRef.current[from];
    const otherY = lastScrollYRef.current[other];
    const tabY = tabBarYRef.current;
    const pinAt = tabY === null ? Number.POSITIVE_INFINITY : tabY - pinTop(topBarVisible.current, TOP_BAR_H);
    const target = fromY < pinAt ? fromY : Math.max(otherY, pinAt);
    if (target !== otherY) {
      listRefs[other].current?.scrollToOffset({ offset: target, animated: false });
      lastScrollYRef.current[other] = target;
    }
  }, [listRefs]);

  // Switching shows each feed exactly as it was left; only pull-to-refresh reloads it
  // (owner decision). `fresh` is for a push tap only: the song it announced must be there.
  const selectTab = useCallback((next: HomeFeedTab, opts?: { fresh?: boolean }) => {
    const [load, started] = next === 'for_you'
      ? [forYouLoad, forYouStarted]
      : [newOnLivilLoad, newOnLivilStarted];
    const reload = !started.current || Boolean(opts?.fresh);
    if (reload && next === 'new_on_livil') { markNewOnLivilSeen(); }
    if (next !== tabRef.current) {
      haptics.select();
      alignOtherPage(tabRef.current);
      // The cards being timed are about to leave the screen. Not a new pass: what has
      // been counted stays counted.
      for (const timer of dwellTimersRef.current.values()) { clearTimeout(timer); }
      dwellTimersRef.current.clear();
      tabRef.current = next;
      setTab(next);
    }
    // From wherever the fade is now — a quick tap back turns it around, never queues.
    pageProgress.value = withTiming(PAGE_INDEX[next], { duration: SWITCH_MS });
    if (reload) {
      void load('initial');
    }
  }, [markNewOnLivilSeen, forYouLoad, newOnLivilLoad, forYouStarted, newOnLivilStarted, pageProgress, alignOtherPage]);

  // The page on screen changed: the pins and the top bar follow ITS scroll.
  useEffect(() => {
    const y = lastScrollYRef.current[shownTab];
    updatePinned(y);
    if (y < 10) { showTopBar(); showChrome(); }
  }, [shownTab, updatePinned, showTopBar, showChrome]);

  // The tab is missing on the server: put the viewer back on For you.
  useEffect(() => {
    if (!newTabAvailable && tabRef.current === 'new_on_livil') {
      tabRef.current = 'for_you';
      setTab('for_you');
    }
    if (!newTabAvailable) { pageProgress.value = 0; }
  }, [newTabAvailable, pageProgress]);

  // A New music push opens Home on a tab (pushNotifications' handleNotificationData).
  // `at` changes on every tap, so a second identical tap still lands.
  const route = useRoute<RouteProp<AppTabParamList, 'Home'>>();
  const routeTab = route.params?.tab;
  const routeAt = route.params?.at;
  useEffect(() => {
    if (!routeTab) { return; }
    // From the top, so the viewer sees where they landed — and a fresh pass, so the song
    // the push was about is in it.
    listRefs[routeTab].current?.scrollToOffset({ offset: RESTING_Y, animated: false });
    lastScrollYRef.current[routeTab] = RESTING_Y;
    if (routeTab === tabRef.current) { updatePinned(RESTING_Y); }
    showTopBar();
    selectTab(routeTab, { fresh: true });
  }, [routeTab, routeAt, selectTab, updatePinned, showTopBar, listRefs]);

  // Viewability feeds ONLY the pagination prefetch (refs, no setState). The former
  // per-scroll `visibleIds` state re-rendered every mounted PostCard several times a
  // second while scrolling (the "large list is slow to update" warning) for a
  // `visible` prop PostCard hasn't read since the single-engine consolidation.
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
    minimumViewTime: 120,
  }).current;


  useEffect(() => {
    if (!playback.activePostId) { return; }
    // Only reset the queue when the user tapped play in the feed, not when
    // playback advanced programmatically (queue navigation, next/prev).
    if (playback.playSourceRef.current !== 'user') { return; }
    // Spotify reposts are opened in Spotify, never played by Livil (ADR-0027), so they
    // are not part of the queue — skipping over one must land on the next Livil song.
    const allPosts = feedRef.current.postsRef.current.filter(isPlayableInLivil);
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
      // Playing from New on Livil queues uploads only — that tab's list is all there is.
      tabRef.current === 'for_you' ? 'Home' : 'New on Livil',
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback.activePostId, playback.setQueue]);


  // One viewability handler per page, each made once (refs only inside). Impressions count
  // only on the page on screen — the other page's list still thinks its rows are visible,
  // since FlatList measures against its own viewport, not the screen.
  const makeViewabilityHandler = (which: HomeFeedTab) =>
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      let maxIndex = 0;
      const visiblePostIds = new Set<string>();
      for (const v of viewableItems) {
        if (typeof v.index === 'number') {
          maxIndex = Math.max(maxIndex, v.index);
        }
        const row = v.item as FeedListItem | undefined;
        if (row?.kind === 'post') {
          visiblePostIds.add(row.post.id);
        }
      }

      // ── Impressions (PROP-0010) ───────────────────────────────────────────
      // Refs only, no setState: this fires several times a second while scrolling, and
      // the reason the old `visibleIds` state was removed (see viewabilityConfig above)
      // applies just as much here.
      if (which === tabRef.current) {
        const timers = dwellTimersRef.current;
        for (const [postId, timer] of timers) {
          // Scrolled away before it was really looked at — that is not an impression.
          if (!visiblePostIds.has(postId)) {
            clearTimeout(timer);
            timers.delete(postId);
          }
        }
        const counted = countedRef.current[which];
        for (const postId of visiblePostIds) {
          if (timers.has(postId) || counted.has(postId)) { continue; }
          timers.set(
            postId,
            setTimeout(() => {
              timers.delete(postId);
              counted.add(postId);
              recordImpression(postId);
            }, IMPRESSION_DWELL_MS),
          );
        }
      }

      const f = feedsRef.current[which];
      const len = f.postsRef.current.length;
      const nearEnd =
        len > 0 &&
        f.nextCursorRef.current !== null &&
        !f.loadingMoreRef.current &&
        !f.loadingInitialRef.current &&
        maxIndex >= len - PREFETCH_FROM_END;

      if (!nearEnd) {
        return;
      }

      // Never kick off pagination synchronously from this callback — it can trip RN invariant paths.
      setTimeout(() => {
        void feedsRef.current[which].appendFeedPage('prefetch');
      }, 0);
    };
  const forYouViewable = useRef(makeViewabilityHandler('for_you')).current;
  const newOnLivilViewable = useRef(makeViewabilityHandler('new_on_livil')).current;

  // A dwell timer that fires after the screen is gone would record an impression for a
  // card nobody is looking at, and would do it from an unmounted component.
  useEffect(() => {
    const timers = dwellTimersRef.current;
    return () => {
      for (const timer of timers.values()) { clearTimeout(timer); }
      timers.clear();
      flushImpressions();
    };
  }, []);

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

  // Read by the re-count below without making it re-subscribe on every change.
  const pendingIncomingRef = useRef(pendingIncomingCount);
  pendingIncomingRef.current = pendingIncomingCount;

  // Re-fetch the unread counts from the server, then re-write the iOS icon with
  // the result EVEN IF NOTHING CHANGED. The effect above only fires on a change,
  // but a push may have set the icon behind the app's back while it was
  // backgrounded — see resyncAppBadgeCount.
  //
  // `isCancelled` guards the state writes against an unmounted / blurred caller.
  // The icon is only re-written when both reads succeed: a partial total could
  // clear a number that is still correct.
  const refreshUnreadCounts = useCallback(async (isCancelled: () => boolean) => {
    let messages: number | null = null;
    let activity: number | null = null;
    try {
      // Retried: the foreground path fires this the instant iOS resumes the
      // app, when the first request typically fails — and a failed read means
      // the icon is left as it is.
      const convs = await retryOnce(listConversations);
      messages = convs.reduce((sum, c) => sum + c.unreadCount, 0);
      if (!isCancelled()) { setTotalUnread(messages); }
    } catch {
      // ignore
    }
    // livil Bot activity is a separate table — refetch its unread count too.
    try {
      activity = await retryOnce(getActivityUnreadCount);
      if (!isCancelled()) { setActivityUnread(activity); }
    } catch {
      // ignore
    }
    if (isCancelled() || messages === null || activity === null) { return; }
    void resyncAppBadgeCount(messages + pendingIncomingRef.current + activity);
  }, []);

  // Re-count whenever Home regains focus.
  // Covers: user opens Inbox / Activity Center → reads (last_read_at advances,
  // markActivityRead) → returns to Home and expects the badge cleared.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void refreshUnreadCounts(() => cancelled);
      return () => { cancelled = true; };
    }, [refreshUnreadCounts]),
  );

  // Re-count when the app returns to the foreground. Focus does not fire then
  // (Home never lost focus), realtime was paused while backgrounded so the
  // in-app totals may have missed messages, and a push may have changed the
  // icon. Opening the app from a push is exactly this path.
  useEffect(() => {
    let cancelled = false;
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') { void refreshUnreadCounts(() => cancelled); }
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [refreshUnreadCounts]);

  // Re-count when another screen changed the total — a chat that just marked its
  // messages read. Without this, leaving the app straight from that chat left
  // the icon on the count from while it was being read (see requestBadgeRefresh).
  useEffect(() => {
    let cancelled = false;
    const off = onBadgeRefreshRequested(() => { void refreshUnreadCounts(() => cancelled); });
    return () => {
      cancelled = true;
      off();
    };
  }, [refreshUnreadCounts]);

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

    void Promise.all([storiesPromise, forYouLoad('initial')]);

    return () => {
      cancelled = true;
    };
  }, [forYouLoad, setStories]);

  const handleRefresh = useCallback(async () => {
    // Acknowledge the pull the moment it fires — the spinner is at the top
    // of the screen, often under the user's own thumb.
    haptics.select();
    // No pauseAll() here (owner report: refreshing stopped the music). It dates from when
    // each card played its own media and a refresh replaced the cards; playback is one
    // engine now (ADR-0001), independent of the cards, and its queue lives in
    // PlaybackContext — so the song, and next/previous, carry on through a refresh.
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
        feedRef.current.appendFeedPage('refresh'),
        // Pulling New on Livil is what brings the newest uploads in: that clears the dot.
        tabRef.current === 'new_on_livil' ? Promise.resolve(markNewOnLivilSeen()) : refreshNewDot(),
      ]);
      // Fresh counts from the server include every comment change made here.
      clearCommentDeltas();
    } finally {
      setRefreshing(false);
      showTopBar();
    }
  }, [hideTopBar, showTopBar, setStories, refreshNewDot, markNewOnLivilSeen, clearCommentDeltas]);

  const handleEndReached = useCallback((which: HomeFeedTab) => {
    const f = feedsRef.current[which];
    if (!f.loadingInitialRef.current) { void f.appendFeedPage('end'); }
  }, []);

  const forYouRows = useFeedRows(forYou, deletedIds);
  const newOnLivilRows = useFeedRows(newOnLivil, deletedIds);
  const forYouFooter = useFeedFooter(forYou);
  const newOnLivilFooter = useFeedFooter(newOnLivil);

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

  const onTabsLayout = useCallback((y: number) => {
    tabBarYRef.current = y;
    updatePinned(lastScrollYRef.current[tabRef.current]);
  }, [updatePinned]);

  const tabBarHeight = Platform.OS === 'ios' ? 84 : 64 + insets.bottom;
  const contentStyleFor = (rows: FeedListItem[], loading: boolean) => [
    styles.listContent,
    { paddingBottom: tabBarHeight + 56 + FLOATING_PLAYER_HEIGHT + 16 },
    !loading && rows.length === 0 ? styles.listContentFlex : null,
  ];
  const forYouContentStyle = useMemo(
    () => contentStyleFor(forYouRows, forYou.loadingInitial),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [forYouRows, forYou.loadingInitial, tabBarHeight],
  );
  const newOnLivilContentStyle = useMemo(
    () => contentStyleFor(newOnLivilRows, newOnLivil.loadingInitial),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [newOnLivilRows, newOnLivil.loadingInitial, tabBarHeight],
  );

  // One page: a feed's own list, header, footer and refresh. Both are mounted and drawn,
  // stacked (FeedLayer), so switching never re-renders a feed — it fades to it.
  const renderPage = (which: HomeFeedTab) => {
    const f = which === 'for_you' ? forYou : newOnLivil;
    const rows = which === 'for_you' ? forYouRows : newOnLivilRows;
    return (
      <FlatList
        ref={listRefs[which]}
        data={rows}
        onLayout={e => { viewportHRef.current = e.nativeEvent.layout.height; }}
        onContentSizeChange={(_w, h) => {
          contentHRef.current[which] = h;
          if (which === tabRef.current) { recheckPin(); }
        }}
        keyExtractor={feedKeyExtractor}
        renderItem={renderFeedItem}
        ListHeaderComponent={
          <HomeListHeader
            which={which}
            storiesLoading={storiesLoading}
            stories={stories}
            showTabs={newTabAvailable}
            tabsHidden={pinned && which === shownTab}
            activeTab={shownTab}
            onSelectTab={selectTab}
            newDot={newDot}
            onTabsLayout={onTabsLayout}
            loading={f.loadingInitial}
            feedError={f.feedError}
            onRetry={() => { void f.appendFeedPage('initial'); }}
          />
        }
        ListFooterComponent={which === 'for_you' ? forYouFooter : newOnLivilFooter}
        removeClippedSubviews={false}
        ListEmptyComponent={
          f.loadingInitial ? undefined : (
            <View style={styles.emptyFeed}>
              {f.feedError ? (
                <>
                  <Text style={styles.emptyFeedTitle}>Couldn't load the feed</Text>
                  <Text style={styles.emptyFeedBody}>{f.feedError}</Text>
                  <Text style={styles.emptyFeedHint}>Pull to refresh or tap Retry above.</Text>
                </>
              ) : which === 'for_you' ? (
                <>
                  <Text style={styles.emptyFeedTitle}>No posts yet</Text>
                  <Text style={styles.emptyFeedBody}>
                    Follow friends or upload a track — new posts will appear here automatically.
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.emptyFeedTitle}>No uploads yet</Text>
                  <Text style={styles.emptyFeedBody}>Songs uploaded to Livil will show up here.</Text>
                </>
              )}
            </View>
          )
        }
        // The top bar floats over the list, so the list's top TOP_BAR_H is covered.
        // The spinner must start below it, as it does in the inbox (whose header is
        // a normal row above its list): iOS via the content inset, Android via
        // progressViewOffset. Default colours, matching the inbox's spinner.
        {...(Platform.OS === 'ios' ? FEED_INSET_IOS : null)}
        refreshControl={
          <RefreshControl
            refreshing={refreshing && which === shownTab}
            onRefresh={handleRefresh}
            progressViewOffset={TOP_BAR_H}
          />
        }
        onEndReached={() => handleEndReached(which)}
        onEndReachedThreshold={0.35}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={which === 'for_you' ? forYouViewable : newOnLivilViewable}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={which === 'for_you' ? forYouContentStyle : newOnLivilContentStyle}
        onScroll={which === 'for_you' ? onScrollForYou : onScrollNewOnLivil}
        scrollEventThrottle={16}
      />
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* For you and New on Livil, stacked: both stay drawn, a pill tap fades between
          them (FeedLayer). Each keeps its own scroll. */}
      <View style={styles.feedStack}>
        <FeedLayer index={PAGE_INDEX.for_you} progress={pageProgress} active={shownTab === 'for_you'}>
          {renderPage('for_you')}
        </FeedLayer>
        {newTabAvailable ? (
          <FeedLayer index={PAGE_INDEX.new_on_livil} progress={pageProgress} active={shownTab === 'new_on_livil'}>
            {renderPage('new_on_livil')}
          </FeedLayer>
        ) : null}
      </View>

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
            {/* The same "+ Track" as the Profile top bar, at this bar's 38pt height so it
                lines up with the messages button beside it. With Spotify reposts switched
                on it asks what to add (ADR-0027); otherwise it goes straight to Upload. */}
            <Button
              label="Track"
              icon="add"
              variant="primary"
              size="sm"
              style={styles.uploadButton}
              onPress={() => navigation.navigate(spotify.reposts ? 'AddToLivil' : 'Upload')}
              accessibilityLabel={spotify.reposts ? 'Add a track' : 'Upload a track'}
            />
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.inboxButton}
              onPress={() => navigation.navigate('Inbox')}
              accessibilityLabel="Open messages"
            >
              <Icon name="messages" size={20} color={COLORS.white} />
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

      {/* The pinned For you | New on Livil switch: shown once the in-list one has scrolled
          under the top bar, and slid with the top bar so it sits right below it — or at
          the top of the screen while the top bar is hidden. Under the top bar (zIndex) so
          the bar slides over it, never under it. */}
      {pinned && newTabAvailable ? (
        <Animated.View
          style={[
            styles.pinnedTabs,
            { top: insets.top + TOP_BAR_H, transform: [{ translateY: pinnedTabsY }] },
          ]}
        >
          <HomeFeedTabs active={shownTab} onSelect={selectTab} showNewDot={newDot} />
        </Animated.View>
      ) : null}

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
  /** Height only: the pill shape, padding and gradient border are Button's `sm`. */
  uploadButton: { height: 38, paddingVertical: 0 },
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
  storyRingSeen: { borderColor: COLORS.textMuted, shadowColor: 'transparent' },
  storyRingUnseen: { borderColor: COLORS.purple, shadowColor: COLORS.purple },
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
  feedStack: {
    flex: 1,
  },
  // The feed on screen sits above the transparent one, so its pull-to-refresh and scroll
  // indicator are never behind the other's.
  feedLayerActive: {
    zIndex: 1,
  },
  inListTabsHidden: {
    opacity: 0,
  },
  pinnedTabs: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 9,
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
