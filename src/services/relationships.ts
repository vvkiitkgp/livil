import { supabase } from '../../lib/supabase';
import { sendPush } from './pushDispatch';
import { notifyFriendOutcome, notifyNewFan } from './activity';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type IncomingFriendRequest = {
  otherUserId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
};

export type ViewerRelationships = {
  friends: string[];
  stars: string[];
  pendingOutgoing: string[];
  pendingIncoming: string[];
  /**
   * People I have blocked. One-way: this can never contain someone who blocked
   * ME, because blocked_users_select_own admits the blocker only. That asymmetry
   * is deliberate — see the migration — so the UI must never try to render "you
   * are blocked by this person".
   */
  blocked: string[];
};

/**
 * Loads my full outgoing relationships set in one round-trip so the client
 * can answer `status(userId)` synchronously for every render of a user row.
 */
export async function loadViewerRelationships(): Promise<ViewerRelationships> {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;
  if (!me) {
    return { friends: [], stars: [], pendingOutgoing: [], pendingIncoming: [], blocked: [] };
  }

  const [friendshipsRes, starsRes, blockedRes] = await Promise.all([
    db
      .from('friendships')
      .select('user_a_id, user_b_id, requested_by, status')
      .or(`user_a_id.eq.${me},user_b_id.eq.${me}`),
    db
      .from('follows')
      .select('following_id')
      .eq('follower_id', me)
      .eq('kind', 'star'),
    // No .eq('blocker_id', me) needed — RLS already scopes this to my own rows —
    // but it is stated anyway so the query reads correctly against the table.
    db
      .from('blocked_users')
      .select('blocked_id')
      .eq('blocker_id', me),
  ]);

  if (friendshipsRes.error) { throw new Error(friendshipsRes.error.message); }
  if (starsRes.error) { throw new Error(starsRes.error.message); }
  if (blockedRes.error) { throw new Error(blockedRes.error.message); }

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

  const blocked = ((blockedRes.data ?? []) as Array<{ blocked_id: string }>)
    .map(r => r.blocked_id);

  return { friends, stars, pendingOutgoing, pendingIncoming, blocked };
}

/**
 * Blocks a user: severs the friendship (accepted or pending) and drops stars in
 * both directions, atomically, inside block_user(). Their uploads, reposts,
 * playlists and albums stay visible — blocking severs contact, not the catalogue.
 */
export async function blockUser(userId: string): Promise<void> {
  const { error } = await db.rpc('block_user', { target_user_id: userId });
  if (error) { throw new Error(error.message); }
}

/**
 * Unblocks. Does NOT restore the friendship or the stars that blocking removed —
 * the pair go back to strangers, not to friends.
 */
export async function unblockUser(userId: string): Promise<void> {
  const { error } = await db.rpc('unblock_user', { target_user_id: userId });
  if (error) { throw new Error(error.message); }
}

export type BlockedAccount = {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  blockedAt: string;
};

/**
 * The people I have blocked, with enough profile to recognise them.
 *
 * WHY THIS EXISTS AS ITS OWN CALL. RelationshipContext already holds the blocked
 * ids, but ids are not a list a person can read. Blocking severs the friendship,
 * so a blocked account is by definition no longer anywhere else in the app — not
 * in friends, not in stars. Without this, the only route to unblock is finding
 * their profile again, which requires remembering a username you deliberately
 * pushed out of your life. That is a dead end, not a design.
 *
 * Ordered newest first: the block you most likely want to undo is the one you
 * least meant.
 *
 * RLS does the scoping — `blocked_users_select_own` admits the blocker's rows and
 * no one else's — so this cannot return another user's block list even if the
 * filter below were wrong.
 */
export async function listBlockedAccounts(): Promise<BlockedAccount[]> {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;
  if (!me) { return []; }

  const { data, error } = await db
    .from('blocked_users')
    .select('blocked_id, created_at, profiles!blocked_users_blocked_id_fkey(username, display_name, avatar_url)')
    .eq('blocker_id', me)
    .order('created_at', { ascending: false });

  if (error) { throw new Error(error.message); }

  return ((data ?? []) as Array<Record<string, unknown>>).map(row => {
    // PostgREST returns an embedded one-to-one as an object, but older planners
    // and some column shapes hand back a single-element array. Accept both rather
    // than render "Unknown" for every row if that ever changes.
    const raw = row.profiles;
    const p = (Array.isArray(raw) ? raw[0] : raw) as
      | { username?: string | null; display_name?: string | null; avatar_url?: string | null }
      | undefined;
    return {
      userId: row.blocked_id as string,
      username: p?.username ?? '',
      displayName: p?.display_name ?? null,
      avatarUrl: p?.avatar_url ?? null,
      blockedAt: row.created_at as string,
    };
  });
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
  // Surfaces the outcome in the requester's Activity center + pushes them.
  void notifyFriendOutcome(userId, true);
}

export async function rejectFriendRequest(userId: string): Promise<void> {
  const { error } = await db.rpc('reject_friend_request', { other_user_id: userId });
  if (error) { throw new Error(error.message); }
  // Outcome surfaces in the requester's Activity center (no OS push on reject).
  void notifyFriendOutcome(userId, false);
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
  // New fan surfaces in the starred user's Activity center + pushes them.
  void notifyNewFan(userId);
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
