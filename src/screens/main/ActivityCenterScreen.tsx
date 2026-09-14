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
import { supabase } from '../../../lib/supabase';
import { COLORS } from '../../theme/colors';
import ActivityBubble from '../../components/ActivityBubble';
import ChatTimeSeparator from '../../components/ChatTimeSeparator';
import SwipeRevealRow from '../../components/SwipeRevealRow';
import { SwipeRevealProvider, SwipeRevealGestureView } from '../../contexts/SwipeRevealContext';
import { formatChatTimestamp, shouldShowTimeSeparator } from '../../utils/chatTime';
import {
  listActivity,
  markActivityRead,
  type ActivityItem,
} from '../../services/activity';
import { Icon } from '../../components/Icon';
import { respondToCredit } from '../../services/tracks';
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

  const flatListRef = useRef<FlatList<ActivityItem>>(null);
  // Tracks whether we've performed the initial center-on-latest scroll. Without
  // this guard, the same effect would re-fire on every realtime arrival (since
  // it depends on orderedItems.length) and yank the user to the bottom while
  // they're reading older notifications.
  const didInitialScrollRef = useRef(false);
  const [items, setItems] = useState<ActivityItem[]>([]);
  // Credit ids with an answer in flight, so a double tap cannot send two answers.
  const [answering, setAnswering] = useState<Set<string>>(new Set());
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [meId, setMeId] = useState<string | null>(null);

  // listActivity returns newest-first; render oldest-first so the thread reads
  // top→bottom like a conversation (oldest on top, newest at the bottom).
  const orderedItems = useMemo(() => [...items].reverse(), [items]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [activityRes, userRes] = await Promise.all([
          listActivity(),
          supabase.auth.getUser(),
        ]);
        if (!cancelled) {
          setItems(activityRes);
          setMeId(userRes.data.user?.id ?? null);
        }
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
  // Guarded so realtime arrivals (which also bump orderedItems.length) don't
  // re-trigger the scroll and yank the user off whatever they're reading.
  useEffect(() => {
    if (didInitialScrollRef.current) { return; }
    if (loading || orderedItems.length === 0) { return; }
    didInitialScrollRef.current = true;
    setTimeout(() => {
      flatListRef.current?.scrollToIndex({
        index: orderedItems.length - 1,
        animated: false,
        viewPosition: 0.5,
      });
    }, 100);
  }, [loading, orderedItems.length]);

  // Live updates: any insert/update on activity_notifications for this user
  // triggers a refetch (so we pick up the joined display fields the row alone
  // doesn't carry) and a mark-read pass (so notifications seen while the
  // screen is open don't linger in the unread badge).
  useEffect(() => {
    if (!meId) { return; }
    let cancelled = false;
    const refresh = async () => {
      try {
        const fresh = await listActivity();
        if (!cancelled) { setItems(fresh); }
        void markActivityRead();
      } catch {
        // silent — next event will retry
      }
    };
    const channel = supabase
      .channel(`activity:${meId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'activity_notifications',
          filter: `recipient_id=eq.${meId}`,
        },
        () => { void refresh(); },
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [meId]);

  const handleActorPress = useCallback((actorId: string) => {
    if (!actorId) { return; }
    navigation.navigate('UserProfile', { userId: actorId });
  }, [navigation]);

  // Tap a track card → deep-link to the owner's profile scrolled to that post.
  // For like/repost/milestone the recipient (me) owns the post, so the
  // notification is routed to my own profile. For comments we additionally
  // request the CommentsSheet to open and pulse the originating comment.
  // No audio playback, no queue change, no full-screen player — that was the
  // previous behavior and was intentionally removed.
  const handlePostPress = useCallback((item: ActivityItem) => {
    if (!meId) { return; }
    const post = (item as { post?: { postId: string } }).post;
    const postId = post?.postId;
    if (!postId) { return; }
    if (item.type === 'comment') {
      navigation.navigate('UserProfile', {
        userId: meId,
        focusPostId: postId,
        openComments: true,
        ...(item.commentId ? { highlightCommentId: item.commentId } : {}),
      });
      return;
    }
    // WHOSE profile the post lives on. Every other notification is about something that
    // happened TO my post, so my profile is right — but a credit is about somebody ELSE's
    // upload, and routing that to me opened my profile hunting for a post that was never
    // there. The uploader is the actor on a 'credited' row.
    const ownerId = item.type === 'credited' ? item.actor.id || meId : meId;
    navigation.navigate('UserProfile', { userId: ownerId, focusPostId: postId });
  }, [navigation, meId]);

  /**
   * Answer a credit from the message that asked.
   *
   * The row is updated locally rather than refetched: the answer is recorded on the
   * notification server-side, so a refetch would return the same thing one round trip
   * later, and the buttons should stop being tappable the instant they are pressed.
   */
  const handleRespondToCredit = useCallback(
    async (creditId: string, accept: boolean) => {
      if (answering.has(creditId)) { return; }
      setAnswering(prev => new Set(prev).add(creditId));
      try {
        const status = await respondToCredit(creditId, accept);
        if (status === null) {
          // Not yours, already answered, or gone — indistinguishable by design. Re-reading
          // is the honest response: whatever the truth is, the server has it.
          setItems(await listActivity());
          return;
        }
        setItems(prev =>
          prev.map(it =>
            it.type === 'credited' && it.creditId === creditId
              ? { ...it, answered: status }
              : it,
          ),
        );
        showToast(accept ? 'Credit confirmed' : 'Credit declined', { kind: 'success' });
      } catch {
        showToast("Couldn't save that. Try again.", { kind: 'error' });
      } finally {
        setAnswering(prev => {
          const next = new Set(prev);
          next.delete(creditId);
          return next;
        });
      }
    },
    [answering, showToast],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: ActivityItem; index: number }) => {
      // orderedItems is oldest→newest, so the chronologically earlier
      // neighbour sits at index - 1. Render a time label above the bubble
      // when this row starts a new "group" (first item, or >1h gap).
      const prev = index > 0 ? orderedItems[index - 1] : null;
      const showSep = shouldShowTimeSeparator(item.createdAt, prev?.createdAt ?? null);
      return (
        <>
          {showSep ? <ChatTimeSeparator label={formatChatTimestamp(item.createdAt)} /> : null}
          <SwipeRevealRow timestamp={formatChatTimestamp(item.createdAt)}>
            <ActivityBubble
              item={item}
              onActorPress={handleActorPress}
              onPostPress={handlePostPress}
              onRespondToCredit={handleRespondToCredit}
              responding={item.type === 'credited' && item.creditId
                ? answering.has(item.creditId)
                : false}
            />
          </SwipeRevealRow>
        </>
      );
    },
    [handleActorPress, handlePostPress, handleRespondToCredit, answering, orderedItems],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          activeOpacity={0.7}
          onPress={() => navigation.goBack()}
        >
          <Icon name="back" size={28} color={COLORS.purple} />
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
            Likes, comments, reposts and milestones on your posts show up here.
          </Text>
        </View>
      ) : (
        <SwipeRevealProvider>
          <SwipeRevealGestureView>
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
          </SwipeRevealGestureView>
        </SwipeRevealProvider>
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
