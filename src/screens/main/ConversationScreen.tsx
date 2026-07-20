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
  ActivityIndicator,
  Pressable,
  ScrollViewProps,
  Vibration,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  KeyboardChatScrollView,
  KeyboardStickyView,
  KeyboardGestureArea,
} from 'react-native-keyboard-controller';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import { Icon } from '../../components/Icon';
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
  getOtherMemberReadAt,
  type FriendActivity,
  type ConversationSummary,
} from '../../services/conversations';
import {
  subscribeToConversation,
  unsubscribeFromConversation,
} from '../../services/jamRealtime';
import { createJamRoom, bulkAddToQueue, isJamRoomEnded } from '../../services/jamRooms';
import { usePlayback } from '../../contexts/PlaybackContext';
import { useJam } from '../../contexts/JamContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../../lib/supabase';
import AddBadge from '../../components/AddBadge';
import { Button } from '../../components/Button';
import { GradientBorder } from '../../components/GradientBorder';
import ChatTimeSeparator from '../../components/ChatTimeSeparator';
import SwipeRevealRow from '../../components/SwipeRevealRow';
import SwipeReplyRow from '../../components/SwipeReplyRow';
import { SwipeRevealProvider, SwipeRevealGestureView } from '../../contexts/SwipeRevealContext';
import { formatChatTimestamp, formatChatTimeOnly, shouldShowTimeSeparator } from '../../utils/chatTime';
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
  const { activeJam, setActiveJam } = useJam();
  const jamRoomId = msg.metadata?.jam_room_id as string | undefined;
  const [ended, setEnded] = useState(false);

  // Re-check ended status on mount AND whenever activeJam changes (e.g. host
  // ends the jam → activeJam becomes null → we re-query the DB).
  useEffect(() => {
    if (!jamRoomId) { return; }
    let cancelled = false;
    isJamRoomEnded(jamRoomId).then(v => { if (!cancelled) { setEnded(v); } });
    return () => { cancelled = true; };
  }, [jamRoomId, activeJam]);

  if (!jamRoomId) { return null; }
  const handleJoin = () => {
    if (ended) { return; }
    // Mark this jam active before navigating so the global JamRealtimeProvider
    // can subscribe + start receiving the host's playback even before
    // JamRoomScreen mounts.
    setActiveJam({ jamRoomId, conversationId, conversationTitle: title });
    navigation.navigate('JamRoom', { jamRoomId, conversationId });
  };
  return (
    <View style={[styles.jamInviteCard, ended && styles.jamInviteCardEnded]}>
      <Icon name="musicNote" size={22} color={COLORS.purpleLight} />
      <View style={styles.jamInviteInfo}>
        <Text style={styles.jamInviteTitle}>
          {ended ? 'Jam Room ended' : 'Jam Room started'}
        </Text>
        <Text style={styles.jamInviteSub}>
          {ended ? 'This session is no longer active' : 'Tap to join the listening session'}
        </Text>
      </View>
      {ended ? (
        <View style={styles.jamInviteBtnEnded}>
          <Text style={styles.jamInviteBtnEndedText}>Ended</Text>
        </View>
      ) : (
        <Button label="Join" onPress={handleJoin} variant="primary" size="sm" />
      )}
    </View>
  );
}

function MessageBubble({
  msg,
  isMe,
  conversationId,
  conversationTitle,
  repliedTo,
  isHighlighted,
  onReply,
  onReplyQuotePress,
  onLongPress,
  onReactionToggle,
}: {
  msg: ChatMessage;
  isMe: boolean;
  conversationId: string;
  conversationTitle: string;
  repliedTo: ChatMessage | null;
  isHighlighted: boolean;
  onReply: () => void;
  onReplyQuotePress: (originalId: string) => void;
  onLongPress: (msg: ChatMessage) => void;
  onReactionToggle: (msg: ChatMessage, emoji: string) => void;
}) {
  const hasStickerMeta = msg.kind === 'sticker' && !!msg.metadata?.sticker_url;
  const hasTrackMeta = msg.kind === 'track_share' && !!msg.metadata;
  const isJamInvite = msg.kind === 'jam_invite' && !!msg.metadata?.jam_room_id;
  const isSystem = msg.kind === 'system';

  if (isSystem) {
    return (
      <View style={styles.systemRow}>
        <Text style={styles.systemText}>{msg.body}</Text>
      </View>
    );
  }

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
        <SwipeReplyRow onReply={onReply}>
        <View style={[styles.bubbleWrapper, hasReactions && styles.bubbleWrapperWithReactions]}>
          <Pressable
            onLongPress={() => onLongPress(msg)}
            style={[
              styles.bubble,
              isMe ? styles.bubbleMe : styles.bubbleThem,
              hasStickerMeta ? styles.bubbleSticker : null,
              isHighlighted && styles.bubbleHighlighted,
            ]}
          >
            {msg.replyToId && (
              <Pressable
                onPress={() => msg.replyToId && onReplyQuotePress(msg.replyToId)}
                style={[styles.replyQuote, isMe ? styles.replyQuoteMe : styles.replyQuoteThem]}
              >
                <Text
                  style={[styles.replyQuoteAuthor, isMe ? styles.replyQuoteAuthorMe : styles.replyQuoteAuthorThem]}
                  numberOfLines={1}
                >
                  {repliedTo
                    ? (repliedTo.senderDisplayName || repliedTo.senderUsername || 'Unknown')
                    : 'Original message'}
                </Text>
                <Text
                  style={[styles.replyQuoteBody, isMe ? styles.replyQuoteBodyMe : styles.replyQuoteBodyThem]}
                  numberOfLines={2}
                >
                  {repliedTo
                    ? (repliedTo.body || (repliedTo.kind === 'sticker' ? 'Sticker' : repliedTo.kind === 'track_share' ? 'Track' : 'Message'))
                    : 'Tap to view'}
                </Text>
              </Pressable>
            )}

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
                    <Icon name="musicNote" size={20} color={COLORS.textSecondary} />
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
        </SwipeReplyRow>
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
  const { showToast } = useToast();
  const [startingJam, setStartingJam] = useState(false);
  const insets = useSafeAreaInsets();

  const flatListRef = useRef<FlatList<ChatMessage>>(null);

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
  const [otherUserId, setOtherUserId] = useState<string | null>(null);
  const [otherUserAvatarUrl, setOtherUserAvatarUrl] = useState<string | null>(null);
  const [reactionTarget, setReactionTarget] = useState<ChatMessage | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  // When the user taps a reply quote we scroll to the original and pulse it
  // for ~1.5s. Cleared by the timer or by a fresh tap.
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Other DM participant's last_read_at — drives the Instagram-style
  // "Seen / Delivered" indicator under the most recent outgoing message.
  // Null until the first fetch resolves (we render nothing until then).
  const [otherReadAt, setOtherReadAt] = useState<string | null>(null);

  // Memoised lookup so MessageBubble can render the quoted-context strip for
  // any message whose `replyToId` resolves into the loaded list. Falls back
  // gracefully — if the original is missing (e.g. loaded later via pagination),
  // the bubble just shows a generic "Replied to a message" caption.
  const messagesById = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of messages) { map.set(m.id, m); }
    return map;
  }, [messages]);

  // The most recent OUTGOING message — the only one that gets a
  // Sending/Delivered/Seen footer (Instagram convention). messages is
  // ordered newest→oldest, so this is the first match.
  const latestOutgoing = useMemo<ChatMessage | null>(() => {
    for (const m of messages) {
      if (m.senderId === myId && m.kind !== 'system' && !m.deletedAt) { return m; }
    }
    return null;
  }, [messages, myId]);

  // Status string for the footer. Optimistic (id starts with `opt-`) means
  // the server hasn't confirmed yet — show "Sending…". Once confirmed and
  // the other party's last_read_at meets/exceeds the message createdAt, it
  // upgrades to "Seen". In between: "Delivered".
  const latestOutgoingStatus = useMemo<'sending' | 'delivered' | 'seen' | null>(() => {
    if (kind !== 'dm' || !latestOutgoing) { return null; }
    if (latestOutgoing.id.startsWith('opt-')) { return 'sending'; }
    if (otherReadAt && new Date(otherReadAt).getTime() >= new Date(latestOutgoing.createdAt).getTime()) {
      return 'seen';
    }
    return 'delivered';
  }, [kind, latestOutgoing, otherReadAt]);

  const handleReplyQuotePress = useCallback((originalId: string) => {
    const idx = messages.findIndex(m => m.id === originalId);
    if (idx < 0) {
      // Original isn't in the loaded window — surface a toast and bail.
      showToast("Original message isn't loaded yet — scroll up to find it.", { kind: 'info' });
      return;
    }
    flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.4 });
    setHighlightedMessageId(originalId);
    if (highlightTimerRef.current) { clearTimeout(highlightTimerRef.current); }
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedMessageId(null);
      highlightTimerRef.current = null;
    }, 1500);
  }, [messages, showToast]);

  useEffect(() => () => {
    // On unmount, clear any pending highlight timer.
    if (highlightTimerRef.current) { clearTimeout(highlightTimerRef.current); }
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
          console.warn('[chat] fetchMessages failed', err);
          showToast("Couldn't load messages. Please try again.", { kind: 'error' });
        }
      });

    void markAsRead(conversationId);

    return () => { cancelled = true; };
  }, [conversationId, showToast]);

  // DM read-receipt source: the other participant's last_read_at. Fetched
  // once when the conversation opens and kept fresh by a realtime sub on
  // conversation_members UPDATEs scoped to this conversation. Only matters
  // for DMs — groups would need multi-member fanout we haven't built yet.
  useEffect(() => {
    if (kind !== 'dm') { return; }
    let cancelled = false;
    void (async () => {
      const row = await getOtherMemberReadAt(conversationId);
      if (!cancelled && row) { setOtherReadAt(row.lastReadAt); }
    })();
    console.log('[realtime] conv-read subscribing', { conversationId });
    const channel = supabase
      .channel(`conv-read:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversation_members',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload: { new: { user_id?: string; last_read_at?: string | null } }) => {
          const row = payload.new;
          if (!row || !row.user_id || row.user_id === myId) { return; }
          if (row.last_read_at) {
            console.log('[realtime] conv-read got other last_read_at', row.last_read_at);
            setOtherReadAt(row.last_read_at);
          }
        },
      )
      .subscribe(status => {
        console.log('[realtime] conv-read status', status);
      });
    return () => {
      cancelled = true;
      console.log('[realtime] conv-read unsubscribing');
      void supabase.removeChannel(channel);
    };
  }, [conversationId, kind, myId]);

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
        // Re-mark read whenever an incoming message lands while the chat is
        // open. Without this, the receiver's last_read_at only advances at
        // mount, so the SENDER's "Seen" indicator wouldn't catch up to
        // messages that arrive while both are actively chatting. Skip our
        // own outbound — markAsRead for our own message is a no-op and
        // wastes a round trip.
        if (msg.senderId && msg.senderId !== myId) {
          void markAsRead(conversationId);
        }
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
          setOtherUserId(data.user_id);
          const [activity, profileRes] = await Promise.all([
            getFriendActivity(data.user_id),
            db.from('profiles').select('avatar_url').eq('id', data.user_id).maybeSingle(),
          ]);
          setFriendActivity(activity);
          const avatarUrl = (profileRes.data as { avatar_url: string | null } | null)?.avatar_url ?? null;
          if (avatarUrl) { setOtherUserAvatarUrl(avatarUrl); }
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

  const sendDisabled = !text.trim() || sending;

  const handleSend = useCallback(async () => {
    const body = text.trim();
    if (!body || sending) { return; }
    setText('');
    setSending(true);
    // Capture the reply target locally so the closure isn't affected if the
    // user starts a new reply while this one is in flight.
    const replyTarget = replyingTo;
    setReplyingTo(null);

    const optimistic: ChatMessage = {
      id: `opt-${Date.now()}`,
      conversationId,
      senderId: myId,
      kind: 'text',
      body,
      metadata: null,
      replyToId: replyTarget?.id ?? null,
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
      const payload: SendMessagePayload = replyTarget
        ? { kind: 'text', body, replyToId: replyTarget.id }
        : { kind: 'text', body };
      const real = await sendMessage(conversationId, payload, myProfile);
      setMessages(prev =>
        prev.map(m => (m.id === optimistic.id ? real : m)),
      );
      // Update cache: replace optimistic with the confirmed message
      void messageCache.prependMessages(conversationId, [real]);
    } catch (err) {
      console.warn('[chat] sendMessage failed', err);
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      setText(body);
      // Restore the reply target so the user doesn't have to swipe again on retry.
      setReplyingTo(replyTarget);
      showToast("Couldn't send message. Please try again.", { kind: 'error' });
    } finally {
      setSending(false);
    }
  }, [text, sending, replyingTo, conversationId, myId, myProfile, showToast]);

  const handleLongPress = useCallback((msg: ChatMessage) => {
    // Firm tap when the picker opens — same duration as the swipe-to-reply
    // tick so the activation feel is consistent across gestures. Requires
    // the VIBRATE permission in AndroidManifest.xml.
    Vibration.vibrate(35);
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
    // Lighter confirmation tick for the selection itself — distinct from
    // the firmer "picker opened" haptic so the two events feel different.
    Vibration.vibrate(20);
    const msg = reactionTarget;
    setReactionTarget(null);
    await handleReactionToggle(msg, emoji);
  }, [reactionTarget, handleReactionToggle]);

  const handleStartJam = useCallback(async () => {
    if (activeJam) {
      showToast('End the current Jam Room first.', { kind: 'info' });
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
      console.warn('[jam] createJamRoom failed', err);
      showToast("Couldn't start Jam Room. Please try again.", { kind: 'error' });
    } finally {
      setStartingJam(false);
    }
  }, [activeJam, startingJam, conversationId, nowPlaying, queueRef, setActiveJam, title, navigation, showToast]);

  const renderChatScrollComponent = useCallback(
    (props: ScrollViewProps) => (
      <KeyboardChatScrollView
        {...props}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        keyboardDismissMode="interactive"
        offset={insets.bottom}
        inverted
      />
    ),
    [insets.bottom],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: ChatMessage; index: number }) => {
      // FlatList is inverted, so `messages` is ordered newest→oldest.
      // The chronologically earlier message — the one rendered visually
      // ABOVE this row — sits at `index + 1`. Show a separator above the
      // bubble when this row begins a new time group (oldest msg, or a
      // gap of more than ~1h since the previous one).
      const prev = messages[index + 1] ?? null;
      const showSep = shouldShowTimeSeparator(item.createdAt, prev?.createdAt ?? null);
      const repliedTo = item.replyToId ? messagesById.get(item.replyToId) ?? null : null;
      const isHighlighted = item.id === highlightedMessageId;
      const isLatestOutgoing = latestOutgoing?.id === item.id;
      return (
        <>
          {showSep ? <ChatTimeSeparator label={formatChatTimestamp(item.createdAt)} /> : null}
          <SwipeRevealRow timestamp={formatChatTimeOnly(item.createdAt)}>
            <MessageBubble
              msg={item}
              isMe={item.senderId === myId}
              conversationId={conversationId}
              conversationTitle={title}
              repliedTo={repliedTo}
              isHighlighted={isHighlighted}
              onReply={() => setReplyingTo(item)}
              onReplyQuotePress={handleReplyQuotePress}
              onLongPress={handleLongPress}
              onReactionToggle={handleReactionToggle}
            />
            {isLatestOutgoing && latestOutgoingStatus ? (
              <Text style={styles.readStatus}>
                {latestOutgoingStatus === 'seen'
                  ? 'Seen'
                  : latestOutgoingStatus === 'delivered'
                    ? 'Delivered'
                    : 'Sending…'}
              </Text>
            ) : null}
          </SwipeRevealRow>
        </>
      );
    },
    [myId, conversationId, title, handleLongPress, handleReactionToggle, messages, messagesById, highlightedMessageId, handleReplyQuotePress, latestOutgoing, latestOutgoingStatus],
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
          <Icon name="back" size={28} color={COLORS.purple} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerInfo}
          activeOpacity={0.7}
          onPress={
            isGroup
              ? () => navigation.navigate('GroupInfo', { conversationId })
              : otherUserId
                ? () => navigation.navigate('UserProfile', { userId: otherUserId })
                : undefined
          }
        >
          <View style={styles.headerTitleRow}>
            {!isGroup && (
              otherUserAvatarUrl ? (
                <Image source={{ uri: otherUserAvatarUrl }} style={styles.headerAvatar} />
              ) : (
                <View style={styles.headerAvatarPlaceholder}>
                  <Text style={styles.headerAvatarText}>{title.slice(0, 1).toUpperCase()}</Text>
                </View>
              )
            )}
            <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
          </View>
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
                <Icon name="musicNote" size={14} color={COLORS.purpleLight} />
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
            <Icon name="info" size={20} color={COLORS.purpleLight} />
          </TouchableOpacity>
        )}
      </View>

      {/* Gate the FlatList render on myId being resolved too. Otherwise the
          first paint runs with myId='', so isMe=false for every row → all
          bubbles render left-aligned, then snap right once auth lands. */}
      {loading || !myId ? (
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.purple} />
        </View>
      ) : (
        <KeyboardGestureArea
          interpolator="ios"
          style={styles.flex}
          textInputNativeID="conversation-input"
        >
          <SwipeRevealProvider>
            <SwipeRevealGestureView>
              <FlatList
                ref={flatListRef}
                style={styles.flex}
                renderScrollComponent={renderChatScrollComponent}
                data={messages}
                keyExtractor={item => item.id}
                renderItem={renderItem}
                inverted
                contentContainerStyle={[
                  styles.listContent,
                  { paddingTop: 200 },
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
            </SwipeRevealGestureView>
          </SwipeRevealProvider>

          <KeyboardStickyView offset={{ closed: 0 }}>
            {replyingTo ? (
              <View style={styles.replyPreview}>
                <View style={styles.replyPreviewBar} />
                <View style={styles.replyPreviewBody}>
                  <Text style={styles.replyPreviewTitle} numberOfLines={1}>
                    Replying to {replyingTo.senderId === myId
                      ? 'yourself'
                      : (replyingTo.senderDisplayName || replyingTo.senderUsername || 'Unknown')}
                  </Text>
                  <Text style={styles.replyPreviewBodyText} numberOfLines={1}>
                    {replyingTo.body
                      || (replyingTo.kind === 'sticker' ? 'Sticker'
                        : replyingTo.kind === 'track_share' ? 'Track'
                        : 'Message')}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.replyPreviewClose}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => setReplyingTo(null)}
                >
                  <Icon name="close" size={22} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>
            ) : null}
            <View style={[styles.sendBar, { paddingBottom: 8 + insets.bottom }]}>
              <View style={styles.inputWrap}>
                <FormInput
                  nativeID="conversation-input"
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
                style={[styles.sendBtn, sendDisabled && styles.sendBtnDisabled]}
                activeOpacity={0.7}
                onPress={handleSend}
                disabled={sendDisabled}
              >
                {/* Glow only while actionable — disabled falls back to a flat grey ring. */}
                {sendDisabled ? null : <GradientBorder borderRadius={19} />}
                <Icon
                  name="send"
                  size={28}
                  color={sendDisabled ? COLORS.textMuted : COLORS.purpleNeon}
                />
              </TouchableOpacity>
            </View>
          </KeyboardStickyView>
        </KeyboardGestureArea>
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
  headerInfo: { flex: 1, justifyContent: 'center' },
  infoBtn: { padding: 6 },
  jamBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(139, 61, 255, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(139, 61, 255, 0.55)',
    marginLeft: 4,
  },
  jamBtnLabel: { color: COLORS.purpleLight, fontSize: 13, fontWeight: '700', lineHeight: 18 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerAvatar: { width: 32, height: 32, borderRadius: 16 },
  headerAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.purpleDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarText: { color: COLORS.purpleLight, fontSize: 13, fontWeight: '700' },
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
  // Brief pulse applied when the user taps a reply quote pointing at this
  // bubble — same purple tint as the comment-row highlight in CommentsSheet.
  bubbleHighlighted: {
    borderWidth: 1.5,
    borderColor: COLORS.purpleLight,
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 6,
  },
  // Quoted-reply strip rendered above the body text inside a reply bubble.
  // Mirrors Instagram — a tinted block with a left bar, sender name, and a
  // truncated snippet of the original message. me/them get distinct
  // colour pairs so the strip is legible against either bubble background.
  replyQuote: {
    borderLeftWidth: 3,
    paddingLeft: 8,
    paddingRight: 10,
    paddingVertical: 6,
    borderRadius: 4,
    marginBottom: 6,
  },
  // "me" bubble is bright purple — darken the strip and use white text so
  // it doesn't disappear against the bubble.
  replyQuoteMe: {
    backgroundColor: 'rgba(0,0,0,0.30)',
    borderLeftColor: COLORS.white,
  },
  replyQuoteAuthorMe: { color: COLORS.white },
  replyQuoteBodyMe: { color: 'rgba(255,255,255,0.85)' },
  // "them" bubble is dark surface — lift the strip and keep the purple bar.
  replyQuoteThem: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderLeftColor: COLORS.purpleLight,
  },
  replyQuoteAuthorThem: { color: COLORS.purpleLight },
  replyQuoteBodyThem: { color: COLORS.white },
  replyQuoteAuthor: { fontSize: 12, fontWeight: '700' },
  replyQuoteBody: { fontSize: 13, lineHeight: 17, marginTop: 2 },
  // Read-receipt footer below the latest outgoing DM message — small,
  // muted, right-aligned to sit under the bubble.
  readStatus: {
    alignSelf: 'flex-end',
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
    marginRight: 14,
    marginBottom: 2,
  },
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
  jamInviteInfo: { flex: 1 },
  jamInviteTitle: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  jamInviteSub: { color: COLORS.purpleLight, fontSize: 11, marginTop: 2 },
  jamInviteCardEnded: {
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    opacity: 0.7,
  },
  jamInviteBtnEnded: {
    backgroundColor: COLORS.card,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  jamInviteBtnEndedText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '700' },
  // System messages (e.g. "The Jam Room has ended.")
  systemRow: {
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 20,
  },
  systemText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  // Reactions — Instagram-style: a small rounded pill that sits at the
  // bottom corner of the bubble. No hard border (the previous bg-coloured
  // border created an awkward visible frame on dark mode). Subtle shadow
  // lifts the chip off the chat background without a stroke.
  reactionOverlay: {
    position: 'absolute',
    bottom: -12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reactionOverlayThem: { left: 8 },
  reactionOverlayMe: { right: 8 },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 3,
  },
  reactionChipActive: {
    // Own reaction picks up a saturated purple tint — Instagram uses a
    // similar accent-coloured fill, no extra border.
    backgroundColor: 'rgba(139, 61, 255,0.35)',
  },
  reactionEmoji: { fontSize: 14, lineHeight: 16 },
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
  // Inline banner that appears between the message list and the input when
  // the user has armed a reply via the swipe gesture. Tap × to cancel and
  // fall back to a normal send.
  replyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: 'rgba(139, 61, 255, 0.10)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(139, 61, 255, 0.25)',
  },
  replyPreviewBar: {
    width: 3,
    alignSelf: 'stretch',
    backgroundColor: COLORS.purpleLight,
    borderRadius: 2,
  },
  replyPreviewBody: { flex: 1 },
  replyPreviewTitle: { color: COLORS.purpleLight, fontSize: 12, fontWeight: '700' },
  replyPreviewBodyText: { color: COLORS.textSecondary, fontSize: 13, marginTop: 1 },
  replyPreviewClose: { padding: 4 },
  sendBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(139, 61, 255, 0.25)',
    gap: 8,
    backgroundColor: 'rgba(10, 10, 15, 0.90)',
  },
  inputWrap: { flex: 1 },
  textInput: { maxHeight: 100 },
  charCounter: { color: COLORS.textMuted, fontSize: 11, textAlign: 'right', marginTop: 2, marginRight: 4 },
  charCounterOver: { color: COLORS.error },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // No fill to swap out any more — disabled reads as a flat grey ring with a
  // muted icon, replacing the old backgroundColor swap.
  sendBtnDisabled: { borderWidth: 1, borderColor: COLORS.border },
});
