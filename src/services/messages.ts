import { supabase } from '../../lib/supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type MessageKind = 'text' | 'track_share' | 'jam_invite' | 'sticker' | 'system';

export type MessageReaction = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  users: string[];
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string | null;
  kind: MessageKind;
  body: string | null;
  metadata: Record<string, unknown> | null;
  replyToId: string | null;
  createdAt: string;
  deletedAt: string | null;
  // joined from profiles
  senderUsername: string | null;
  senderDisplayName: string | null;
  senderAvatarUrl: string | null;
  reactions: MessageReaction[];
};

type RawMessage = {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  kind: string;
  body: string | null;
  metadata: Record<string, unknown> | null;
  reply_to_id: string | null;
  created_at: string;
  deleted_at: string | null;
  profiles: {
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
};

function toMessage(raw: RawMessage, myId: string, rawReactions: RawReaction[]): ChatMessage {
  const reactionMap = new Map<string, { count: number; reactedByMe: boolean; users: string[] }>();
  for (const r of rawReactions.filter(rx => rx.message_id === raw.id)) {
    const existing = reactionMap.get(r.emoji) ?? { count: 0, reactedByMe: false, users: [] };
    existing.count += 1;
    existing.users.push(r.user_id);
    if (r.user_id === myId) { existing.reactedByMe = true; }
    reactionMap.set(r.emoji, existing);
  }

  return {
    id: raw.id,
    conversationId: raw.conversation_id,
    senderId: raw.sender_id,
    kind: raw.kind as MessageKind,
    body: raw.body,
    metadata: raw.metadata,
    replyToId: raw.reply_to_id,
    createdAt: raw.created_at,
    deletedAt: raw.deleted_at,
    senderUsername: raw.profiles?.username ?? null,
    senderDisplayName: raw.profiles?.display_name ?? null,
    senderAvatarUrl: raw.profiles?.avatar_url ?? null,
    reactions: Array.from(reactionMap.entries()).map(([emoji, v]) => ({
      emoji,
      count: v.count,
      reactedByMe: v.reactedByMe,
      users: v.users,
    })),
  };
}

type RawReaction = { message_id: string; user_id: string; emoji: string };

type RawMessageRow = Omit<RawMessage, 'profiles'>;

export async function fetchMessages(
  conversationId: string,
  cursor?: string,
  limit = 30,
): Promise<{ messages: ChatMessage[]; nextCursor: string | null }> {
  const { data: userData } = await supabase.auth.getUser();
  const myId = userData?.user?.id ?? '';

  let query = db
    .from('messages')
    .select('id, conversation_id, sender_id, kind, body, metadata, reply_to_id, created_at, deleted_at')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit + 1);

  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  const { data, error } = await query;
  if (error) { throw error; }

  const rows = (data ?? []) as RawMessageRow[];
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;

  if (slice.length === 0) {
    return { messages: [], nextCursor: null };
  }

  // Batch-fetch sender profiles
  const senderIds = [...new Set(slice.map(r => r.sender_id).filter(Boolean))] as string[];
  const { data: profileData } = await db
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .in('id', senderIds);
  const profileMap = new Map<string, { username: string; display_name: string | null; avatar_url: string | null }>();
  for (const p of (profileData ?? []) as { id: string; username: string; display_name: string | null; avatar_url: string | null }[]) {
    profileMap.set(p.id, p);
  }

  // Batch-fetch reactions for this page
  const msgIds = slice.map(r => r.id);
  const { data: rxnData } = await db
    .from('message_reactions')
    .select('message_id, user_id, emoji')
    .in('message_id', msgIds);
  const rawReactions = (rxnData ?? []) as RawReaction[];

  const withProfiles: RawMessage[] = slice.map(r => ({
    ...r,
    profiles: r.sender_id ? (profileMap.get(r.sender_id) ?? null) : null,
  }));

  const messages = withProfiles.map(r => toMessage(r, myId, rawReactions));
  const nextCursor = hasMore ? slice[slice.length - 1]!.created_at : null;

  return { messages, nextCursor };
}

export type SendMessagePayload =
  | { kind: 'text'; body: string; replyToId?: string }
  | { kind: 'track_share'; metadata: { track_id: string; post_id?: string; title: string; artist_name: string; cover_art_url: string | null } }
  | { kind: 'sticker'; metadata: { sticker_id: string; sticker_url: string } }
  | { kind: 'jam_invite'; metadata: { jam_room_id: string } };

export async function sendMessage(
  conversationId: string,
  payload: SendMessagePayload,
  senderInfo?: { username: string | null; displayName: string | null; avatarUrl: string | null },
): Promise<ChatMessage> {
  const { data: userData } = await supabase.auth.getUser();
  const myId = userData?.user?.id ?? '';

  const insert: Record<string, unknown> = {
    conversation_id: conversationId,
    sender_id: myId,
    kind: payload.kind,
  };

  if (payload.kind === 'text') {
    insert.body = payload.body;
    if (payload.replyToId) { insert.reply_to_id = payload.replyToId; }
  } else {
    insert.metadata = payload.metadata;
  }

  const { data, error } = await db
    .from('messages')
    .insert(insert)
    .select('id, created_at')
    .single();

  if (error) { throw error; }
  const row = data as { id: string; created_at: string };

  const raw: RawMessage = {
    id: row.id,
    conversation_id: conversationId,
    sender_id: myId,
    kind: payload.kind,
    body: payload.kind === 'text' ? payload.body : null,
    metadata: payload.kind !== 'text' ? (payload.metadata as Record<string, unknown>) : null,
    reply_to_id: payload.kind === 'text' && payload.replyToId ? payload.replyToId : null,
    created_at: row.created_at,
    deleted_at: null,
    profiles: senderInfo
      ? { username: senderInfo.username ?? '', display_name: senderInfo.displayName, avatar_url: senderInfo.avatarUrl }
      : null,
  };

  return toMessage(raw, myId, []);
}

export async function deleteMessage(messageId: string): Promise<void> {
  await db
    .from('messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', messageId);
}

export async function addReaction(messageId: string, emoji: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;
  if (!me) { return; }

  // One reaction per user — delete any existing reaction first, then insert
  await db.from('message_reactions').delete().eq('message_id', messageId).eq('user_id', me);
  await db.from('message_reactions').insert({ message_id: messageId, user_id: me, emoji });
}

export async function removeReaction(messageId: string, emoji: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;
  if (!me) { return; }

  await db
    .from('message_reactions')
    .delete()
    .eq('message_id', messageId)
    .eq('user_id', me)
    .eq('emoji', emoji);
}
