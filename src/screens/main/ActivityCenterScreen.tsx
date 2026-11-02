import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { supabase } from '../../../lib/supabase';
import { COLORS } from '../../theme/colors';
import ActivityBubble from '../../components/ActivityBubble';
import { LivilBotAvatar } from '../../components/LivilBotAvatar';
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
import { seenMustWait } from '../../utils/seenWhileAway';
import { activityOpenPoint, openOffsetFor, readBoundaryAt } from '../../utils/activitySeen';


type Nav = NativeStackNavigationProp<RootStackParamList>;

/** The gap under the newest notification when the list rests at its start (offset 0). */
const REST_PADDING = 200;
/** Longest the list stays hidden waiting to measure the rows it opens on; then it shows at rest. */
const POSITION_TIMEOUT_MS = 1000;

// Read-only activity feed rendered exactly like a conversation thread, "from"
// the Livil bot. There is intentionally NO input/send bar — view only.
export default function ActivityCenterScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();

  const flatListRef = useRef<FlatList<ActivityItem>>(null);
  // Newest first, as listActivity returns them — drawn in an INVERTED list, so the newest is
  // at the bottom like a chat and "the newest at rest" is offset 0 (ConversationScreen's
  // pattern). The old list was oldest-first and scrollToIndex'ed the last row 100 ms after
  // load; without getItemLayout that index's position was an ESTIMATE from average row
  // heights, so with tall and short cards it opened mid-list (owner, 2026-11-02).
  const [items, setItems] = useState<ActivityItem[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // The read state as it was when this visit opened: the updated_at of the newest notification
  // already read (utils/activitySeen.ts). Captured once, from the first page and BEFORE
  // markActivityRead; a refresh that returns everything read never moves it. Leaving and
  // coming back remounts the screen, so next time "Seen" is under the newest.
  const [readBoundary, setReadBoundary] = useState<string | null>(null);
  // The row this visit opens on: the oldest new notification, or null (nothing new → rest).
  const [openTargetId, setOpenTargetId] = useState<string | null>(null);
  // Rows drawn on the first pass: enough to reach the target, so all of it gets measured.
  const [initialRows, setInitialRows] = useState(12);
  // Hidden until the list sits on the target, so it never flashes at the newest first.
  const [positioned, setPositioned] = useState(false);
  // Credit ids with an answer in flight, so a double tap cannot send two answers.
  const [answering, setAnswering] = useState<Set<string>>(new Set());
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [meId, setMeId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [activityRes, userRes] = await Promise.all([
          listActivity(),
          supabase.auth.getUser(),
        ]);
        if (!cancelled) {
          // The read state as it was when this visit opened — from the first page, BEFORE
          // markActivityRead below (utils/activitySeen.ts).
          const boundary = readBoundaryAt(activityRes);
          const { firstUnseenIndex } = activityOpenPoint(activityRes, boundary);
          setReadBoundary(boundary);
          setOpenTargetId(firstUnseenIndex === null ? null : activityRes[firstUnseenIndex]!.id);
          setInitialRows(Math.max(12, (firstUnseenIndex ?? 0) + 2));
          setPositioned(firstUnseenIndex === null);
          setItems(activityRes);
          setMeId(userRes.data.user?.id ?? null);
        }
      } catch {
        // leave empty
      } finally {
        if (!cancelled) { setLoading(false); }
      }
      // Clear the unread badge once the feed is open — AFTER the read state was captured.
      void markActivityRead();
    })();
    return () => { cancelled = true; };
  }, []);

  // "Seen", like a person's chat: under the newest notification you had already read before
  // this visit — the 4th from the end when 3 are new; under the newest when nothing is.
  const seenId = useMemo(() => {
    const { seenIndex } = activityOpenPoint(items, readBoundary);
    return seenIndex === null ? null : items[seenIndex]!.id;
  }, [items, readBoundary]);

  // ── Opening on the first new notification ────────────────────────────────
  // Its offset is computed from the rows' MEASURED heights (onLayout), the newest down to the
  // target, then applied with scrollToOffset (utils/activitySeen.ts openOffsetFor).
  const rowHeightsRef = useRef(new Map<string, number>());
  const viewportRef = useRef(0);
  const contentHeightRef = useRef<number | undefined>(undefined);
  const positionedRef = useRef(positioned);
  positionedRef.current = positioned;
  const tryPosition = useCallback(() => {
    if (positionedRef.current || !openTargetId) { return; }
    const list = itemsRef.current;
    const target = list.findIndex(it => it.id === openTargetId);
    if (target < 0) { setPositioned(true); return; }
    const heights = list.slice(0, target + 1).map(it => rowHeightsRef.current.get(it.id));
    const offset = openOffsetFor(
      heights,
      target,
      REST_PADDING + insets.bottom,
      viewportRef.current,
      undefined,
      contentHeightRef.current,
    );
    if (offset === null) { return; }
    positionedRef.current = true;
    flatListRef.current?.scrollToOffset({ offset, animated: false });
    // Shown on the next frame, once the scroll has been applied.
    requestAnimationFrame(() => setPositioned(true));
  }, [openTargetId, insets.bottom]);

  const onRowLayout = useCallback((id: string, e: LayoutChangeEvent) => {
    rowHeightsRef.current.set(id, e.nativeEvent.layout.height);
    tryPosition();
  }, [tryPosition]);

  // Never stay hidden: if the rows cannot be measured in time, show the list at rest.
  useEffect(() => {
    if (positioned || loading) { return; }
    const t = setTimeout(() => {
      if (!positionedRef.current) {
        console.log('[activity] open: rows not measured in time — showing the newest');
        positionedRef.current = true;
        setPositioned(true);
      }
    }, POSITION_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [positioned, loading]);

  // Live updates: any insert/update on activity_notifications for this user
  // triggers a refetch (so we pick up the joined display fields the row alone
  // doesn't carry) and a mark-read pass (so notifications seen while the
  // screen is open don't linger in the unread badge).
  //
  // Except while seenMustWait() (Android, backgrounded — the socket stays open there):
  // a like landing with the phone in a pocket is marked on return instead.
  useEffect(() => {
    if (!meId) { return; }
    let cancelled = false;
    let unseenWhileAway = false;
    const refresh = async () => {
      try {
        const fresh = await listActivity();
        if (!cancelled) { setItems(fresh); }
        if (seenMustWait()) {
          unseenWhileAway = true;
        } else {
          unseenWhileAway = false;
          void markActivityRead();
        }
      } catch {
        // silent — next event will retry
      }
    };
    const appStateSub = Platform.OS === 'android'
      ? AppState.addEventListener('change', state => {
        if (state === 'active' && unseenWhileAway) { void refresh(); }
      })
      : null;
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
      appStateSub?.remove();
      void supabase.removeChannel(channel);
    };
  }, [meId]);

  const handleActorPress = useCallback((actorId: string) => {
    if (!actorId) { return; }
    navigation.navigate('UserProfile', { userId: actorId });
  }, [navigation]);

  // Tap a track card → open that post on its own page (PostDetail). A comment
  // opens the comments with the originating comment pulsed; a like opens the
  // likes list; everything else just shows the post.
  // No audio playback, no queue change, no full-screen player — that was the
  // previous behavior and was intentionally removed.
  const handlePostPress = useCallback((item: ActivityItem) => {
    if (!meId) { return; }
    const post = (item as { post?: { postId: string } }).post;
    const postId = post?.postId;
    if (!postId) { return; }
    // The post opens on its own page, not on a profile scrolled to it. The profile route
    // silently showed the wrong post whenever the target was on the other tab or older
    // than the first page — and the post it landed on was often another post of the same
    // song, so it read as the right one with the wrong counts.
    // A comment, a like on yours, a reply to yours: open the post's comments at that one.
    // A tag in a comment opens the comments at it; a tag in a caption, the post.
    if (item.type === 'comment' || item.type === 'comment_like' || item.type === 'comment_reply'
        || (item.type === 'mention' && item.where === 'comment')) {
      navigation.navigate('PostDetail', {
        postId,
        openComments: true,
        ...(item.commentId ? { highlightCommentId: item.commentId } : {}),
      });
      return;
    }
    navigation.navigate('PostDetail', { postId, openLikers: item.type === 'like' });
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
      // items is newest→oldest (the list is inverted), so the chronologically earlier
      // neighbour — the row drawn ABOVE this one — sits at index + 1. Render a time label
      // above the bubble when this row starts a new "group" (oldest item, or >1h gap).
      const prev = items[index + 1] ?? null;
      const showSep = shouldShowTimeSeparator(item.createdAt, prev?.createdAt ?? null);
      return (
        <View onLayout={e => onRowLayout(item.id, e)}>
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
          {item.id === seenId ? <Text style={styles.seenLabel}>Seen</Text> : null}
        </View>
      );
    },
    [handleActorPress, handlePostPress, handleRespondToCredit, answering, items, onRowLayout, seenId],
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
        <LivilBotAvatar size={34} />
        <Text style={styles.headerTitle}>livil Bot</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.purple} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyLogo}>
            <LivilBotAvatar size={64} />
          </View>
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
              style={[styles.flex, !positioned && styles.hidden]}
              data={items}
              keyExtractor={item => item.id}
              renderItem={renderItem}
              inverted
              initialNumToRender={initialRows}
              // Inverted: paddingTop is the gap UNDER the newest notification (its resting
              // spot), paddingBottom the space above the oldest.
              contentContainerStyle={[
                styles.listContent,
                { paddingTop: REST_PADDING + insets.bottom },
              ]}
              onLayout={e => {
                viewportRef.current = e.nativeEvent.layout.height;
                tryPosition();
              }}
              onContentSizeChange={(_w, h) => {
                contentHeightRef.current = h;
                tryPosition();
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
  headerTitle: {
    flex: 1,
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  headerSpacer: { width: 32 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 8 },
  hidden: { opacity: 0 },
  // The chat's read-receipt footer (ConversationScreen readStatus), set under the bot's
  // bubble: past the row's 12 padding, the bot's 28 avatar and the 6 gap.
  seenLabel: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '500',
    marginLeft: 12 + 28 + 6 + 4,
    marginTop: -2,
    marginBottom: 4,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  emptyLogo: { marginBottom: 4 },
  emptyTitle: { color: COLORS.white, fontSize: 18, fontWeight: '700' },
  emptyBody: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
