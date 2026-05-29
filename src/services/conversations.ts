import { supabase } from '../../lib/supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type ConversationKind = 'dm' | 'group';

export type ConversationSummary = {
  id: string;
  kind: ConversationKind;
  name: string | null;
  avatarUrl: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  // DM-only: the other participant
  otherUserId: string | null;
  otherUserUsername: string | null;
  otherUserName: string | null;
  otherUserAvatar: string | null;
  otherUserOnline: boolean;
};

export type NowPlaying = {
  trackTitle: string;
  artistName: string;
};

export type FriendActivity = {
  isOnline: boolean;
  nowPlaying: NowPlaying | null;
};

export async function listConversations(): Promise<ConversationSummary[]> {
  const { data, error } = await db.rpc('list_my_conversations');
  if (error) { throw error; }
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    kind: row.kind as ConversationKind,
    name: (row.name as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    lastMessageAt: (row.last_message_at as string | null) ?? null,
    lastMessagePreview: (row.last_message_preview as string | null) ?? null,
    unreadCount: Number(row.unread_count ?? 0),
    otherUserId: (row.other_user_id as string | null) ?? null,
    otherUserUsername: (row.other_user_username as string | null) ?? null,
    otherUserName: (row.other_user_name as string | null) ?? null,
    otherUserAvatar: (row.other_user_avatar as string | null) ?? null,
    otherUserOnline: Boolean(row.other_user_online),
  }));
}

export async function getOrCreateDm(friendId: string): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;
  if (!me) { throw new Error('not_authenticated'); }

  const { data, error } = await db.rpc('get_or_create_dm', {
    user_a: me,
    user_b: friendId,
  });
  if (error) { throw error; }
  return data as string;
}

export async function createGroup(
  name: string,
  memberIds: string[],
): Promise<string> {
  const { data, error } = await db.rpc('create_group', {
    p_name: name,
    p_member_ids: memberIds,
  });
  if (error) { throw error; }
  return data as string;
}

export async function markAsRead(conversationId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;
  if (!me) { return; }

  await db
    .from('conversation_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', me);
}

export async function leaveConversation(conversationId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;
  if (!me) { return; }

  await db
    .from('conversation_members')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('user_id', me);
}

export async function addGroupMember(
  conversationId: string,
  userId: string,
): Promise<void> {
  await db
    .from('conversation_members')
    .upsert({ conversation_id: conversationId, user_id: userId, role: 'member' });
}

export async function getFriendActivity(userId: string): Promise<FriendActivity> {
  const [profileResult, sessionResult] = await Promise.all([
    db
      .from('profiles')
      .select('last_seen_at, show_activity')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('listen_sessions')
      .select('track_title, artist_name, updated_at')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  const profile = profileResult.data;
  if (!profile?.show_activity) {
    return { isOnline: false, nowPlaying: null };
  }

  const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const isOnline = !!profile.last_seen_at && profile.last_seen_at > threeMinutesAgo;

  const session = sessionResult.data;
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const nowPlaying =
    session && session.updated_at > fiveMinutesAgo
      ? { trackTitle: session.track_title, artistName: session.artist_name }
      : null;

  return { isOnline, nowPlaying };
}

export type GroupMember = {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'admin' | 'member';
};

export async function getGroupMembers(conversationId: string): Promise<GroupMember[]> {
  const { data: members, error: membErr } = await db
    .from('conversation_members')
    .select('user_id, role')
    .eq('conversation_id', conversationId);
  if (membErr) { throw membErr; }
  if (!members || members.length === 0) { return []; }

  const ids = (members as { user_id: string; role: string }[]).map(m => m.user_id);
  const { data: profiles, error: profErr } = await db
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .in('id', ids);
  if (profErr) { throw profErr; }

  const profMap = new Map<string, Record<string, unknown>>();
  for (const p of (profiles ?? []) as Record<string, unknown>[]) {
    profMap.set(p.id as string, p);
  }

  return (members as { user_id: string; role: string }[]).map(m => {
    const p = profMap.get(m.user_id) ?? {};
    return {
      userId: m.user_id,
      username: (p.username as string | null) ?? '',
      displayName: (p.display_name as string | null) ?? null,
      avatarUrl: (p.avatar_url as string | null) ?? null,
      role: m.role as 'admin' | 'member',
    };
  });
}

export async function removeGroupMember(
  conversationId: string,
  userId: string,
): Promise<void> {
  await db
    .from('conversation_members')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);
}

export async function updateGroupName(
  conversationId: string,
  name: string,
): Promise<void> {
  const { error } = await db
    .from('conversations')
    .update({ name })
    .eq('id', conversationId);
  if (error) { throw error; }
}

export async function updatePresenceHeartbeat(): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;
  if (!me) { return; }

  await db
    .from('profiles')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', me);
}
