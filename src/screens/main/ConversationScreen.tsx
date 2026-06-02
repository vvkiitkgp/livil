import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Image,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ActivityIndicator,
  Pressable,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import FormInput from '../../components/FormInput';
import {
  fetchMessages,
  sendMessage,
  addReaction,
  removeReaction,
  type ChatMessage,
  type SendMessagePayload,
} from '../../services/messages';
import { messageCache } from '../../services/messageCache';
import {
  markAsRead,
  getFriendActivity,
  type FriendActivity,
  type ConversationSummary,
} from '../../services/conversations';
import {
  subscribeToConversation,
  unsubscribeFromConversation,
} from '../../services/jamRealtime';
import { createJamRoom, bulkAddToQueue } from '../../services/jamRooms';
import { usePlayback } from '../../contexts/PlaybackContext';
import { useJam } from '../../contexts/JamContext';
import { supabase } from '../../../lib/supabase';
import AddBadge from '../../components/AddBadge';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'Conversation'>;

const QUICK_REACTIONS = ['❤️', '😂', '🔥', '😮', '😢', '👏'];
const MAX_CHARS = 500;

const MORE_EMOJIS = [
  '😀','😃','😄','😁','😆','😅','🤣','😊','😇','🥰',
  '😍','🤩','😘','😗','😙','😚','🙂','🤗','🤭','🫡',
  '🤔','🫠','🤐','🤨','😐','😑','😶','😏','😒','🙄',
  '😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕',
  '🥳','🤯','😤','😠','😡','🤬','😈','👿','💀','💩',
  '👋','🤚','🖐','✋','🤙','👍','👎','✊','🤜','👏',
  '🙌','🤲','🙏','💪','🫶','❤️','🧡','💛','💚','💙',
  '💜','🖤','🤍','💔','❤️‍🔥','✨','💫','⭐','🌟','🎉',
  '🎊','🎶','🎵','🔥','💯','✅','❌','⚡','💥','🌈',
];


function JamInviteBubble({
  msg,
  conversationId,
  title,
}: {
  msg: ChatMessage;
  conversationId: string;
  title: string;
}) {
  const navigation = useNavigation<Nav>();
  const { setActiveJam } = useJam();
  const jamRoomId = msg.metadata?.jam_room_id as string | undefined;
  if (!jamRoomId) { return null; }
  const handleJoin = () => {
    // Mark this jam active before navigating so the global JamRealtimeProvider
    // can subscribe + start receiving the host's playback even before
    // JamRoomScreen mounts.
    setActiveJam({ jamRoomId, conversationId, conversationTitle: title });
    navigation.navigate('JamRoom', { jamRoomId, conversationId });
  };
  return (
    <View style={styles.jamInviteCard}>
      <Text style={styles.jamInviteIcon}>🎵</Text>
      <View style={styles.jamInviteInfo}>
        <Text style={styles.jamInviteTitle}>Jam Room started</Text>
        <Text style={styles.jamInviteSub}>Tap to join the listening session</Text>
      </View>
      <TouchableOpacity
        style={styles.jamInviteBtn}
        activeOpacity={0.8}
        onPress={handleJoin}
      >
        <Text style={styles.jamInviteBtnText}>Join</Text>
      </TouchableOpacity>
    </View>
  );
}

function MessageBubble({
  msg,
  isMe,
  conversationId,
  conversationTitle,
  onLongPress,
  onReactionToggle,
}: {
  msg: ChatMessage;
  isMe: boolean;
  conversationId: string;
  conversationTitle: string;
  onLongPress: (msg: ChatMessage) => void;
  onReactionToggle: (msg: ChatMessage, emoji: string) => void;
}) {
  const hasStickerMeta = msg.kind === 'sticker' && !!msg.metadata?.sticker_url;
  const hasTrackMeta = msg.kind === 'track_share' && !!msg.metadata;
  const isJamInvite = msg.kind === 'jam_invite' && !!msg.metadata?.jam_room_id;

  if (isJamInvite) {
    return (
      <View style={[styles.bubbleRow, isMe && styles.bubbleRowMe]}>
        <JamInviteBubble msg={msg} conversationId={conversationId} title={conversationTitle} />
      </View>
    );
  }
  const hasReactions = msg.reactions.length > 0;

  return (
    <View style={[styles.bubbleRow, isMe && styles.bubbleRowMe]}>
      {!isMe && (
        <View style={styles.senderAvatarWrap}>
          {msg.senderAvatarUrl ? (
            <Image source={{ uri: msg.senderAvatarUrl }} style={styles.senderAvatar} />
          ) : (
            <View style={styles.senderAvatarPlaceholder}>
              <Text style={styles.senderAvatarText}>
                {(msg.senderDisplayName || msg.senderUsername || '?').slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
        </View>
      )}

      <View style={[styles.bubbleColumn, isMe && styles.bubbleColumnMe]}>
        {!isMe && (
          <View style={styles.senderNameRow}>
            <Text style={styles.senderName}>
              {msg.senderDisplayName || msg.senderUsername}
            </Text>
            {msg.senderId ? <AddBadge userId={msg.senderId} size="sm" /> : null}
          </View>
        )}

        {/* Wrapper gives us the anchor point for the absolutely-positioned reaction strip */}
        <View style={[styles.bubbleWrapper, hasReactions && styles.bubbleWrapperWithReactions]}>
          <Pressable
            onLongPress={() => onLongPress(msg)}
            style={[
              styles.bubble,
              isMe ? styles.bubbleMe : styles.bubbleThem,
              hasStickerMeta ? styles.bubbleSticker : null,
            ]}
          >
            {msg.kind === 'text' && (
              <Text style={[styles.bubbleText, isMe ? styles.bubbleTextMe : null]}>
                {msg.body}
              </Text>
            )}

            {hasStickerMeta && (
              <Image
                source={{ uri: msg.metadata!.sticker_url as string }}
                style={styles.stickerImg}
                resizeMode="contain"
              />
            )}

            {hasTrackMeta && (
              <View style={styles.trackCard}>
                {msg.metadata!.cover_art_url ? (
                  <Image
                    source={{ uri: msg.metadata!.cover_art_url as string }}
                    style={styles.trackCardArt}
                  />
                ) : (
                  <View style={styles.trackCardArtPlaceholder}>
                    <Text style={styles.trackCardNote}>🎵</Text>
                  </View>
                )}
                <View style={styles.trackCardInfo}>
                  <Text style={styles.trackCardTitle} numberOfLines={1}>
                    {msg.metadata!.title as string}
                  </Text>
                  <Text style={styles.trackCardArtist} numberOfLines={1}>
                    {msg.metadata!.artist_name as string}
                  </Text>
                </View>
              </View>
            )}
          </Pressable>

          {hasReactions && (
            <View style={[styles.reactionOverlay, isMe ? styles.reactionOverlayMe : styles.reactionOverlayThem]}>
              {msg.reactions.map(r => (
                <TouchableOpacity
                  key={r.emoji}
                  style={[styles.reactionChip, r.reactedByMe && styles.reactionChipActive]}
                  activeOpacity={0.7}
                  onPress={() => onReactionToggle(msg, r.emoji)}
                >
                  <Text style={styles.reactionEmoji}>{r.emoji}</Text>
                  {r.count > 1 && <Text style={styles.reactionCount}>{r.count}</Text>}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

function ReactionPicker({
  visible,
  onPick,
  onClose,
}: {
  visible: boolean;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!visible) { return null; }

  return (
    <Pressable style={styles.reactionPickerOverlay} onPress={onClose}>
      <View style={styles.reactionPickerCard}>
        {/* Quick row */}
        <View style={styles.reactionPickerRow}>
          {QUICK_REACTIONS.map(emoji => (
            <TouchableOpacity
              key={emoji}
              style={styles.reactionPickerBtn}
              activeOpacity={0.7}
              onPress={() => onPick(emoji)}
            >
              <Text style={styles.reactionPickerEmoji}>{emoji}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.reactionPickerBtn, styles.reactionPickerMoreBtn, expanded && styles.reactionPickerMoreBtnActive]}
            activeOpacity={0.7}
            onPress={() => setExpanded(e => !e)}
          >
            <Text style={styles.reactionPickerMoreIcon}>+</Text>
          </TouchableOpacity>
        </View>

        {/* Expanded emoji grid */}
        {expanded && (
          <View style={styles.emojiGrid}>
            {MORE_EMOJIS.map((emoji, i) => (
              <TouchableOpacity
                key={`${emoji}-${i}`}
                style={styles.emojiGridBtn}
                activeOpacity={0.7}
                onPress={() => onPick(emoji)}
              >
                <Text style={styles.emojiGridEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </Pressable>
  );
}

export default function ConversationScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { conversationId, title, kind } = route.params;
  const isGroup = kind === 'group';

  const { nowPlaying, queueRef } = usePlayback();
  const { activeJam, setActiveJam } = useJam();
  const [startingJam, setStartingJam] = useState(false);
  const insets = useSafeAreaInsets();

  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const [listHeight, setListHeight] = useState(0);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [myId, setMyId] = useState<string>('');
  const [myProfile, setMyProfile] = useState<{ username: string | null; displayName: string | null; avatarUrl: string | null }>({ username: null, displayName: null, avatarUrl: null });
  const [friendActivity, setFriendActivity] = useState<FriendActivity | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [reactionTarget, setReactionTarget] = useState<ChatMessage | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [composerHeight, setComposerHeight] = useState(0);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardVisible(true);
      console.log('[keyboard] visible=true');
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
      console.log('[keyboard] visible=false');
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // Initial load — stale-while-revalidate
  useEffect(() => {
    let cancelled = false;

    // ── Profile (fire-and-forget, non-blocking) ──────────────────────────────
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data?.user?.id ?? '';
      if (!cancelled) { setMyId(uid); }
      if (uid) {
        const { data: prof } = await db
          .from('profiles')
          .select('username, display_name, avatar_url')
          .eq('id', uid)
          .maybeSingle();
        if (!cancelled && prof) {
          setMyProfile({
            username: (prof as { username: string | null }).username,
            displayName: (prof as { display_name: string | null }).display_name,
            avatarUrl: (prof as { avatar_url: string | null }).avatar_url,
          });
        }
      }
    });

    // ── Messages: start network fetch immediately, read cache in parallel ────
    const networkPromise = fetchMessages(conversationId);

    // Show cached messages instantly (no spinner if cache hit)
    messageCache.getMessages(conversationId).then(cached => {
      if (!cancelled && cached && cached.length > 0) {
        setMessages(cached);
        setLoading(false);
      }
    });

    // Merge fresh data when network responds
    networkPromise
      .then(({ messages: msgs, nextCursor: cursor }) => {
        if (!cancelled) {
          setMessages(msgs);
          setNextCursor(cursor);
          setLoading(false);
          // Write-through: persist first page so next open is instant
          void messageCache.setMessages(conversationId, msgs);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoading(false);
          // If cache already rendered something, stay silent (don't disrupt UX)
          const msg = err instanceof Error
            ? err.message
            : (err as { message?: string })?.message ?? JSON.stringify(err);
          Alert.alert('Could not load messages', msg);
        }
      });

    void markAsRead(conversationId);

    return () => { cancelled = true; };
  }, [conversationId]);

  // Realtime subscription
  useEffect(() => {
    console.log(`[realtime] ConversationScreen subscribing conv=${conversationId} myId=${myId}`);
    subscribeToConversation(
      conversationId,
      msg => {
        console.log(`[realtime] ConversationScreen onMessage id=${msg.id} sender=${msg.senderId}`);
        setMessages(prev => {
          // Defensive: skip if already in list (e.g. own optimistic message that
          // already has the real DB id, or duplicate from a re-subscribe burst).
          if (prev.some(m => m.id === msg.id)) {
            console.log(`[realtime] ConversationScreen duplicate id=${msg.id} — skipping`);
            return prev;
          }
          console.log(`[realtime] ConversationScreen setMessages prepending id=${msg.id} (was ${prev.length} msgs)`);
          return [msg, ...prev];
        });
        setTimeout(() => flatListRef.current?.scrollToIndex({ index: 0, animated: true }), 50);
        // Keep cache warm so the next open of this conversation shows the new msg
        void messageCache.prependMessages(conversationId, [msg]);
      },
      async messageId => {
        // Refresh reactions for that message
        const { data } = await db
          .from('message_reactions')
          .select('emoji, user_id')
          .eq('message_id', messageId);
        if (!data) { return; }
        const rxns = data as { emoji: string; user_id: string }[];
        setMessages(prev =>
          prev.map(m => {
            if (m.id !== messageId) { return m; }
            const reactionMap = new Map<string, { count: number; reactedByMe: boolean; users: string[] }>();
            for (const r of rxns) {
              const ex = reactionMap.get(r.emoji) ?? { count: 0, reactedByMe: false, users: [] };
              ex.count += 1;
              ex.users.push(r.user_id);
              if (r.user_id === myId) { ex.reactedByMe = true; }
              reactionMap.set(r.emoji, ex);
            }
            return {
              ...m,
              reactions: Array.from(reactionMap.entries()).map(([emoji, v]) => ({
                emoji,
                count: v.count,
                reactedByMe: v.reactedByMe,
                users: v.users,
              })),
            };
          }),
        );
      },
    );

    return () => unsubscribeFromConversation(conversationId);
  }, [conversationId, myId]);

  // For groups: fetch member count. For DMs: fetch friend activity.
  const friendActivityLoadedRef = useRef(false);
  useEffect(() => {
    if (friendActivityLoadedRef.current) { return; }
    if (isGroup) {
      // Fetch member count for group header subtitle
      db
        .from('conversation_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('conversation_id', conversationId)
        .then(({ count }: { count: number | null }) => {
          friendActivityLoadedRef.current = true;
          if (count !== null) { setMemberCount(count); }
        });
    } else {
      // DM: fetch other user's activity
      db
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .neq('user_id', myId || 'x')
        .limit(1)
        .maybeSingle()
        .then(async ({ data }: { data: { user_id: string } | null }) => {
          if (!data?.user_id) { return; }
          friendActivityLoadedRef.current = true;
          const activity = await getFriendActivity(data.user_id);
          setFriendActivity(activity);
        });
    }
  }, [conversationId, myId, isGroup]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) { return; }
    setLoadingMore(true);
    try {
      const { messages: older, nextCursor: cursor } = await fetchMessages(
        conversationId,
        nextCursor,
      );
      setMessages(prev => [...prev, ...older]);
      setNextCursor(cursor);
    } finally {
      setLoadingMore(false);
    }
  }, [conversationId, nextCursor, loadingMore]);

  const handleSend = useCallback(async () => {
    const body = text.trim();
    if (!body || sending) { return; }
    setText('');
    setSending(true);

    const optimistic: ChatMessage = {
      id: `opt-${Date.now()}`,
      conversationId,
      senderId: myId,
      kind: 'text',
      body,
      metadata: null,
      replyToId: null,
      createdAt: new Date().toISOString(),
      deletedAt: null,
      senderUsername: null,
      senderDisplayName: null,
      senderAvatarUrl: null,
      reactions: [],
    };
    setMessages(prev => [optimistic, ...prev]);
    setTimeout(() => flatListRef.current?.scrollToIndex({ index: 0, animated: true }), 50);

    try {
      const payload: SendMessagePayload = { kind: 'text', body };
      const real = await sendMessage(conversationId, payload, myProfile);
      setMessages(prev =>
        prev.map(m => (m.id === optimistic.id ? real : m)),
      );
      // Update cache: replace optimistic with the confirmed message
      void messageCache.prependMessages(conversationId, [real]);
    } catch (err) {
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      setText(body);
      const msg = err instanceof Error
        ? err.message
        : (err as { message?: string })?.message ?? JSON.stringify(err);
      Alert.alert('Send failed', msg);
    } finally {
      setSending(false);
    }
  }, [text, sending, conversationId, myId, myProfile]);

  const handleLongPress = useCallback((msg: ChatMessage) => {
    setReactionTarget(msg);
  }, []);

  const handleReactionToggle = useCallback(async (msg: ChatMessage, emoji: string) => {
    const myCurrentReaction = msg.reactions.find(r => r.users.includes(myId));
    const isSameEmoji = myCurrentReaction?.emoji === emoji;

    // Compute updated reactions once — reuse for state update AND cache patch
    let reactions = [...msg.reactions];
    if (myCurrentReaction) {
      reactions = reactions
        .map(r => r.emoji === myCurrentReaction.emoji
          ? { ...r, count: r.count - 1, reactedByMe: false, users: r.users.filter(u => u !== myId) }
          : r)
        .filter(r => r.count > 0);
    }
    if (!isSameEmoji) {
      const target = reactions.find(r => r.emoji === emoji);
      if (target) {
        reactions = reactions.map(r => r.emoji === emoji
          ? { ...r, count: r.count + 1, reactedByMe: true, users: [...r.users, myId] }
          : r);
      } else {
        reactions = [...reactions, { emoji, count: 1, reactedByMe: true, users: [myId] }];
      }
    }
    const updatedMsg = { ...msg, reactions };

    // Optimistic state update (instant, no network wait)
    setMessages(prev => prev.map(m => m.id === msg.id ? updatedMsg : m));

    // Patch cache so next cold-open shows correct reactions
    void messageCache.patchMessage(conversationId, updatedMsg);

    // Persist to DB — addReaction does delete-then-insert for one-per-user
    if (isSameEmoji) {
      await removeReaction(msg.id, emoji);
    } else {
      await addReaction(msg.id, emoji);
    }
  }, [myId, conversationId]);

  const handlePickReaction = useCallback(async (emoji: string) => {
    if (!reactionTarget) { return; }
    const msg = reactionTarget;
    setReactionTarget(null);
    await handleReactionToggle(msg, emoji);
  }, [reactionTarget, handleReactionToggle]);

  const handleStartJam = useCallback(async () => {
    if (activeJam) {
      Alert.alert(
        'Jam Already Running',
        'Please end the current Jam Room before starting a new one.',
      );
      return;
    }
    if (startingJam) { return; }
    setStartingJam(true);
    try {
      const jamRoomId = await createJamRoom(conversationId, nowPlaying);
      // Seed jam queue with the host's current playback queue (fire-and-forget)
      const trackIds = queueRef.current.map(item => item.trackId).filter(Boolean);
      if (trackIds.length > 0) {
        void bulkAddToQueue(jamRoomId, trackIds).catch(() => {});
      }
      setActiveJam({ jamRoomId, conversationId, conversationTitle: title });
      navigation.navigate('JamRoom', { jamRoomId, conversationId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('Could not start Jam Room', msg);
    } finally {
      setStartingJam(false);
    }
  }, [activeJam, startingJam, conversationId, nowPlaying, queueRef, setActiveJam, title, navigation]);

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <MessageBubble
        msg={item}
        isMe={item.senderId === myId}
        conversationId={conversationId}
        conversationTitle={title}
        onLongPress={handleLongPress}
        onReactionToggle={handleReactionToggle}
      />
    ),
    [myId, conversationId, title, handleLongPress, handleReactionToggle],
  );

  const headerSubtitle = useMemo(() => {
    if (!friendActivity) { return null; }
    if (friendActivity.nowPlaying) {
      return `🎵 ${friendActivity.nowPlaying.trackTitle} · ${friendActivity.nowPlaying.artistName}`;
    }
    if (friendActivity.isOnline) { return 'Online'; }
    return null;
  }, [friendActivity]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          activeOpacity={0.7}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerInfo}
          activeOpacity={isGroup ? 0.7 : 1}
          onPress={isGroup ? () => navigation.navigate('GroupInfo', { conversationId }) : undefined}
        >
          <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
          {isGroup ? (
            memberCount !== null ? (
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {memberCount} member{memberCount !== 1 ? 's' : ''}
              </Text>
            ) : null
          ) : headerSubtitle ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {headerSubtitle}
            </Text>
          ) : friendActivity?.isOnline ? (
            <View style={styles.onlineRow}>
              <View style={styles.onlineDot} />
              <Text style={styles.onlineText}>Online</Text>
            </View>
          ) : null}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.jamBtn}
          activeOpacity={0.7}
          onPress={() => void handleStartJam()}
          disabled={startingJam}
        >
          {startingJam
            ? <ActivityIndicator size="small" color={COLORS.purpleLight} />
            : <>
                <Text style={styles.jamBtnIcon}>🎵</Text>
                <Text style={styles.jamBtnLabel}>Jam</Text>
              </>
          }
        </TouchableOpacity>
        {isGroup && (
          <TouchableOpacity
            style={styles.infoBtn}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('GroupInfo', { conversationId })}
          >
            <Text style={styles.infoBtnText}>ⓘ</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.purple} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <View
            style={styles.flex}
            onLayout={e => setListHeight(e.nativeEvent.layout.height)}
          >
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={item => item.id}
              renderItem={renderItem}
              inverted
              contentContainerStyle={[
                styles.listContent,
                {
                  // paddingTop in inverted = visual space below the newest message,
                  // centering it when few messages exist
                  paddingTop: listHeight > 0 ? listHeight * 0.4 : 200,
                  paddingBottom: composerHeight > 0 ? composerHeight : 72 + insets.bottom,
                },
              ]}
              onEndReached={loadMore}
              onEndReachedThreshold={0.2}
              ListFooterComponent={
                loadingMore ? (
                  <View style={styles.loadMoreSpinner}>
                    <ActivityIndicator size="small" color={COLORS.purpleLight} />
                  </View>
                ) : null
              }
            />

            {/* Send bar — absolute so FlatList scrolls behind it */}
            <View
              style={[styles.sendBar, { paddingBottom: 8 + 16 + (keyboardVisible ? 0 : insets.bottom) }]}
              onLayout={e => {
                const h = e.nativeEvent.layout.height;
                setComposerHeight(h);
                console.log(`[composer] height=${h} keyboardVisible=${keyboardVisible} insets.bottom=${insets.bottom}`);
              }}
            >
              <View style={styles.inputWrap}>
                <FormInput
                  value={text}
                  onChangeText={t => setText(t.slice(0, MAX_CHARS))}
                  placeholder="Message…"
                  placeholderTextColor={COLORS.textMuted}
                  multiline
                  style={styles.textInput}
                  returnKeyType="default"
                />
                {text.length > MAX_CHARS - 100 && (
                  <Text style={[styles.charCounter, text.length >= MAX_CHARS && styles.charCounterOver]}>
                    {MAX_CHARS - text.length}
                  </Text>
                )}
              </View>
              <TouchableOpacity
                style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
                activeOpacity={0.7}
                onPress={handleSend}
                disabled={!text.trim() || sending}
              >
                <Text style={styles.sendBtnIcon}>›</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

      <ReactionPicker
        visible={!!reactionTarget}
        onPick={handlePickReaction}
        onClose={() => setReactionTarget(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    gap: 8,
  },
  backButton: { padding: 4 },
  backIcon: { color: COLORS.purple, fontSize: 28, lineHeight: 32 },
  headerInfo: { flex: 1, justifyContent: 'center' },
  infoBtn: { padding: 6 },
  infoBtnText: { color: COLORS.purpleLight, fontSize: 20 },
  jamBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(124, 58, 237, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.55)',
    marginLeft: 4,
  },
  jamBtnIcon: { fontSize: 14, lineHeight: 18 },
  jamBtnLabel: { color: COLORS.purpleLight, fontSize: 13, fontWeight: '700', lineHeight: 18 },
  headerTitle: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  headerSubtitle: { color: COLORS.purple, fontSize: 12, marginTop: 1 },
  onlineRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#22C55E' },
  onlineText: { color: '#22C55E', fontSize: 11 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: 12, paddingTop: 12, gap: 6 },
  loadMoreSpinner: { paddingVertical: 16, alignItems: 'center' },
  // Bubbles
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    marginVertical: 2,
  },
  bubbleRowMe: { flexDirection: 'row-reverse' },
  senderAvatarWrap: {},
  senderAvatar: { width: 28, height: 28, borderRadius: 14 },
  senderAvatarPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.purpleDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  senderAvatarText: { color: COLORS.purpleLight, fontSize: 11, fontWeight: '700' },
  bubbleColumn: { maxWidth: '75%' },
  bubbleColumnMe: { alignItems: 'flex-end' },
  bubbleWrapper: { position: 'relative' },
  bubbleWrapperWithReactions: { marginBottom: 16 },
  senderName: { color: COLORS.textSecondary, fontSize: 11, marginLeft: 2 },
  senderNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  bubbleMe: {
    backgroundColor: COLORS.purple,
    borderBottomRightRadius: 4,
  },
  bubbleThem: {
    backgroundColor: COLORS.surface,
    borderBottomLeftRadius: 4,
  },
  bubbleSticker: {
    backgroundColor: 'transparent',
    padding: 0,
  },
  bubbleText: { color: COLORS.textSecondary, fontSize: 15, lineHeight: 21 },
  bubbleTextMe: { color: COLORS.white },
  stickerImg: { width: 120, height: 120 },
  trackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 200,
  },
  trackCardArt: { width: 44, height: 44, borderRadius: 6 },
  trackCardArtPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackCardNote: { fontSize: 20 },
  trackCardInfo: { flex: 1 },
  trackCardTitle: { color: COLORS.white, fontSize: 13, fontWeight: '600' },
  trackCardArtist: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  // Jam invite card
  jamInviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1,
    borderColor: COLORS.purple,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    maxWidth: '85%',
  },
  jamInviteIcon: { fontSize: 22 },
  jamInviteInfo: { flex: 1 },
  jamInviteTitle: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  jamInviteSub: { color: COLORS.purpleLight, fontSize: 11, marginTop: 2 },
  jamInviteBtn: {
    backgroundColor: COLORS.purple,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  jamInviteBtnText: { color: COLORS.white, fontSize: 13, fontWeight: '700' },
  // Reactions — Instagram style: absolute overlay at bubble bottom
  reactionOverlay: {
    position: 'absolute',
    bottom: -14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  reactionOverlayThem: { left: 10 },
  reactionOverlayMe: { right: 10 },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 2,
    borderColor: COLORS.bg,
    minWidth: 28,
    justifyContent: 'center',
  },
  reactionChipActive: {
    backgroundColor: COLORS.purpleDim,
    borderColor: COLORS.purple,
  },
  reactionEmoji: { fontSize: 13 },
  reactionCount: { color: COLORS.white, fontSize: 11, fontWeight: '600' },
  // Reaction picker overlay
  reactionPickerOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  reactionPickerCard: {
    backgroundColor: COLORS.card,
    borderRadius: 24,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    width: '100%',
  },
  reactionPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  reactionPickerBtn: { padding: 6 },
  reactionPickerEmoji: { fontSize: 26 },
  reactionPickerMoreBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  reactionPickerMoreBtnActive: {
    backgroundColor: COLORS.purpleDim,
  },
  reactionPickerMoreIcon: { color: COLORS.textSecondary, fontSize: 20, fontWeight: '600' },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingTop: 8,
    paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    marginTop: 6,
  },
  emojiGridBtn: {
    width: '10%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiGridEmoji: { fontSize: 22 },
  // Send bar — absolute overlay so messages scroll behind the translucent bar
  sendBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8 + 16, // base — insets.bottom added inline
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(124, 58, 237, 0.25)',
    gap: 8,
    backgroundColor: 'rgba(10, 10, 15, 0.90)',
  },
  inputWrap: { flex: 1 },
  textInput: { maxHeight: 100 },
  charCounter: { color: COLORS.textMuted, fontSize: 11, textAlign: 'right', marginTop: 2, marginRight: 4 },
  charCounterOver: { color: COLORS.danger },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
    // iOS shadow only — elevation removed to prevent Android blue-grey shadow artifact
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 0,
  },
  sendBtnDisabled: { backgroundColor: COLORS.border, shadowOpacity: 0 },
  sendBtnText: { display: 'none' },
  sendBtnIcon: {
    fontSize: 28,
    lineHeight: 32,
    color: COLORS.white,
    includeFontPadding: false,
  },
});
