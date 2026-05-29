import { supabase } from '../../lib/supabase';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { ChatMessage } from './messages';

export type PlaybackBroadcast = {
  type: 'PLAYBACK_STATE';
  is_playing: boolean;
  position_ms: number;
  track_id: string;
  host_ts: number;
  // Full track info — sent on join sync and track changes so listeners can load the track
  track_title?: string;
  track_artist?: string;
  track_cover_art?: string | null;
  audio_url?: string;
  video_url?: string;
  media_kind?: 'audio' | 'video';
  post_id?: string;
  author_id?: string;
  author_username?: string;
  author_avatar_url?: string | null;
};

export type JamHandlers = {
  onPlaybackState: (state: PlaybackBroadcast) => void;
  onPresenceChange: (members: PresenceMember[]) => void;
  onHostChange?: (newHostId: string) => void;
};

export type PresenceMember = {
  userId: string;
  username: string;
  avatarUrl: string | null;
};

const activeChannels: Map<string, RealtimeChannel> = new Map();

export function subscribeToConversation(
  conversationId: string,
  onMessage: (m: ChatMessage) => void,
  onReactionChange: (messageId: string) => void,
): RealtimeChannel {
  const key = `conv:${conversationId}`;
  activeChannels.get(key)?.unsubscribe();

  const channel = supabase
    .channel(key)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      async payload => {
        // Fetch full message with profile join
        const { data } = await db
          .from('messages')
          .select('*, profiles(username, display_name, avatar_url)')
          .eq('id', payload.new.id)
          .single();
        if (data) {
          const { data: userData } = await supabase.auth.getUser();
          const myId = userData?.user?.id ?? '';
          const raw = data as {
            id: string; conversation_id: string; sender_id: string | null;
            kind: string; body: string | null; metadata: Record<string, unknown> | null;
            reply_to_id: string | null; created_at: string; deleted_at: string | null;
            profiles: { username: string; display_name: string | null; avatar_url: string | null } | null;
          };
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
          if (raw.sender_id !== myId) {
            onMessage(msg);
          }
        }
      },
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'message_reactions',
      },
      payload => {
        const messageId = (payload.new as Record<string, unknown>)?.message_id as string
          ?? (payload.old as Record<string, unknown>)?.message_id as string;
        if (messageId) {
          onReactionChange(messageId);
        }
      },
    )
    .subscribe();

  activeChannels.set(key, channel);
  return channel;
}

export function subscribeToJam(
  jamRoomId: string,
  currentUserId: string,
  username: string,
  avatarUrl: string | null,
  handlers: JamHandlers,
): RealtimeChannel {
  const key = `jam:${jamRoomId}`;
  activeChannels.get(key)?.unsubscribe();

  const channel = supabase
    .channel(key)
    .on('broadcast', { event: 'PLAYBACK_STATE' }, ({ payload }) => {
      handlers.onPlaybackState(payload as PlaybackBroadcast);
    })
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState() as Record<string, PresenceMember[]>;
      const members = Object.values(state).flat();
      handlers.onPresenceChange(members);
    })
    .subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        await channel.track({
          userId: currentUserId,
          username,
          avatarUrl,
        });
      }
    });

  activeChannels.set(key, channel);
  return channel;
}

export async function broadcastPlaybackState(
  jamRoomId: string,
  state: Omit<PlaybackBroadcast, 'type' | 'host_ts'>,
): Promise<void> {
  const key = `jam:${jamRoomId}`;
  const channel = activeChannels.get(key);
  if (!channel) { return; }

  await channel.send({
    type: 'broadcast',
    event: 'PLAYBACK_STATE',
    payload: { ...state, type: 'PLAYBACK_STATE', host_ts: Date.now() },
  });
}

export function unsubscribeFromConversation(conversationId: string): void {
  const key = `conv:${conversationId}`;
  activeChannels.get(key)?.unsubscribe();
  activeChannels.delete(key);
}

export function unsubscribeFromJam(jamRoomId: string): void {
  const key = `jam:${jamRoomId}`;
  activeChannels.get(key)?.unsubscribe();
  activeChannels.delete(key);
}

export function unsubscribeAll(): void {
  for (const channel of activeChannels.values()) {
    channel.unsubscribe();
  }
  activeChannels.clear();
}
