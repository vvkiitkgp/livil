import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import FormInput from '../../components/FormInput';
import SeekBar from '../../components/SeekBar';
import AddBadge from '../../components/AddBadge';
import { usePlayback } from '../../contexts/PlaybackContext';
import { useJam } from '../../contexts/JamContext';
import { useJamRealtime } from '../../contexts/JamRealtimeContext';
import {
  leaveJamRoom,
  endJamRoom,
  getMyJamPermissions,
  getJamQueue,
  type JamPermissions,
  type QueueItem,
} from '../../services/jamRooms';
import type { PresenceMember } from '../../services/jamRealtime';
import {
  fetchMessages,
  sendMessage,
  type ChatMessage,
  type SendMessagePayload,
} from '../../services/messages';
import { supabase } from '../../../lib/supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'JamRoom'>;

type Tab = 'chat' | 'queue';

function msToTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function PresenceAvatar({ member }: { member: PresenceMember }) {
  if (member.avatarUrl) {
    return <Image source={{ uri: member.avatarUrl }} style={styles.presenceAvatar} />;
  }
  return (
    <View style={styles.presenceAvatarPlaceholder}>
      <Text style={styles.presenceAvatarText}>
        {member.username.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

export default function JamRoomScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { jamRoomId, conversationId } = route.params;

  const {
    nowPlaying,
    handlersRef,
    positionRef,
    durationRef,
    activePostId,
  } = usePlayback();
  const { activeJam, setActiveJam, clearActiveJam } = useJam();
  // All realtime state — owned by the global JamRealtimeProvider so it keeps
  // running when the host navigates to Home / Search / Profile to find a song.
  const {
    isHost,
    hostUsername,
    presenceMembers,
    remotePlayback,
    synced,
  } = useJamRealtime();

  const [permissions, setPermissions] = useState<JamPermissions>({
    can_play_pause: false, can_seek: false, can_skip: false,
    can_change_track: false, can_suggest: true,
  });
  const [tab, setTab] = useState<Tab>('chat');
  const [chatUnread, setChatUnread] = useState(0);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [chatText, setChatText] = useState('');
  const [sending, setSending] = useState(false);

  // Profile (only used for optimistic chat bubble rendering)
  const [myUsername, setMyUsername] = useState('');
  const [myAvatarUrl, setMyAvatarUrl] = useState<string | null>(null);
  const myIdRef = useRef('');

  // Queue state
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);

  // Smooth seek bar position — both host and listener have local audio
  // (listener via GlobalAudioPlayer driven by the provider's setNowPlaying),
  // so positionRef/durationRef are valid for both.
  const [displayPositionMs, setDisplayPositionMs] = useState(0);
  const [displayDurationMs, setDisplayDurationMs] = useState(0);

  const tabRef = useRef<Tab>('chat');

  // ── Mount: ensure activeJam is set so the provider subscribes ──────────────
  // For host this was already done in ConversationScreen.handleStartJam, but
  // for a listener entering via the "Join" button it wasn't — set it here.
  useEffect(() => {
    if (!activeJam || activeJam.jamRoomId !== jamRoomId) {
      setActiveJam({
        jamRoomId,
        conversationId,
        // We don't have the title here — JamBanner uses this. The host path
        // sets a real title; the listener join shows the room itself anyway.
        conversationTitle: 'Jam Room',
      });
    }
  // run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load my profile + my permissions + initial chat snapshot. None of this
  // is realtime — the provider handles channel events, this is just per-screen
  // bootstrap state.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id ?? '';
      myIdRef.current = uid;

      const { data: prof } = await db
        .from('profiles')
        .select('username, avatar_url')
        .eq('id', uid)
        .maybeSingle();
      if (!cancelled && prof) {
        const p = prof as { username?: string; avatar_url?: string | null };
        setMyUsername(p.username ?? 'User');
        setMyAvatarUrl(p.avatar_url ?? null);
      }

      try {
        const perms = await getMyJamPermissions(jamRoomId);
        if (!cancelled) { setPermissions(perms); }
      } catch {
        // Non-fatal — defaults already applied.
      }

      try {
        const { messages: msgs } = await fetchMessages(conversationId);
        if (!cancelled) {
          setMessages(msgs);
          setMessagesLoading(false);
        }
      } catch {
        if (!cancelled) { setMessagesLoading(false); }
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll local position + duration for smooth seek bar movement.
  useEffect(() => {
    if (!activePostId) { return; }
    const id = setInterval(() => {
      setDisplayPositionMs(positionRef.current * 1000);
      setDisplayDurationMs(durationRef.current * 1000);
    }, 500);
    return () => clearInterval(id);
  }, [activePostId, positionRef, durationRef]);

  // For listeners that haven't started local playback yet (no activePostId),
  // surface the broadcast position so the UI doesn't sit at 0:00.
  useEffect(() => {
    if (isHost) { return; }
    if (activePostId) { return; }
    if (remotePlayback) {
      setDisplayPositionMs(remotePlayback.positionMs);
    }
  }, [isHost, activePostId, remotePlayback]);

  // Live chat: listen for new messages in this conversation while the screen
  // is open. ConversationScreen has its own subscription on a different
  // channel key so they don't conflict.
  useEffect(() => {
    console.log(`[realtime] subscribing to jam:chat:${jamRoomId}`);
    const channel = supabase
      .channel(`jam:chat:${jamRoomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        async (payload: { new: { id?: string } }) => {
          const msgId = payload?.new?.id;
          if (!msgId) { return; }

          const { data } = await db
            .from('messages')
            .select('*, profiles(username, display_name, avatar_url)')
            .eq('id', msgId)
            .single();
          if (!data) { return; }

          const raw = data as {
            id: string; conversation_id: string; sender_id: string | null;
            kind: string; body: string | null; metadata: Record<string, unknown> | null;
            reply_to_id: string | null; created_at: string; deleted_at: string | null;
            profiles: { username: string; display_name: string | null; avatar_url: string | null } | null;
          };

          // Skip own messages — already in the list as optimistic
          if (raw.sender_id === myIdRef.current) { return; }

          const msg: ChatMessage = {
            id: raw.id,
            conversationId: raw.conversation_id,
            senderId: raw.sender_id,
            kind: raw.kind as ChatMessage['kind'],
            body: raw.body,
            metadata: raw.metadata,
            replyToId: raw.reply_to_id,
            createdAt: raw.created_at,
            deletedAt: raw.deleted_at,
            senderUsername: raw.profiles?.username ?? null,
            senderDisplayName: raw.profiles?.display_name ?? null,
            senderAvatarUrl: raw.profiles?.avatar_url ?? null,
            reactions: [],
          };

          setMessages(prev => [msg, ...prev]);

          if (tabRef.current === 'queue') {
            setChatUnread(n => n + 1);
          }
        },
      )
      .subscribe(status => {
        console.log(`[realtime] jam:chat:${jamRoomId} status=${status}`);
      });

    return () => { void supabase.removeChannel(channel); };
  // conversationId and jamRoomId are stable route params — run once
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NOTE: no unmount-time leaveJamRoom. The Android back button just navigates
  // back, the user stays in the jam (JamBanner gives them a way back in).
  // Leaving / ending the jam is an explicit user action via handleEnd.

  const handlePlayPause = useCallback(() => {
    if (!permissions.can_play_pause) { return; }
    if (activePostId) {
      handlersRef.current?.pause();
    } else {
      handlersRef.current?.play();
    }
    // The provider's broadcast-on-change effect picks up the activePostId
    // change and broadcasts within ~one render cycle. No manual call needed.
  }, [permissions, activePostId, handlersRef]);

  const handleSeekEnd = useCallback((seconds: number) => {
    if (!permissions.can_seek) { return; }
    handlersRef.current?.seek(seconds);
    setDisplayPositionMs(seconds * 1000);
    // The next 2s heartbeat will broadcast the new position. Listeners will
    // drift-correct on the next tick.
  }, [permissions, handlersRef]);

  const handleEnd = useCallback(() => {
    Alert.alert(
      isHost ? 'End Jam Room?' : 'Leave Jam Room?',
      isHost
        ? 'This will end the session for all members.'
        : 'You will leave the current jam room.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isHost ? 'End' : 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              if (isHost) {
                await endJamRoom(jamRoomId, conversationId);
              } else {
                await leaveJamRoom(jamRoomId);
              }
            } catch {
              // Non-fatal — still clear local state.
            }
            // Provider sees activeJam null → unsubscribes channel, clears
            // listener playback, unlocks floating player.
            clearActiveJam();
            navigation.goBack();
          },
        },
      ],
    );
  }, [isHost, jamRoomId, conversationId, clearActiveJam, navigation]);

  const handleSend = useCallback(async () => {
    const body = chatText.trim();
    if (!body || sending) { return; }
    setChatText('');
    setSending(true);

    const optimistic: ChatMessage = {
      id: `opt-${Date.now()}`,
      conversationId,
      senderId: myIdRef.current,
      kind: 'text',
      body,
      metadata: null,
      replyToId: null,
      createdAt: new Date().toISOString(),
      deletedAt: null,
      senderUsername: myUsername,
      senderDisplayName: null,
      senderAvatarUrl: myAvatarUrl,
      reactions: [],
    };
    setMessages(prev => [optimistic, ...prev]);

    try {
      const payload: SendMessagePayload = { kind: 'text', body };
      const real = await sendMessage(conversationId, payload, {
        username: myUsername,
        displayName: null,
        avatarUrl: myAvatarUrl,
      });
      setMessages(prev => prev.map(m => m.id === optimistic.id ? real : m));
    } catch {
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      setChatText(body);
    } finally {
      setSending(false);
    }
  }, [chatText, sending, conversationId, myUsername, myAvatarUrl]);

  const handleLoadQueue = useCallback(async () => {
    setQueueLoading(true);
    try {
      const items = await getJamQueue(jamRoomId);
      setQueueItems(items);
    } finally {
      setQueueLoading(false);
    }
  }, [jamRoomId]);

  const handleTabChange = useCallback((t: Tab) => {
    setTab(t);
    tabRef.current = t;
    if (t === 'chat') { setChatUnread(0); }
    if (t === 'queue' && queueItems.length === 0) {
      void handleLoadQueue();
    }
  }, [queueItems, handleLoadQueue]);

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    const isMe = item.senderId === myIdRef.current;
    return (
      <View style={[styles.bubbleRow, isMe && styles.bubbleRowMe]}>
        <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
          {!isMe && (
            <Text style={styles.bubbleSender}>{item.senderDisplayName || item.senderUsername}</Text>
          )}
          <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.body}</Text>
        </View>
      </View>
    );
  }, []);

  const renderQueueItem = useCallback(({ item }: { item: QueueItem }) => (
    <View style={styles.queueRow}>
      {item.trackCoverArt ? (
        <Image source={{ uri: item.trackCoverArt }} style={styles.queueCover} />
      ) : (
        <View style={styles.queueCoverPlaceholder}>
          <Text style={styles.queueCoverText}>♪</Text>
        </View>
      )}
      <View style={styles.queueInfo}>
        <Text style={styles.queueTitle} numberOfLines={1}>{item.trackTitle ?? 'Unknown'}</Text>
        <Text style={styles.queueArtist} numberOfLines={1}>{item.trackArtist ?? ''}</Text>
        {item.suggestedByUsername && (
          <Text style={styles.queueSuggester}>by @{item.suggestedByUsername}</Text>
        )}
      </View>
      <View style={styles.queueUpvote}>
        <Text style={styles.queueUpvoteCount}>▲ {item.upvotes}</Text>
      </View>
    </View>
  ), []);

  // Track to display in the player panel: host uses their own nowPlaying;
  // listener uses what the host broadcast.
  const displayTrack = useMemo(() => {
    if (isHost && nowPlaying) {
      return { title: nowPlaying.title, artist: nowPlaying.artistName, coverArt: nowPlaying.coverArtUrl };
    }
    if (!isHost && remotePlayback?.trackId) {
      return {
        title: remotePlayback.trackTitle ?? 'Unknown',
        artist: remotePlayback.trackArtist ?? '',
        coverArt: remotePlayback.trackCoverArt ?? null,
      };
    }
    return null;
  }, [isHost, nowPlaying, remotePlayback]);

  const durationSec = displayDurationMs / 1000;
  const positionSec = displayPositionMs / 1000;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} activeOpacity={0.7} onPress={() => navigation.goBack()}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Jam Room</Text>
          {(isHost || hostUsername) && (
            <Text style={styles.headerSub}>
              {isHost ? '👑 You are the host' : `👑 Host: @${hostUsername ?? 'unknown'}`}
            </Text>
          )}
        </View>
        <TouchableOpacity style={styles.endBtn} activeOpacity={0.7} onPress={handleEnd}>
          <Text style={styles.endBtnText}>{isHost ? 'End' : 'Leave'}</Text>
        </TouchableOpacity>
      </View>

      {/* Playback panel */}
      <View style={styles.playerPanel}>
        {/* Album art */}
        <View style={styles.artWrap}>
          {displayTrack?.coverArt ? (
            <Image source={{ uri: displayTrack.coverArt }} style={styles.art} />
          ) : (
            <View style={styles.artPlaceholder}>
              <Text style={styles.artPlaceholderText}>🎵</Text>
            </View>
          )}
        </View>

        {/* Track info */}
        {displayTrack ? (
          <View style={styles.trackInfo}>
            <Text style={styles.trackTitle} numberOfLines={1}>{displayTrack.title}</Text>
            <Text style={styles.trackArtist} numberOfLines={1}>{displayTrack.artist}</Text>
          </View>
        ) : (
          <View style={styles.trackInfo}>
            <Text style={styles.waitingText}>
              {synced ? 'No track playing' : 'Waiting for host…'}
            </Text>
          </View>
        )}

        {/* Seek bar */}
        {(permissions.can_seek || !isHost) && durationSec > 0 && (
          <View style={styles.seekWrap}>
            <SeekBar
              position={positionSec}
              duration={durationSec}
              onSeekEnd={permissions.can_seek ? handleSeekEnd : undefined}
            />
            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{msToTime(displayPositionMs)}</Text>
              <Text style={styles.timeText}>{msToTime(displayDurationMs)}</Text>
            </View>
          </View>
        )}

        {/* Controls */}
        {permissions.can_play_pause && (
          <View style={styles.controls}>
            <TouchableOpacity
              style={styles.controlBtn}
              activeOpacity={0.7}
              onPress={handlePlayPause}
            >
              <Text style={styles.controlBtnText}>{activePostId ? '⏸' : '▶'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Presence row */}
        <View style={styles.presenceRow}>
          {presenceMembers.slice(0, 5).map(m => (
            <View key={m.userId} style={styles.presenceItem}>
              <PresenceAvatar member={m} />
              <View style={styles.presenceOnlineDot} />
              <View style={styles.presenceAddBadge}>
                <AddBadge userId={m.userId} size="sm" />
              </View>
            </View>
          ))}
          {presenceMembers.length > 5 && (
            <View style={styles.presenceMore}>
              <Text style={styles.presenceMoreText}>+{presenceMembers.length - 5}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Tab toggle */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'chat' && styles.tabBtnActive]}
          onPress={() => handleTabChange('chat')}
          activeOpacity={0.8}
        >
          <View style={styles.tabLabelWrap}>
            <Text style={[styles.tabLabel, tab === 'chat' && styles.tabLabelActive]}>Chat</Text>
            {chatUnread > 0 && (
              <View style={styles.chatBadge}>
                <Text style={styles.chatBadgeText}>{chatUnread > 99 ? '99+' : chatUnread}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'queue' && styles.tabBtnActive]}
          onPress={() => handleTabChange('queue')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabLabel, tab === 'queue' && styles.tabLabelActive]}>Queue</Text>
        </TouchableOpacity>
      </View>

      {/* Chat tab */}
      {tab === 'chat' && (
        <KeyboardAvoidingView
          style={styles.flex}
          // On Android, `adjustResize` in AndroidManifest already pushes the
          // layout up when the keyboard opens. Layering KeyboardAvoidingView
          // on top of that double-shifts and hides the input. So we only
          // engage KAV on iOS.
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {messagesLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={COLORS.purple} />
            </View>
          ) : (
            <FlatList
              data={messages}
              keyExtractor={item => item.id}
              renderItem={renderMessage}
              inverted
              contentContainerStyle={styles.chatList}
            />
          )}
          <View style={styles.sendBar}>
            <View style={styles.inputWrap}>
              <FormInput
                value={chatText}
                onChangeText={setChatText}
                placeholder="Message…"
                placeholderTextColor={COLORS.textMuted}
                multiline
                style={styles.textInput}
                returnKeyType="default"
              />
            </View>
            <TouchableOpacity
              style={[styles.sendBtn, (!chatText.trim() || sending) && styles.sendBtnDisabled]}
              activeOpacity={0.7}
              onPress={() => void handleSend()}
              disabled={!chatText.trim() || sending}
            >
              <Text style={styles.sendBtnText}>→</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* Queue tab */}
      {tab === 'queue' && (
        <View style={styles.flex}>
          {queueLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={COLORS.purple} />
            </View>
          ) : (
            <FlatList
              data={queueItems}
              keyExtractor={item => item.id}
              renderItem={renderQueueItem}
              contentContainerStyle={queueItems.length === 0 ? styles.emptyContent : styles.queueList}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>Queue is empty.</Text>
                  <Text style={styles.emptySubText}>Suggest a track to add it.</Text>
                </View>
              }
            />
          )}
          <TouchableOpacity
            style={styles.refreshBtn}
            activeOpacity={0.8}
            onPress={() => void handleLoadQueue()}
          >
            <Text style={styles.refreshBtnText}>↻ Refresh Queue</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  headerCenter: { flex: 1 },
  headerTitle: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  headerSub: { color: COLORS.textSecondary, fontSize: 11, marginTop: 1 },
  endBtn: {
    paddingHorizontal: 12, paddingVertical: 5,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.35)',
    borderRadius: 8,
  },
  endBtnText: { color: COLORS.error, fontSize: 13, fontWeight: '700' },

  // Player panel
  playerPanel: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  artWrap: { marginBottom: 12 },
  art: { width: 110, height: 110, borderRadius: 12 },
  artPlaceholder: {
    width: 110, height: 110, borderRadius: 12,
    backgroundColor: COLORS.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  artPlaceholderText: { fontSize: 40 },
  trackInfo: { alignItems: 'center', marginBottom: 8, width: '100%' },
  trackTitle: { color: COLORS.white, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  trackArtist: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2, textAlign: 'center' },
  waitingText: { color: COLORS.textMuted, fontSize: 13 },
  seekWrap: { width: '100%', marginBottom: 4 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  timeText: { color: COLORS.textMuted, fontSize: 11 },
  controls: { flexDirection: 'row', gap: 24, marginBottom: 12 },
  controlBtn: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: COLORS.purple,
    alignItems: 'center', justifyContent: 'center',
  },
  controlBtnText: { fontSize: 20, color: COLORS.white },
  presenceRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 },
  presenceItem: { position: 'relative' },
  presenceAddBadge: { position: 'absolute', top: -4, right: -4 },
  presenceAvatar: { width: 32, height: 32, borderRadius: 16 },
  presenceAvatarPlaceholder: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1, borderColor: COLORS.purple,
    alignItems: 'center', justifyContent: 'center',
  },
  presenceAvatarText: { color: COLORS.purpleLight, fontSize: 12, fontWeight: '700' },
  presenceOnlineDot: {
    position: 'absolute', bottom: 0, right: 0,
    width: 9, height: 9, borderRadius: 5,
    backgroundColor: '#22C55E',
    borderWidth: 1.5, borderColor: COLORS.bg,
  },
  presenceMore: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: COLORS.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  presenceMoreText: { color: COLORS.textSecondary, fontSize: 11 },

  // Tabs
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
    padding: 3,
  },
  tabBtn: { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 8 },
  tabBtnActive: { backgroundColor: COLORS.purple },
  tabLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tabLabel: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  tabLabelActive: { color: COLORS.white },
  chatBadge: {
    backgroundColor: '#EF4444',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatBadgeText: { color: COLORS.white, fontSize: 10, fontWeight: '700' },

  // Chat
  chatList: { paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  bubbleRow: { flexDirection: 'row', justifyContent: 'flex-start', marginVertical: 2 },
  bubbleRowMe: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '75%', paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 14, backgroundColor: COLORS.surface,
  },
  bubbleMe: { backgroundColor: COLORS.purple, borderBottomRightRadius: 4 },
  bubbleThem: { borderBottomLeftRadius: 4 },
  bubbleSender: { color: COLORS.purpleLight, fontSize: 11, fontWeight: '700', marginBottom: 2 },
  bubbleText: { color: COLORS.white, fontSize: 14 },
  bubbleTextMe: { color: COLORS.white },
  sendBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  inputWrap: { flex: 1 },
  textInput: { maxHeight: 100 },
  sendBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: COLORS.purple,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: COLORS.white, fontSize: 18, fontWeight: '700' },

  // Queue
  queueList: { paddingBottom: 80 },
  emptyContent: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyText: { color: COLORS.textSecondary, fontSize: 15, fontWeight: '600' },
  emptySubText: { color: COLORS.textMuted, fontSize: 13, marginTop: 4 },
  queueRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10, gap: 12,
  },
  queueCover: { width: 44, height: 44, borderRadius: 6 },
  queueCoverPlaceholder: {
    width: 44, height: 44, borderRadius: 6,
    backgroundColor: COLORS.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  queueCoverText: { fontSize: 20 },
  queueInfo: { flex: 1 },
  queueTitle: { color: COLORS.white, fontSize: 14, fontWeight: '600' },
  queueArtist: { color: COLORS.textSecondary, fontSize: 12, marginTop: 1 },
  queueSuggester: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  queueUpvote: { alignItems: 'center' },
  queueUpvoteCount: { color: COLORS.purpleLight, fontSize: 13, fontWeight: '700' },
  refreshBtn: {
    margin: 16,
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1, borderColor: COLORS.purple,
    borderRadius: 10, paddingVertical: 12,
    alignItems: 'center',
  },
  refreshBtnText: { color: COLORS.purpleLight, fontSize: 14, fontWeight: '600' },
});
