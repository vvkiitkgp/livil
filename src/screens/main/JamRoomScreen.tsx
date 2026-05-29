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
  Pressable,
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
import { usePlayback } from '../../contexts/PlaybackContext';
import { useJam } from '../../contexts/JamContext';
import {
  joinJamRoom,
  leaveJamRoom,
  endJamRoom,
  getMyJamPermissions,
  updatePlaybackState,
  getJamQueue,
  addToQueue,
  type JamRoomState,
  type JamPermissions,
  type QueueItem,
} from '../../services/jamRooms';
import {
  subscribeToJam,
  unsubscribeFromJam,
  broadcastPlaybackState,
  type PlaybackBroadcast,
  type PresenceMember,
} from '../../services/jamRealtime';
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
    activePostId,
    setJamLocked,
    setNowPlaying,
    requestPlay,
  } = usePlayback();
  const { clearActiveJam } = useJam();

  const [myId, setMyId] = useState('');
  const [myUsername, setMyUsername] = useState('');
  const [myAvatarUrl, setMyAvatarUrl] = useState<string | null>(null);
  const [jamState, setJamState] = useState<JamRoomState | null>(null);
  const [permissions, setPermissions] = useState<JamPermissions>({
    can_play_pause: false, can_seek: false, can_skip: false,
    can_change_track: false, can_suggest: true,
  });
  const [isHost, setIsHost] = useState(false);
  const [presenceMembers, setPresenceMembers] = useState<PresenceMember[]>([]);
  const [tab, setTab] = useState<Tab>('chat');
  const [chatUnread, setChatUnread] = useState(0);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [chatText, setChatText] = useState('');
  const [sending, setSending] = useState(false);

  // Queue state
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);

  // Playback display state (updated from broadcast or local position tick)
  const [displayPositionMs, setDisplayPositionMs] = useState(0);
  const [displayDurationMs, setDisplayDurationMs] = useState(0);
  const [broadcastTrack, setBroadcastTrack] = useState<{
    title: string; artist: string; coverArt: string | null;
  } | null>(null);
  const [synced, setSynced] = useState(false);

  // Stable refs to avoid stale closures in callbacks
  const isHostRef = useRef(false);
  const myIdRef = useRef('');
  const jamRoomIdRef = useRef(jamRoomId);
  const conversationIdRef = useRef(conversationId);
  const tabRef = useRef<Tab>('chat');
  const dbSnapshotTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll local position for seek bar display (host only — listeners get position from broadcast)
  useEffect(() => {
    if (!isHost || !activePostId) { return; }
    const id = setInterval(() => {
      setDisplayPositionMs(positionRef.current * 1000);
    }, 500);
    return () => clearInterval(id);
  }, [isHost, activePostId, positionRef]);

  // Broadcast helper
  const broadcast = useCallback((extraFields?: Partial<PlaybackBroadcast>) => {
    const np = nowPlaying;
    void broadcastPlaybackState(jamRoomIdRef.current, {
      is_playing: !!activePostId,
      position_ms: positionRef.current * 1000,
      track_id: np?.trackId ?? '',
      track_title: np?.title,
      track_artist: np?.artistName,
      track_cover_art: np?.coverArtUrl,
      audio_url: np?.audioUrl,
      video_url: np?.videoUrl,
      media_kind: np?.mediaKind,
      post_id: np?.postId,
      author_id: np?.authorId,
      author_username: np?.authorUsername,
      author_avatar_url: np?.authorAvatarUrl,
      ...extraFields,
    });
  }, [nowPlaying, activePostId, positionRef]);

  // Mount: load profile, join jam, load messages, subscribe
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Load my profile
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id ?? '';
      myIdRef.current = uid;
      if (!cancelled) { setMyId(uid); }

      const { data: prof } = await db
        .from('profiles')
        .select('username, avatar_url')
        .eq('id', uid)
        .maybeSingle();
      const username = (prof as { username?: string } | null)?.username ?? 'User';
      const avatarUrl = (prof as { avatar_url?: string | null } | null)?.avatar_url ?? null;
      if (!cancelled) {
        setMyUsername(username);
        setMyAvatarUrl(avatarUrl);
      }

      // Join jam room (upserts listener row, returns snapshot)
      let state: JamRoomState;
      try {
        state = await joinJamRoom(jamRoomId);
      } catch (err) {
        if (!cancelled) {
          Alert.alert('Could not join jam', err instanceof Error ? err.message : String(err));
          navigation.goBack();
        }
        return;
      }

      if (cancelled) { return; }
      setJamState(state);
      const host = state.hostId === uid;
      isHostRef.current = host;
      setIsHost(host);

      // Get my permissions
      const perms = await getMyJamPermissions(jamRoomId);
      if (!cancelled) { setPermissions(perms); }

      // Lock FloatingPlayer for listeners
      if (!host) { setJamLocked(true); }

      // Adjust playback position for network lag if host is playing
      if (state.hostClockAt && state.isPlaying) {
        const lag = Date.now() - new Date(state.hostClockAt).getTime();
        const adjustedMs = state.playbackPositionMs + lag;
        if (!host) {
          setDisplayPositionMs(adjustedMs);
        }
      }

      // Load messages (static snapshot — no realtime to avoid subscription conflict)
      const { messages: msgs } = await fetchMessages(conversationId);
      if (!cancelled) {
        setMessages(msgs);
        setMessagesLoading(false);
      }

      // Duration from current player
      if (!cancelled) {
        setDisplayDurationMs(0); // will update when now playing is known
      }

      // Subscribe to jam broadcast
      subscribeToJam(jamRoomId, uid, username, avatarUrl, {
        onPlaybackState: (bc: PlaybackBroadcast) => {
          const adjustedMs = bc.position_ms + (Date.now() - bc.host_ts);
          setDisplayPositionMs(adjustedMs);

          if (bc.track_title) {
            setBroadcastTrack({
              title: bc.track_title,
              artist: bc.track_artist ?? '',
              coverArt: bc.track_cover_art ?? null,
            });
          }

          if (!isHostRef.current) {
            // Sync listener's local audio
            handlersRef.current?.seek(adjustedMs / 1000);
            if (bc.is_playing && !activePostId) {
              handlersRef.current?.play();
            } else if (!bc.is_playing && activePostId) {
              handlersRef.current?.pause();
            }
          }
          setSynced(true);
        },
        onPresenceChange: (members: PresenceMember[]) => {
          setPresenceMembers(members);
          // Host re-broadcasts full state so any joining listener syncs
          if (isHostRef.current) {
            broadcast();
          }
        },
      });

      // Host: broadcast immediately + start DB snapshot timer
      if (host) {
        broadcast();
        setSynced(true);
        dbSnapshotTimer.current = setInterval(() => {
          void updatePlaybackState(jamRoomIdRef.current, {
            positionMs: positionRef.current * 1000,
            isPlaying: !!activePostId,
          });
          broadcast();
        }, 5000);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unmount: leave jam, unlock player, clear banner, clear timer
  useEffect(() => {
    return () => {
      if (dbSnapshotTimer.current) { clearInterval(dbSnapshotTimer.current); }
      void leaveJamRoom(jamRoomId);
      unsubscribeFromJam(jamRoomId);
      setJamLocked(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to new conversation messages for the Chat tab unread badge.
  // Uses a unique channel key (jam:chat:jamRoomId) so it doesn't conflict with
  // ConversationScreen's conv:conversationId channel which stays active behind us.
  useEffect(() => {
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
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  // conversationId and jamRoomId are stable route params — run once
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePlayPause = useCallback(() => {
    if (!permissions.can_play_pause) { return; }
    if (activePostId) {
      handlersRef.current?.pause();
    } else {
      handlersRef.current?.play();
    }
    broadcast();
  }, [permissions, activePostId, handlersRef, broadcast]);

  const handleSeekEnd = useCallback((seconds: number) => {
    if (!permissions.can_seek) { return; }
    handlersRef.current?.seek(seconds);
    setDisplayPositionMs(seconds * 1000);
    broadcast({ position_ms: seconds * 1000 });
  }, [permissions, handlersRef, broadcast]);

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
            if (isHost) {
              await endJamRoom(jamRoomId, conversationId);
            }
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

  // Determine what track to display in the player panel
  const displayTrack = useMemo(() => {
    if (isHost && nowPlaying) {
      return { title: nowPlaying.title, artist: nowPlaying.artistName, coverArt: nowPlaying.coverArtUrl };
    }
    return broadcastTrack;
  }, [isHost, nowPlaying, broadcastTrack]);

  const durationSec = displayDurationMs / 1000;
  const positionSec = displayPositionMs / 1000;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} activeOpacity={0.7} onPress={() => navigation.goBack()}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Jam Room</Text>
          {jamState && (
            <Text style={styles.headerSub}>
              {isHost ? '👑 You are the host' : `👑 Host: @${jamState.hostUsername}`}
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
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
