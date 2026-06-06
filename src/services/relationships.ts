import { supabase } from '../../lib/supabase';
import { sendPush } from './pushDispatch';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type IncomingFriendRequest = {
  otherUserId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
};

export type NewFansSummary = {
  count: number;
  recent: Array<{
    userId: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    createdAt: string;
  }>;
};

export type ViewerRelationships = {
  friends: string[];
  stars: string[];
  pendingOutgoing: string[];
  pendingIncoming: string[];
};

/**
 * Loads my full outgoing relationships set in one round-trip so the client
 * can answer `status(userId)` synchronously for every render of a user row.
 */
export async function loadViewerRelationships(): Promise<ViewerRelationships> {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;
  if (!me) {
    return { friends: [], stars: [], pendingOutgoing: [], pendingIncoming: [] };
  }

  const [friendshipsRes, starsRes] = await Promise.all([
    db
      .from('friendships')
      .select('user_a_id, user_b_id, requested_by, status')
      .or(`user_a_id.eq.${me},user_b_id.eq.${me}`),
    db
      .from('follows')
      .select('following_id')
      .eq('follower_id', me)
      .eq('kind', 'star'),
  ]);

  if (friendshipsRes.error) { throw new Error(friendshipsRes.error.message); }
  if (starsRes.error) { throw new Error(starsRes.error.message); }

  const friends: string[] = [];
  const pendingOutgoing: string[] = [];
  const pendingIncoming: string[] = [];

  for (const row of (friendshipsRes.data ?? []) as Array<{
    user_a_id: string;
    user_b_id: string;
    requested_by: string;
    status: 'pending' | 'accepted';
  }>) {
    const other = row.user_a_id === me ? row.user_b_id : row.user_a_id;
    if (row.status === 'accepted') {
      friends.push(other);
    } else if (row.requested_by === me) {
      pendingOutgoing.push(other);
    } else {
      pendingIncoming.push(other);
    }
  }

  const stars = ((starsRes.data ?? []) as Array<{ following_id: string }>)
    .map(r => r.following_id);

  return { friends, stars, pendingOutgoing, pendingIncoming };
}

export async function sendFriendRequest(userId: string): Promise<void> {
  const { error } = await db.rpc('send_friend_request', { target_user_id: userId });
  if (error) { throw new Error(error.message); }
  void sendPush({
    recipientUserId: userId,
    kind: 'friend_request',
    data: { route: 'FriendRequests' },
  });
}

export async function acceptFriendRequest(userId: string): Promise<void> {
  const { error } = await db.rpc('accept_friend_request', { other_user_id: userId });
  if (error) { throw new Error(error.message); }
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;
  void sendPush({
    recipientUserId: userId,
    kind: 'friend_accepted',
    data: { route: 'UserProfile', params: { userId: me ?? '' } },
  });
}

export async function rejectFriendRequest(userId: string): Promise<void> {
  const { error } = await db.rpc('reject_friend_request', { other_user_id: userId });
  if (error) { throw new Error(error.message); }
}

export async function cancelFriendRequest(userId: string): Promise<void> {
  const { error } = await db.rpc('cancel_friend_request', { other_user_id: userId });
  if (error) { throw new Error(error.message); }
}

export async function removeFriend(userId: string): Promise<void> {
  const { error } = await db.rpc('remove_friend', { other_user_id: userId });
  if (error) { throw new Error(error.message); }
}

export async function addStar(userId: string): Promise<void> {
  const { error } = await db.rpc('add_star', { target_user_id: userId });
  if (error) { throw new Error(error.message); }
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;
  void sendPush({
    recipientUserId: userId,
    kind: 'new_fan',
    data: { route: 'UserProfile', params: { userId: me ?? '' } },
  });
}

export async function removeStar(userId: string): Promise<void> {
  const { error } = await db.rpc('remove_star', { target_user_id: userId });
  if (error) { throw new Error(error.message); }
}

export async function listIncomingFriendRequests(): Promise<IncomingFriendRequest[]> {
  const { data, error } = await db.rpc('list_incoming_friend_requests');
  if (error) { throw new Error(error.message); }
  return ((data ?? []) as Array<Record<string, unknown>>).map(row => ({
    otherUserId: row.other_user_id as string,
    username: (row.username as string | null) ?? '',
    displayName: (row.display_name as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

export async function getNewFansSummary(): Promise<NewFansSummary> {
  const { data, error } = await db.rpc('get_new_fans_summary');
  if (error) { throw new Error(error.message); }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const count = Number(rows[0]?.total_count ?? 0);
  const recent = rows
    .filter(r => r.recent_user_id != null)
    .map(r => ({
      userId: r.recent_user_id as string,
      username: (r.username as string | null) ?? '',
      displayName: (r.display_name as string | null) ?? null,
      avatarUrl: (r.avatar_url as string | null) ?? null,
      createdAt: r.created_at as string,
    }));
  return { count, recent };
}

export async function markFansSeen(): Promise<void> {
  const { error } = await db.rpc('mark_fans_seen');
  if (error) { throw new Error(error.message); }
}
