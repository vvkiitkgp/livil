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

  console.log(`[realtime] subscribing to ${key}`);

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
        try {
          console.log(`[realtime] ${key} got messages INSERT`, payload.new?.id);
          // Fetch full message with sender's profile.
          // NOTE: must name the FK (`sender_id`) explicitly — PostgREST sees
          // both the direct messages.sender_id → profiles.id link AND the
          // indirect path through message_reactions, so a bare `profiles(...)`
          // embed throws "more than one relationship was found".
          const { data, error } = await db
            .from('messages')
            .select('*, profiles!sender_id(username, display_name, avatar_url)')
            .eq('id', payload.new.id)
            .single();
          if (error) {
            console.log(`[realtime] ${key} fetch error:`, error.message ?? String(error));
            return;
          }
          if (!data) {
            console.log(`[realtime] ${key} fetch returned null data`);
            return;
          }
          const { data: userData } = await supabase.auth.getUser();
          const myId = userData?.user?.id ?? '';
          const raw = data as {
            id: string; conversation_id: string; sender_id: string | null;
            kind: string; body: string | null; metadata: Record<string, unknown> | null;
            reply_to_id: string | null; created_at: string; deleted_at: string | null;
            profiles: { username: string; display_name: string | null; avatar_url: string | null } | null;
          };
          console.log(`[realtime] ${key} sender=${raw.sender_id} myId=${myId} body="${(raw.body ?? '').slice(0, 30)}"`);
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
            console.log(`[realtime] ${key} → calling onMessage`);
            onMessage(msg);
          } else {
            console.log(`[realtime] ${key} skipping own message`);
          }
        } catch (e) {
          console.log(`[realtime] ${key} handler threw:`, (e as Error)?.message ?? String(e));
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
    .subscribe(status => {
      console.log(`[realtime] ${key} status=${status}`);
    });

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

  console.log(`[realtime] subscribing to ${key}`);

  const channel = supabase
    .channel(key, {
      // ack:true makes channel.send() actually wait for server confirmation
      //   ('ok' now means delivered to the server, not just written to the socket).
      // self:true makes the sender ALSO receive their own broadcasts — used as a
      //   live diagnostic: if the host's own onPlaybackState fires, the broadcast
      //   pipeline is healthy end-to-end and the issue must be fan-out filtering.
      config: { broadcast: { ack: true, self: true } },
    })
    .on('broadcast', { event: 'PLAYBACK_STATE' }, ({ payload }) => {
      console.log(`[realtime] ${key} got PLAYBACK_STATE`, (payload as PlaybackBroadcast)?.track_id);
      handlers.onPlaybackState(payload as PlaybackBroadcast);
    })
    // Catch-all broadcast handler — fires for ANY broadcast event on this channel.
    // If subscriber receives a broadcast we don't recognize, this surfaces it.
    .on('broadcast', { event: '*' }, ({ event, payload }) => {
      if (event !== 'PLAYBACK_STATE') {
        console.log(`[realtime] ${key} got broadcast event=${event}`, payload);
      }
    })
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState() as Record<string, PresenceMember[]>;
      const members = Object.values(state).flat();
      console.log(`[realtime] ${key} presence sync, members=${members.length}`);
      handlers.onPresenceChange(members);
    })
    .subscribe(async status => {
      console.log(`[realtime] ${key} status=${status}`);
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
  // NOTE: client-side channel.send() broadcasts return 'ok' but never reach
  // subscribers on this project (verified empirically — SQL-side realtime.send
  // works, client-side .send does not). So we route through a server RPC.
  const payload = { ...state, type: 'PLAYBACK_STATE', host_ts: Date.now() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('broadcast_jam_state', {
    p_jam_room_id: jamRoomId,
    p_payload: payload,
  });
  if (error) {
    console.log(`[realtime] broadcast jam:${jamRoomId} track=${state.track_id} → error: ${error.message}`);
    return;
  }
  console.log(`[realtime] broadcast jam:${jamRoomId} track=${state.track_id} playing=${state.is_playing} → ok (via rpc)`);
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
