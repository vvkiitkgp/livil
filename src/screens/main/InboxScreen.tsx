import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import { supabase } from '../../../lib/supabase';
import {
  listConversations,
  type ConversationSummary,
} from '../../services/conversations';
import { messageCache } from '../../services/messageCache';
import { useRelationships } from '../../contexts/RelationshipContext';
import { FriendRequestsBanner, ActivityBanner } from '../../components/InboxBanner';
import AddBadge from '../../components/AddBadge';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function formatTime(iso: string | null): string {
  if (!iso) { return ''; }
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) { return 'now'; }
  if (diffMins < 60) { return `${diffMins}m`; }
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) { return `${diffHours}h`; }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) { return `${diffDays}d`; }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function initials(name: string | null, username: string | null): string {
  const n = name?.trim() || username || '?';
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) { return parts[0]!.slice(0, 2).toUpperCase(); }
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

function ConversationRow({
  item,
  onPress,
}: {
  item: ConversationSummary;
  onPress: () => void;
}) {
  const isDm = item.kind === 'dm';
  const displayName = isDm
    ? (item.otherUserName || item.otherUserUsername || 'Unknown')
    : (item.name || 'Group');
  const avatarUrl = isDm ? item.otherUserAvatar : item.avatarUrl;
  const online = isDm && item.otherUserOnline;

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      style={styles.row}
      onPress={onPress}
    >
      <View style={styles.avatarWrap}>
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarText}>
              {initials(item.otherUserName, item.otherUserUsername)}
            </Text>
          </View>
        )}
        {online && <View style={styles.onlineDot} />}
      </View>

      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.nameText} numberOfLines={1}>
            {displayName}
          </Text>
          {isDm && item.otherUserId ? <AddBadge userId={item.otherUserId} size="sm" /> : null}
          <Text style={styles.timeText}>{formatTime(item.lastMessageAt)}</Text>
        </View>
        <Text
          style={[styles.previewText, item.unreadCount > 0 && styles.previewUnread]}
          numberOfLines={1}
        >
          {item.lastMessagePreview ?? 'No messages yet'}
        </Text>
      </View>

      {item.unreadCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {item.unreadCount > 99 ? '99+' : item.unreadCount}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function InboxScreen() {
  const navigation = useNavigation<Nav>();
  const rel = useRelationships();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [bannerKey, setBannerKey] = useState(0);
  const [myId, setMyId] = useState<string | null>(null);
  // The realtime handler needs to know the current user id to filter out our
  // own outgoing messages without re-creating the channel on every render.
  const myIdRef = useRef<string | null>(null);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      const id = data?.user?.id ?? null;
      setMyId(id);
      myIdRef.current = id;
    });
  }, []);

  // Network-only refresh — no cache read. Used by the realtime listener so
  // a new-message event doesn't get muddied by a momentary stale-cache paint.
  const refreshFromNetwork = useCallback(async () => {
    try {
      const data = await listConversations();
      setConversations(data);
      void messageCache.setInbox(data);
    } catch {
      // Network failed — leave whatever is showing. The next event or
      // focus will retry; no value in surfacing transient blips here.
    }
  }, []);

  const load = useCallback(async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }

    // ── Stale-while-revalidate ─────────────────────────────────────────────
    // Kick off network fetch immediately so it runs in parallel with the
    // (much faster) cache read below.
    const networkPromise = listConversations();

    // Show cached data right away on first load — no spinner needed.
    if (!showRefresh) {
      const cached = await messageCache.getInbox();
      if (cached && cached.length > 0) {
        setConversations(cached);
        setLoading(false);
      }
    }

    // Wait for fresh data and update.
    try {
      const data = await networkPromise;
      setConversations(data);
      void messageCache.setInbox(data); // write-through, fire-and-forget
    } catch {
      // Network failed — leave whatever is showing (cached or empty)
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
    void rel.refresh();
    setBannerKey(k => k + 1);
  }, [load, rel]));

  // Live inbox: a single channel listens to two tables so the unread badge,
  // preview text, last_message_at ordering, and "Seen by me" propagation all
  // stay current without the user touching the screen.
  //
  //   1. messages INSERT → a new incoming message bumps unread / updates the
  //      row. Own outbound messages are filtered out client-side (they're
  //      handled by ConversationScreen's optimistic insert).
  //   2. conversation_members UPDATE on MY row → my last_read_at advanced
  //      (typically because I opened the conversation on another tab/device
  //      OR returned from ConversationScreen). The unread badge should drop
  //      to 0 immediately.
  //
  // Realtime refresh goes straight to network — bypassing the cache — so the
  // badge swap doesn't get briefly painted with stale data. RLS limits
  // delivery to conversations the user is a member of, so no server-side
  // filter is needed on the messages stream.
  useEffect(() => {
    if (!myId) { return; }
    console.log('[realtime] inbox subscribing', { myId });
    const channel = supabase
      .channel(`inbox:${myId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload: { new: { sender_id?: string | null; kind?: string; deleted_at?: string | null; conversation_id?: string } }) => {
          const row = payload.new;
          if (!row || row.deleted_at) { return; }
          if (row.kind === 'system') { return; }
          if (row.sender_id && row.sender_id === myIdRef.current) { return; }
          console.log('[realtime] inbox got messages INSERT', { conv: row.conversation_id, sender: row.sender_id });
          void refreshFromNetwork();
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversation_members', filter: `user_id=eq.${myId}` },
        () => {
          // My own last_read_at moved → unread badge for that row should
          // drop. Refetch picks up the new server-computed unread count.
          console.log('[realtime] inbox got own conversation_members UPDATE');
          void refreshFromNetwork();
        },
      )
      .subscribe(status => {
        console.log('[realtime] inbox status', status);
      });
    return () => {
      console.log('[realtime] inbox unsubscribing');
      void supabase.removeChannel(channel);
    };
  }, [myId, refreshFromNetwork]);

  const openConversation = useCallback((item: ConversationSummary) => {
    const isDm = item.kind === 'dm';
    const title = isDm
      ? (item.otherUserName || item.otherUserUsername || 'Chat')
      : (item.name || 'Group');
    navigation.navigate('Conversation', { conversationId: item.id, title, kind: item.kind });
  }, [navigation]);

  const renderItem = useCallback(
    ({ item }: { item: ConversationSummary }) => (
      <ConversationRow item={item} onPress={() => openConversation(item)} />
    ),
    [openConversation],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          activeOpacity={0.7}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Messages</Text>
        <TouchableOpacity
          style={styles.composeButton}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('NewConversation')}
          accessibilityLabel="New message"
        >
          <Text style={styles.composeIcon}>＋</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.purple} />
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          refreshing={refreshing}
          onRefresh={() => {
            setBannerKey(k => k + 1);
            void load(true);
          }}
          ListHeaderComponent={
            <>
              <FriendRequestsBanner refreshKey={bannerKey} />
              <ActivityBanner refreshKey={bannerKey} />
            </>
          }
          contentContainerStyle={
            conversations.length === 0 ? styles.emptyContent : styles.listContent
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptyBody}>
                Start a conversation with a friend.
              </Text>
              <TouchableOpacity
                style={styles.emptyButton}
                activeOpacity={0.8}
                onPress={() => navigation.navigate('NewConversation')}
              >
                <Text style={styles.emptyButtonText}>New Message</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  backButton: { padding: 4, marginRight: 4 },
  backIcon: { color: COLORS.purple, fontSize: 28, lineHeight: 32 },
  headerTitle: {
    flex: 1,
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  composeButton: { padding: 4 },
  composeIcon: { color: COLORS.purple, fontSize: 22, fontWeight: '300' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 24 },
  emptyContent: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  avatarWrap: { position: 'relative' },
  avatar: { width: 52, height: 52, borderRadius: 26 },
  avatarPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1,
    borderColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: COLORS.purpleLight, fontSize: 16, fontWeight: '700' },
  onlineDot: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#22C55E',
    borderWidth: 2,
    borderColor: COLORS.bg,
  },
  rowBody: { flex: 1, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameText: {
    flex: 1,
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '600',
  },
  timeText: { color: COLORS.textSecondary, fontSize: 12 },
  previewText: { color: COLORS.textSecondary, fontSize: 13 },
  previewUnread: { color: COLORS.white, fontWeight: '600' },
  badge: {
    backgroundColor: COLORS.purple,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: COLORS.white, fontSize: 11, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  emptyTitle: { color: COLORS.white, fontSize: 18, fontWeight: '700' },
  emptyBody: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center' },
  emptyButton: {
    marginTop: 8,
    backgroundColor: COLORS.purple,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  emptyButtonText: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
});
