import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Image,
  ScrollView,
  type ViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CompositeNavigationProp } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../../lib/supabase';
import { COLORS } from '../../theme/colors';
import type { AppTabParamList, RootStackParamList } from '../../navigation/types';
import PostCard from '../../components/PostCard';
import { usePlayback } from '../../contexts/PlaybackContext';
import {
  fetchHomeFeedPage,
  type FeedPost,
  type HomeFeedCursor,
} from '../../services/posts';
import { listActiveStories, type Story } from '../../services/stories';
import { useStories } from '../../contexts/StoriesContext';
import { listConversations } from '../../services/conversations';

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

function visiblePostIdSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const id of b) {
    if (!a.has(id)) {
      return false;
    }
  }
  return true;
}

function avatarInitials(profile: ProfileSnippet | null): string {
  if (!profile) {
    return '?';
  }
  const name = profile.displayName?.trim() || profile.username;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

function storyInitials(story: Story): string {
  const name = story.author.displayName?.trim() || story.author.username;
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
  const storyIds = useMemo(() => stories.map(s => s.id), [stories]);

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
        {stories.map((item, i) => {
          const seen = item.viewedAt !== null;
          return (
            <Pressable
              key={item.id}
              style={styles.storyCell}
              onPress={() => navigation.navigate('StoryViewer', { storyIds, startIndex: i })}
            >
              <View style={[
                styles.storyRing,
                seen
                  ? { borderColor: COLORS.textMuted, shadowColor: 'transparent' }
                  : { borderColor: COLORS.purple, shadowColor: COLORS.purple },
              ]}>
                <View style={styles.storyAvatar}>
                  {item.author.avatarUrl ? (
                    <Image source={{ uri: item.author.avatarUrl }} style={styles.storyAvatarImg} />
                  ) : (
                    <Text style={styles.storyAvatarText}>{storyInitials(item)}</Text>
                  )}
                </View>
              </View>
              <Text style={styles.storyUsername} numberOfLines={1}>
                @{item.author.username}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function PostCardSkeleton() {
  return (
    <View style={styles.skelCard}>
      <View style={styles.skelHeader}>
        <View style={styles.skelAvatar} />
        <View style={styles.skelHeaderText}>
          <View style={[styles.skelLine, { width: '46%' }]} />
          <View style={[styles.skelLine, { width: '30%', marginTop: 8 }]} />
        </View>
      </View>
      <View style={styles.skelMedia} />
      <View style={styles.skelActions}>
        <View style={[styles.skelPill, { width: 52 }]} />
        <View style={[styles.skelPill, { width: 52 }]} />
        <View style={[styles.skelPill, { width: 52 }]} />
      </View>
      <View style={[styles.skelLine, { width: '72%', marginTop: 14 }]} />
      <View style={[styles.skelLine, { width: '54%', marginTop: 10 }]} />
    </View>
  );
}

export default function HomeScreen() {
  const navigation = useNavigation<HomeNavigation>();
  const playback = usePlayback();
  const { stories, setStories } = useStories();

  const [meProfile, setMeProfile] = useState<ProfileSnippet | null>(null);
  const [totalUnread, setTotalUnread] = useState(0);

  const [storiesLoading, setStoriesLoading] = useState(true);

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [feedError, setFeedError] = useState('');

  const nextCursorRef = useRef<HomeFeedCursor | null>(null);
  const loadingMoreRef = useRef(false);
  const loadingInitialRef = useRef(true);

  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
    minimumViewTime: 120,
  }).current;

  const postsRef = useRef<FeedPost[]>([]);
  postsRef.current = posts;

  // When a track starts playing on the home feed, set the queue to that track
  // plus all posts below it — so next/prev only navigate forward in the feed.
  useEffect(() => {
    if (!playback.activePostId) { return; }
    const startIdx = postsRef.current.findIndex(p => p.id === playback.activePostId);
    const slice = startIdx >= 0 ? postsRef.current.slice(startIdx) : postsRef.current;
    playback.setQueue(
      slice.map(p => {
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
          videoUrl: p.track.videoUrl ?? undefined,
          likesCount: p.likesCount,
          commentsCount: p.commentsCount,
          repostsCount: p.repostsCount,
          viewsCount: p.viewsCount,
          viewerHasLiked: p.viewerHasLiked,
          clipStartSec: p.clipStartSec,
          clipEndSec: p.clipEndSec,
        };
      }),
    );
  // postsRef.current is always up-to-date; only re-run when activePostId changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback.activePostId, playback.setQueue]);

  const appendFeedPageRef = useRef<(mode: 'initial' | 'refresh' | 'prefetch' | 'end') => Promise<void>>(
    async () => {},
  );

  const handleViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const ids = new Set<string>();
      let maxIndex = 0;
      for (const v of viewableItems) {
        if (typeof v.index === 'number') {
          maxIndex = Math.max(maxIndex, v.index);
        }
        const row = v.item as FeedListItem | undefined;
        if (row?.kind === 'post' && v.isViewable) {
          ids.add(row.post.id);
        }
      }
      setVisibleIds(prev => (visiblePostIdSetsEqual(prev, ids) ? prev : ids));

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
  // user navigates to another screen (e.g. UserProfile). PostCard's `visible`
  // prop already stops inline video when cards leave the viewport.

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData?.user?.id;
        if (!uid) {
          return;
        }
        const { data, error } = await supabase
          .from('profiles')
          .select('username, display_name, avatar_url')
          .eq('id', uid)
          .maybeSingle();
        if (cancelled || error) {
          return;
        }
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

      try {
        const convs = await listConversations();
        if (!cancelled) {
          setTotalUnread(convs.reduce((sum, c) => sum + c.unreadCount, 0));
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
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
    const showSpinner = mode === 'end';
    if (showSpinner) {
      setLoadingMore(true);
    }
    if (mode === 'initial') {
      setLoadingInitial(true);
      setFeedError('');
      nextCursorRef.current = null;
      setPosts([]);
    }
    if (mode === 'refresh') {
      setFeedError('');
      nextCursorRef.current = null;
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

      setPosts(prev => {
        if (mode === 'initial' || mode === 'refresh') {
          return chunk;
        }
        const seen = new Set(prev.map(p => p.id));
        const merged = chunk.filter(p => !seen.has(p.id));
        return [...prev, ...merged];
      });

      nextCursorRef.current = nextCursor;
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
  }, [appendFeedPage]);

  const handleRefresh = useCallback(async () => {
    playback.pauseAll();
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
    }
  }, [appendFeedPage, playback]);

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
    return posts.map(post => ({ kind: 'post' as const, post }));
  }, [loadingInitial, posts]);

  const renderFeedItem = useCallback(
    ({ item }: { item: FeedListItem }) => {
      if (item.kind === 'skeleton') {
        return <PostCardSkeleton />;
      }
      return <PostCard post={item.post} visible={visibleIds.has(item.post.id)} pauseWhenOffScreen={false} />;
    },
    [visibleIds],
  );

  const feedKeyExtractor = useCallback((item: FeedListItem) => {
    return item.kind === 'post' ? item.post.id : item.id;
  }, []);

  const listHeader = useMemo(
    () => (
      <>
        <View style={styles.topBar}>
          <View style={styles.brandRow}>
            <View style={styles.logoMark}>
              <Text style={styles.logoMarkText}>L</Text>
            </View>
            <Text style={styles.wordmark}>livil</Text>
          </View>
          <View style={styles.topBarActions}>
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.uploadButton}
              onPress={() => navigation.navigate('Upload')}
              accessibilityLabel="Upload music"
            >
              <Text style={styles.uploadButtonText}>+</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.inboxButton}
              onPress={() => navigation.navigate('Inbox')}
              accessibilityLabel="Open messages"
            >
              <Text style={styles.inboxIcon}>💬</Text>
              {totalUnread > 0 && (
                <View style={styles.inboxBadge}>
                  <Text style={styles.inboxBadgeText}>
                    {totalUnread > 99 ? '99+' : totalUnread}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

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
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.retryButton}
              onPress={() => void appendFeedPage('initial')}
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </>
    ),
    [navigation, meProfile, storiesLoading, stories, feedError, loadingInitial, appendFeedPage],
  );

  const footer = useMemo(() => {
    if (!loadingMore || posts.length === 0 || loadingInitial) {
      return <View style={styles.footerSpace} />;
    }
    return (
      <View style={styles.footerSpinner}>
        <ActivityIndicator color={COLORS.purpleLight} />
      </View>
    );
  }, [loadingMore, posts.length, loadingInitial]);

  const listContentStyle = useMemo(
    () => [
      styles.listContent,
      !loadingInitial && feedRows.length === 0 ? styles.listContentFlex : null,
    ],
    [feedRows.length, loadingInitial],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
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
    paddingBottom: 32,
  },
  listContentFlex: {
    flexGrow: 1,
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
    backgroundColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
  uploadButtonText: {
    color: COLORS.white,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 26,
    marginTop: -2,
  },
  logoMark: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
  logoMarkText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '800',
  },
  wordmark: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
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
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: COLORS.purple,
  },
  retryButtonText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '800',
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
  footerSpinner: {
    paddingVertical: 18,
    alignItems: 'center',
  },

  skelCard: {
    marginHorizontal: 16,
    marginBottom: 18,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  skelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  skelAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.border,
  },
  skelHeaderText: {
    flex: 1,
    gap: 8,
  },
  skelLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.border,
  },
  skelMedia: {
    height: 220,
    borderRadius: 14,
    backgroundColor: COLORS.border,
  },
  skelActions: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 14,
  },
  skelPill: {
    height: 30,
    borderRadius: 10,
    backgroundColor: COLORS.border,
  },
});
