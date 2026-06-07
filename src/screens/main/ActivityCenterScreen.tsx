import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import ActivityBubble from '../../components/ActivityBubble';
import {
  listActivity,
  markActivityRead,
  type ActivityItem,
} from '../../services/activity';
import { fetchPostById } from '../../services/posts';
import { usePlayback, type NowPlayingInfo } from '../../contexts/PlaybackContext';
import { useToast } from '../../contexts/ToastContext';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LIVIL_LOGO = require('../../assets/livil-logo.png');

type Nav = NativeStackNavigationProp<RootStackParamList>;

// Read-only activity feed rendered exactly like a conversation thread, "from"
// the Livil bot. There is intentionally NO input/send bar — view only.
export default function ActivityCenterScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { showToast } = useToast();
  const { setQueue, setNowPlaying, requestPlay, openFullScreenPlayer } = usePlayback();

  const flatListRef = useRef<FlatList<ActivityItem>>(null);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  // listActivity returns newest-first; render oldest-first so the thread reads
  // top→bottom like a conversation (oldest on top, newest at the bottom).
  const orderedItems = useMemo(() => [...items].reverse(), [items]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await listActivity();
        if (!cancelled) { setItems(data); }
      } catch {
        // leave empty
      } finally {
        if (!cancelled) { setLoading(false); }
      }
      // Clear the unread badge once the feed is open.
      void markActivityRead();
    })();
    return () => { cancelled = true; };
  }, []);

  // On initial load, center the latest (last) notification in the viewport.
  useEffect(() => {
    if (!loading && orderedItems.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({
          index: orderedItems.length - 1,
          animated: false,
          viewPosition: 0.5,
        });
      }, 100);
    }
  }, [loading, orderedItems.length]);

  // Tap a track card → load the post, play it as the current song (single-item
  // queue, not appended), and open the full-screen player to show it.
  const handlePlayPost = useCallback(async (postId: string) => {
    try {
      const post = await fetchPostById(postId);
      if (!post) {
        showToast('That post is no longer available.', { kind: 'error' });
        return;
      }
      const displayAuthor = post.kind === 'repost' && post.originalAuthor
        ? post.originalAuthor
        : post.author;
      const info: NowPlayingInfo = {
        postId: post.id,
        trackId: post.track.id,
        title: post.track.title,
        artistName: displayAuthor.displayName ?? displayAuthor.username,
        authorId: displayAuthor.id,
        authorUsername: displayAuthor.username,
        authorAvatarUrl: displayAuthor.avatarUrl,
        coverArtUrl: post.track.coverArtUrl,
        mediaKind: post.track.mediaKind,
        audioUrl: post.track.audioUrl ?? undefined,
        videoUrl: post.track.videoUrl ?? undefined,
        likesCount: post.likesCount,
        commentsCount: post.commentsCount,
        repostsCount: post.repostsCount,
        viewsCount: post.viewsCount,
        viewerHasLiked: post.viewerHasLiked,
        clipStartSec: post.clipStartSec,
        clipEndSec: post.clipEndSec,
        kind: post.kind,
        originalPostId: post.originalPostId,
        knownDurationSec: 0,
      };
      setQueue([info], 0, `activity:${post.id}`);
      setNowPlaying(info);
      requestPlay(post.id);
      openFullScreenPlayer();
    } catch {
      showToast('Could not play this track.', { kind: 'error' });
    }
  }, [setQueue, setNowPlaying, requestPlay, openFullScreenPlayer, showToast]);

  const renderItem = useCallback(
    ({ item }: { item: ActivityItem }) => (
      <ActivityBubble item={item} onPlayPost={handlePlayPost} />
    ),
    [handlePlayPost],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          activeOpacity={0.7}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Image source={LIVIL_LOGO} style={styles.headerAvatar} />
        <Text style={styles.headerTitle}>livil Bot</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.purple} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Image source={LIVIL_LOGO} style={styles.emptyLogo} />
          <Text style={styles.emptyTitle}>No activity yet</Text>
          <Text style={styles.emptyBody}>
            Likes, comments, reposts and milestones on your tracks show up here.
          </Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          style={styles.flex}
          data={orderedItems}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          // paddingBottom = half the screen so the user can scroll the latest
          // message all the way to the top. On mount we scrollToIndex with
          // viewPosition: 0.5 so it lands centered.
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: windowHeight * 0.5 + insets.bottom },
          ]}
          onScrollToIndexFailed={() => {
            setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  backButton: { padding: 4 },
  backIcon: { color: COLORS.purple, fontSize: 28, lineHeight: 32 },
  headerAvatar: { width: 34, height: 34, borderRadius: 17 },
  headerTitle: {
    flex: 1,
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  headerSpacer: { width: 32 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingTop: 8 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  emptyLogo: { width: 64, height: 64, borderRadius: 32, marginBottom: 4 },
  emptyTitle: { color: COLORS.white, fontSize: 18, fontWeight: '700' },
  emptyBody: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
